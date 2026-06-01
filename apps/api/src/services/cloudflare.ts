// Cloudflare API v4 client — just enough to provision a tunnel, push ingress,
// and create a CNAME for the chosen subdomain. Mirrors what the Appliance
// console does via shell + curl, but in-process.
//
// Token mode: the admin enters a *user* API token scoped to "Tunnel: Edit",
// "Zone:DNS: Edit", "Account Settings: Read". /user/tokens/verify confirms
// the token is live before we use it.

const CF_BASE = 'https://api.cloudflare.com/client/v4';

class CfError extends Error {
  constructor(message: string, public readonly status: number, public readonly cf?: unknown) {
    super(message);
  }
}

async function cf<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${CF_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  let body: any;
  try { body = await res.json(); } catch { body = null; }
  if (!res.ok || (body && body.success === false)) {
    const msg = body?.errors?.[0]?.message ?? `Cloudflare API ${res.status}`;
    throw new CfError(msg, res.status, body);
  }
  return body?.result as T;
}

export interface CfAccount { id: string; name: string; }
export interface CfZone { id: string; name: string; status: string; account: { id: string; name: string }; }
export interface CfTunnel { id: string; name: string; account_tag: string; status: string; }

export async function verifyToken(token: string): Promise<{ id: string; status: string }> {
  return cf(token, '/user/tokens/verify');
}

export async function listAccounts(token: string): Promise<CfAccount[]> {
  return cf(token, '/accounts?per_page=50');
}

export async function listZones(token: string, accountId?: string): Promise<CfZone[]> {
  const qs = accountId ? `?account.id=${accountId}&per_page=50` : '?per_page=50';
  return cf(token, `/zones${qs}`);
}

/** Find an existing tunnel by name, or create one. Returns the tunnel + the
 *  random tunnel_secret (base64) which Cloudflare requires at create time. */
export async function createOrFindTunnel(
  token: string,
  accountId: string,
  name: string,
): Promise<CfTunnel> {
  const existing = await cf<CfTunnel[]>(token, `/accounts/${accountId}/cfd_tunnel?name=${encodeURIComponent(name)}&is_deleted=false`);
  if (Array.isArray(existing) && existing.length > 0) return existing[0];
  // Tunnel secret is a 32-byte base64. Cloudflare validates length.
  const tunnelSecret = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
  return cf(token, `/accounts/${accountId}/cfd_tunnel`, {
    method: 'POST',
    body: JSON.stringify({ name, tunnel_secret: tunnelSecret, config_src: 'cloudflare' }),
  });
}

/** Connector token (long-lived) used by cloudflared's `tunnel run --token …`. */
export async function getConnectorToken(token: string, accountId: string, tunnelId: string): Promise<string> {
  return cf(token, `/accounts/${accountId}/cfd_tunnel/${tunnelId}/token`);
}

/** Push ingress config: one rule routes <hostname> to the internal Caddy
 *  service over HTTPS with the self-signed cert (noTLSVerify=true). A catch-all
 *  http_status:404 rule terminates the chain (Cloudflare requires one). */
export async function setTunnelIngress(
  token: string,
  accountId: string,
  tunnelId: string,
  hostname: string,
  originService = 'https://caddy:443',
): Promise<void> {
  await cf(token, `/accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`, {
    method: 'PUT',
    body: JSON.stringify({
      config: {
        ingress: [
          {
            hostname,
            service: originService,
            originRequest: { originServerName: hostname, noTLSVerify: true },
          },
          { service: 'http_status:404' },
        ],
      },
    }),
  });
}

/** Upsert a proxied CNAME `subdomain.zone -> <tunnel_id>.cfargotunnel.com`. */
export async function upsertCname(
  token: string,
  zoneId: string,
  hostname: string,
  tunnelId: string,
): Promise<void> {
  const target = `${tunnelId}.cfargotunnel.com`;
  const existing = await cf<any[]>(token, `/zones/${zoneId}/dns_records?type=CNAME&name=${encodeURIComponent(hostname)}`);
  if (Array.isArray(existing) && existing.length > 0) {
    const rec = existing[0];
    await cf(token, `/zones/${zoneId}/dns_records/${rec.id}`, {
      method: 'PUT',
      body: JSON.stringify({ type: 'CNAME', name: hostname, content: target, proxied: true, ttl: 1 }),
    });
  } else {
    await cf(token, `/zones/${zoneId}/dns_records`, {
      method: 'POST',
      body: JSON.stringify({ type: 'CNAME', name: hostname, content: target, proxied: true, ttl: 1 }),
    });
  }
}

export async function deleteCname(token: string, zoneId: string, hostname: string): Promise<void> {
  const existing = await cf<any[]>(token, `/zones/${zoneId}/dns_records?type=CNAME&name=${encodeURIComponent(hostname)}`);
  for (const rec of existing ?? []) {
    await cf(token, `/zones/${zoneId}/dns_records/${rec.id}`, { method: 'DELETE' });
  }
}

export async function deleteTunnel(token: string, accountId: string, tunnelId: string): Promise<void> {
  // Cleanup connections first; otherwise CF 403s.
  await cf(token, `/accounts/${accountId}/cfd_tunnel/${tunnelId}/connections`, { method: 'DELETE' }).catch(() => {});
  await cf(token, `/accounts/${accountId}/cfd_tunnel/${tunnelId}`, { method: 'DELETE' });
}

export { CfError };
