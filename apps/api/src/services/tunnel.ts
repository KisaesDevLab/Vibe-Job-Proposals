// Cloudflare Tunnel orchestration:
//   • Provision: validate token → ensure tunnel exists → fetch connector token
//     → push ingress → upsert CNAME → write env file → restart cloudflared →
//     render & reload Caddyfile.
//   • Disable: stop cloudflared → delete CNAME → delete tunnel → clear env +
//     DB tokens → render empty Caddyfile.
//
// All Cloudflare API errors propagate so the route handler can surface them
// to the UI. State is persisted in settings.tunnel_* columns + a 0600
// env_file at $STORAGE_ROOT/cloudflared/tunnel.env that the cloudflared
// docker service reads.

import Docker from 'dockerode';
import { sql } from '@darrow/db';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { encryptTunnelSecret, decryptTunnelSecret } from '../crypto.js';
import {
  verifyToken,
  createOrFindTunnel,
  getConnectorToken,
  setTunnelIngress,
  upsertCname,
  deleteCname,
  deleteTunnel,
  CfError,
} from './cloudflare.js';
import { writeCaddyfile, removeCaddyfile, reloadCaddy } from './caddy.js';

const CLOUDFLARED_CONTAINER = process.env.CLOUDFLARED_CONTAINER ?? 'darrow-cloudflared-1';

interface TunnelSettingsRow {
  tunnel_enabled: boolean;
  cf_api_token_enc: string | null;
  cf_account_id: string | null;
  cf_zone_id: string | null;
  cf_zone_name: string | null;
  tunnel_name: string | null;
  tunnel_subdomain: string | null;
  tunnel_id: string | null;
  tunnel_token_enc: string | null;
  tunnel_status: string;
  tunnel_last_error: string | null;
  tunnel_last_provisioned_at: string | null;
}

export async function loadTunnelSettings(): Promise<TunnelSettingsRow> {
  const [row] = await sql<TunnelSettingsRow[]>`SELECT
    tunnel_enabled, cf_api_token_enc, cf_account_id, cf_zone_id, cf_zone_name,
    tunnel_name, tunnel_subdomain, tunnel_id, tunnel_token_enc, tunnel_status,
    tunnel_last_error, tunnel_last_provisioned_at::text AS tunnel_last_provisioned_at
    FROM settings WHERE id = 1`;
  return row;
}

/** Decrypt the stored Cloudflare API token. Returns null when unset. */
export function getApiToken(row: TunnelSettingsRow): string | null {
  if (!row.cf_api_token_enc) return null;
  return decryptTunnelSecret(row.cf_api_token_enc);
}

function fqdnOf(row: { tunnel_subdomain: string | null; cf_zone_name: string | null }): string | null {
  if (!row.tunnel_subdomain || !row.cf_zone_name) return null;
  return `${row.tunnel_subdomain}.${row.cf_zone_name}`;
}

/** Detect the Docker network the api container is on so the cloudflared
 *  sidecar can resolve service names like `caddy`. Falls back to
 *  `<compose-project>_default` (typical) and finally to `darrow_default`. */
async function detectNetworkName(docker: Docker): Promise<string> {
  const containerId = process.env.HOSTNAME;
  if (containerId) {
    try {
      const self = docker.getContainer(containerId);
      const info = await self.inspect();
      const nets = Object.keys(info.NetworkSettings?.Networks ?? {});
      if (nets.length > 0) return nets[0];
    } catch { /* fall through to default */ }
  }
  return 'darrow_default';
}

/** Full lifecycle for the cloudflared container: stop + remove any existing
 *  copy, then create + start a fresh one with TUNNEL_TOKEN injected directly
 *  as an env var. We avoid the previous shell-wrapped env_file approach
 *  because cloudflare/cloudflared:latest is scratch-based — no /bin/sh — so
 *  the wrapper crashed with "exec /bin/sh: no such file or directory". This
 *  bypasses compose's profile gate entirely; the operator never needs to run
 *  `docker compose --profile tunnel up` for cloudflared. */
async function ensureCloudflaredRunning(connectorToken: string): Promise<void> {
  let docker: Docker;
  try {
    docker = new Docker();
  } catch (err) {
    // Fail CLOSED: if we can't reach the Docker socket we cannot start the
    // cloudflared container. Previously this returned void and the caller went
    // on to mark the tunnel 'connected' — a fail-open that misreports a tunnel
    // that was never actually running. Throw so provisionTunnel surfaces it.
    logger.error('docker socket unavailable; cannot start cloudflared', { err: String(err) });
    throw new Error('Docker socket unavailable — cannot start the cloudflared tunnel container');
  }
  const network = await detectNetworkName(docker);

  // Drop any existing container (compose-created or previous dockerode run)
  try {
    const existing = docker.getContainer(CLOUDFLARED_CONTAINER);
    await existing.stop({ t: 5 }).catch(() => {});
    await existing.remove({ force: true }).catch(() => {});
  } catch { /* didn't exist */ }

  // Pull image (no-op if cached). Best-effort — start anyway if pull fails
  // since the image may already be present from a prior compose-up.
  try {
    await new Promise<void>((resolve, reject) => {
      docker.pull('cloudflare/cloudflared:latest', (err: any, stream: NodeJS.ReadableStream | null) => {
        if (err) return reject(err);
        if (!stream) return resolve();
        docker.modem.followProgress(stream, (e: any) => e ? reject(e) : resolve());
      });
    });
  } catch (err) {
    logger.warn('cloudflared image pull failed; using cached if any', { err: String(err) });
  }

  const created = await docker.createContainer({
    name: CLOUDFLARED_CONTAINER,
    Image: 'cloudflare/cloudflared:latest',
    Cmd: ['tunnel', '--no-autoupdate', 'run'],
    Env: [`TUNNEL_TOKEN=${connectorToken}`],
    HostConfig: {
      NetworkMode: network,
      RestartPolicy: { Name: 'unless-stopped' },
    },
    Labels: {
      'com.docker.compose.project': 'darrow',
      'com.docker.compose.service': 'cloudflared',
    },
  });
  await created.start();
  logger.info('cloudflared started', { container: CLOUDFLARED_CONTAINER, network });
}

