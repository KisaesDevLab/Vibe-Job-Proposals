-- Cloudflare Tunnel + Caddy configuration for self-hosted deployments.
-- Admin configures via Settings UI; the api writes a 0600 env_file for the
-- cloudflared service and renders the Caddyfile to a shared volume.
-- Tokens are AES-256-GCM encrypted at rest (key from TUNNEL_ENC_KEY env).
ALTER TABLE settings
  ADD COLUMN tunnel_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN cf_api_token_enc text,
  ADD COLUMN cf_account_id text,
  ADD COLUMN cf_zone_id text,
  ADD COLUMN cf_zone_name text,
  ADD COLUMN tunnel_name text,
  ADD COLUMN tunnel_subdomain text,
  ADD COLUMN tunnel_id text,
  ADD COLUMN tunnel_token_enc text,
  ADD COLUMN tunnel_status text NOT NULL DEFAULT 'disabled',
  ADD COLUMN tunnel_last_error text,
  ADD COLUMN tunnel_last_provisioned_at timestamptz;
