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

import { mkdirSync, writeFileSync, renameSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
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

const CF_DIR = join(config.STORAGE_ROOT, 'cloudflared');
const CF_ENV = join(CF_DIR, 'tunnel.env');
const CLOUDFLARED_CONTAINER = process.env.CLOUDFLARED_CONTAINER ?? 'cloudflared';

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

/** Atomic-write the 0600 env_file consumed by the cloudflared container.
 *  The temp file lives in CF_DIR (not the OS tmpdir) because /tmp is on a
 *  different filesystem inside the container than /storage — rename across
 *  filesystems fails with EXDEV. Same dir = same filesystem = atomic rename. */
function writeConnectorEnv(connectorToken: string): void {
  mkdirSync(CF_DIR, { recursive: true, mode: 0o700 });
  const tmp = join(CF_DIR, `.tunnel.env.${randomBytes(6).toString('hex')}`);
  writeFileSync(tmp, `TUNNEL_TOKEN=${connectorToken}\n`, { mode: 0o600 });
  renameSync(tmp, CF_ENV);
}

function removeConnectorEnv(): void {
  if (existsSync(CF_ENV)) unlinkSync(CF_ENV);
}

/** Restart the cloudflared docker service so it picks up the new TUNNEL_TOKEN
 *  from the env_file. Best-effort: in dev where Docker isn't available, log
 *  and continue. */
async function restartCloudflared(): Promise<void> {
  try {
    const docker = new Docker();
    const container = docker.getContainer(CLOUDFLARED_CONTAINER);
    await container.restart({ t: 5 }).catch(async (err: any) => {
      // If the container doesn't exist (fresh deploy w/o cloudflared running),
      // attempt to start it via the compose-managed labels — best-effort.
      logger.warn('cloudflared restart failed; attempting start', { err: String(err) });
      await container.start().catch((e: any) => {
        throw new Error(`Could not start cloudflared container "${CLOUDFLARED_CONTAINER}": ${e.message}`);
      });
    });
    logger.info('cloudflared restarted', { container: CLOUDFLARED_CONTAINER });
  } catch (err) {
    // Docker socket not mounted (e.g., local dev without docker). Log and
    // continue — the provision flow has already persisted everything, so the
    // operator can restart the container manually.
    logger.warn('docker socket unavailable; cloudflared not restarted automatically', { err: String(err) });
  }
}

async function stopCloudflared(): Promise<void> {
  try {
    const docker = new Docker();
    const container = docker.getContainer(CLOUDFLARED_CONTAINER);
    await container.stop({ t: 5 }).catch(() => {});
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

  writeConnectorEnv(connectorToken);
  writeCaddyfile({
    fqdn,
    apiHost: process.env.CADDY_API_HOST ?? 'api',
    apiPort: Number(process.env.CADDY_API_PORT ?? config.PORT),
    webHost: process.env.CADDY_WEB_HOST ?? 'web',
    webPort: Number(process.env.CADDY_WEB_PORT ?? 80),
  });

  // Reload Caddy first (idempotent), then bounce cloudflared so it picks up
  // the new connector token.
  await reloadCaddy().catch((err) => {
    logger.warn('caddy reload failed at provision; will retry at next save', { err: String(err) });
  });
  await restartCloudflared();

  await sql`UPDATE settings SET tunnel_status = 'connected' WHERE id = 1`;
  return { fqdn, tunnel_id: tunnel.id, status: 'connected' };
}

export async function disableTunnel(): Promise<void> {
  const row = await loadTunnelSettings();
  const token = getApiToken(row);
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
  removeConnectorEnv();
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