async function stopCloudflared(): Promise<void> {
  try {
    const docker = new Docker();
    const container = docker.getContainer(CLOUDFLARED_CONTAINER);
    await container.stop({ t: 5 }).catch(() => {});
    await container.remove({ force: true }).catch(() => {});
  } catch (err) {
    logger.warn('docker socket unavailable; cloudflared not stopped automatically', { err: String(err) });
  }
}

export interface ProvisionInput {
  apiToken: string;
  accountId: string;
  zoneId: string;
  zoneName: string;
  tunnelName: string;
  subdomain: string;
}

export interface ProvisionResult {
  fqdn: string;
  tunnel_id: string;
  status: 'connected' | 'pending';
}

/** Full provision flow. Throws on any step's failure with a user-friendly
 *  message; the route handler turns this into a 502 + error.message. */
export async function provisionTunnel(input: ProvisionInput): Promise<ProvisionResult> {
  // Re-verify token at provision time so a stale token surfaces here, not
  // later as a cryptic 401 from another endpoint.
  await verifyToken(input.apiToken);

  const fqdn = `${input.subdomain}.${input.zoneName}`;
  const tunnel = await createOrFindTunnel(input.apiToken, input.accountId, input.tunnelName);
  const connectorToken = await getConnectorToken(input.apiToken, input.accountId, tunnel.id);
  await setTunnelIngress(input.apiToken, input.accountId, tunnel.id, fqdn);
  await upsertCname(input.apiToken, input.zoneId, fqdn, tunnel.id);

  // Persist everything (encrypted) before kicking off the runtime.
  await sql`UPDATE settings SET
    tunnel_enabled = true,
    cf_api_token_enc = ${encryptTunnelSecret(input.apiToken)},
    cf_account_id = ${input.accountId},
    cf_zone_id = ${input.zoneId},
    cf_zone_name = ${input.zoneName},
    tunnel_name = ${input.tunnelName},
    tunnel_subdomain = ${input.subdomain},
    tunnel_id = ${tunnel.id},
    tunnel_token_enc = ${encryptTunnelSecret(connectorToken)},
    tunnel_status = 'provisioning',
    tunnel_last_error = NULL,
    tunnel_last_provisioned_at = now()
    WHERE id = 1`;

  writeCaddyfile({
    fqdn,
    apiHost: process.env.CADDY_API_HOST ?? 'api',
    apiPort: Number(process.env.CADDY_API_PORT ?? config.PORT),
    webHost: process.env.CADDY_WEB_HOST ?? 'web',
    webPort: Number(process.env.CADDY_WEB_PORT ?? 80),
  });

  // Reload Caddy first (idempotent), then (re-)create cloudflared with the
  // new connector token injected as an env var.
  await reloadCaddy().catch((err) => {
    logger.warn('caddy reload failed at provision; will retry at next save', { err: String(err) });
  });
  await ensureCloudflaredRunning(connectorToken);

  await sql`UPDATE settings SET tunnel_status = 'connected' WHERE id = 1`;
  return { fqdn, tunnel_id: tunnel.id, status: 'connected' };
}

export async function disableTunnel(): Promise<void> {
  const row = await loadTunnelSettings();
  // A rotated/lost TUNNEL_ENC_KEY makes getApiToken throw. Don't let that abort
  // teardown — we still want to stop the local container and clear DB state.
  // Without the token we just skip the (optional) Cloudflare-side cleanup.
  let token: string | null = null;
  try {
    token = getApiToken(row);
  } catch (err) {
    logger.warn('could not decrypt CF API token during disable; skipping Cloudflare-side cleanup', { err: String(err) });
  }
  await stopCloudflared();
  if (token && row.tunnel_id && row.cf_account_id) {
    if (row.cf_zone_id && row.tunnel_subdomain && row.cf_zone_name) {
      await deleteCname(token, row.cf_zone_id, fqdnOf(row)!).catch((err) => {
        logger.warn('cname delete failed (continuing)', { err: String(err) });
      });
    }
    await deleteTunnel(token, row.cf_account_id, row.tunnel_id).catch((err) => {
      logger.warn('tunnel delete failed (continuing — connections may still be open)', { err: String(err) });
    });
  }
  removeCaddyfile();
  await sql`UPDATE settings SET
    tunnel_enabled = false,
    tunnel_token_enc = NULL,
    tunnel_id = NULL,
    tunnel_status = 'disabled',
    tunnel_last_error = NULL
    WHERE id = 1`;
}

/** Public read of tunnel status — never exposes encrypted blobs or tokens. */
export async function tunnelStatus() {
  const row = await loadTunnelSettings();
  return {
    enabled: row.tunnel_enabled,
    status: row.tunnel_status,
    last_error: row.tunnel_last_error,
    last_provisioned_at: row.tunnel_last_provisioned_at,
    fqdn: fqdnOf(row),
    subdomain: row.tunnel_subdomain,
    zone_name: row.cf_zone_name,
    tunnel_name: row.tunnel_name,
    api_token_set: !!row.cf_api_token_enc,
    account_id: row.cf_account_id,
    zone_id: row.cf_zone_id,
    tunnel_id: row.tunnel_id,
  };
}

/** Re-export for use by other services (e.g., to detect CF API errors). */
export { CfError };
