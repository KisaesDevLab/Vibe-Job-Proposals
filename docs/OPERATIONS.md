# Operations Guide

## Architecture

- **api** (Express) and **workers** (BullMQ) run in one container (`docker/entrypoint.sh`
  starts both after running migrations). The API also serves the built React SPA in
  production.
- **Postgres 16** holds all data; **Redis 7** holds sessions + job queues.
- **/storage** (a mounted volume) holds branding, expense attachments, generated
  invoices, imports, and backups.

## Logs

All services log JSON to stdout: `docker compose -f docker/docker-compose.prod.yml logs -f app`.

## Common issues

- **PDF / docx conversion fails** — the runtime needs `libreoffice-writer` (the Dockerfile
  installs it). Symptom in dev: "source file could not be loaded". Each conversion runs
  with an isolated `HOME` to avoid LibreOffice profile contention. A boot-time smoke
  conversion is logged ("LibreOffice smoke conversion OK").
- **Image→PDF fails** — check sharp/libheif; HEIC support is probed at boot
  ("media probe" log line). If HEIC is unsupported, `.heic` uploads are rejected with a
  clear message; share as JPG/PDF instead.
- **Session loss** — sessions live in Redis; restarting Redis logs everyone out (expected;
  Redis is not backed up).

## Precedence & data conventions

- **Markup precedence:** invoice override → customer default → settings default → 0.
- **Effective-dated tables** use half-open `[effective_from, effective_to)` intervals;
  `effective_to = NULL` means currently active. Enforced by `EXCLUDE USING gist`
  constraints (requires `btree_gist`) on `employee_cost_rates` and `rate_schedules`.
- **Invoice sequence:** per-job, assigned at finalize. `MAX(sequence_number)` is taken
  over **all** invoices for the job including voided ones, so a voided `.01` is never
  reused — a reissue becomes `.02`.
- **Immutable snapshot:** at finalize, every line + the header `total_*` columns are
  persisted; renderer and reports read the snapshot, never recompute from rate tables.
- **Job code prefix convention** (historical only; new codes are free-form):
  `D{YY}{CUST}{SEQ}` — `D` = Darrow, `YY` = year, `CUST` = customer code
  (`J/B/NB/SC/D/G/EP/DS`), `SEQ` = sequence. A `.NN` suffix is a historical billed
  reference, not part of the job code.

## Historical import procedure (Phase 18)

1. **Back up first** (`scripts/backup.sh`).
2. Dry run: `npm run import:xlsm -- <path.xlsm> --dry-run`.
3. Review the report (`/storage/imports/*.log` + `docs/sample-import-report.md`).
4. Run for real: `npm run import:xlsm -- <path.xlsm>`.
5. **Manually set every employee cost rate** (imported at 0, flagged "REQUIRES manual
   entry") and **review every derived rate schedule** (flagged "REVIEW before issuing new
   invoices") before issuing any new invoice. The Readiness dashboard surfaces both.
6. Reconcile any **placeholder customers** created for unmapped job codes.

Imported historical invoices show a "Historical" badge and have null docx/pdf paths;
use **Regenerate** (with a template uploaded) to produce documents.

## Deferred reports (v2)

WIP-by-job, job profitability (cost vs bill), and employee summary across jobs are not in
v1.

## Reverse proxy

The app sets `trust proxy: 1` and rate-limits by client IP, so it must run behind **exactly one** reverse proxy (e.g. the Caddy example). Running it directly internet-facing, or behind two proxies, lets clients spoof `X-Forwarded-For` and bypass the login/upload rate limits.

## Security & firewall

- Only ports 80/443 should be exposed; terminate TLS at a reverse proxy
  (`docker/examples/Caddyfile`). The app container exposes only 3000.
- Uploads are validated by content-type sniffing, not extension.
- `/storage` is `0700`; files are written `0600`.

## Cloudflare Tunnel + Caddy (built-in, configured via UI)

The production stack (`docker/docker-compose.prod.yml`) ships a **Caddy** service
and a **cloudflared** service alongside the app. They are inert until the
admin configures the tunnel from **Settings → Remote access**.

**Prereqs for the operator:**
- A Cloudflare account that owns the public DNS zone (e.g. `example.com`).
- A user API token at <https://dash.cloudflare.com/profile/api-tokens> with:
  - **Account → Cloudflare Tunnel: Edit**
  - **Zone → DNS: Edit**
  - **Account → Account Settings: Read**
- `TUNNEL_ENC_KEY` set in the app's environment (64 hex chars / 32 bytes).
  Generate with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.

**First-time bootstrap UX:**
1. `docker compose -f docker/docker-compose.prod.yml up -d` — the api comes up
   on port 3000. Caddy is up but idle (no Caddyfile yet). cloudflared has
   exited because no `tunnel.env` exists yet.
2. Visit `http://<host-ip>:3000`, log in with the bootstrapped admin user.
3. **Settings → Remote access** → paste the Cloudflare API token → **Verify**.
4. Pick the account + zone, enter a **subdomain** (e.g. `darrow`) and a
   **tunnel name** (e.g. `darrow-time-invoicing`). Click **Provision**.
5. The api will:
   - Create (or find) the tunnel in Cloudflare
   - Fetch the connector token + write `/storage/cloudflared/tunnel.env` (0600)
   - Push the ingress config to Cloudflare (`subdomain.zone` → `caddy:443`)
   - Upsert a proxied CNAME record on the zone
   - Render `/storage/caddy/Caddyfile` + reload Caddy via its admin API
   - Restart cloudflared via the mounted Docker socket
6. Within ~10 seconds, `https://subdomain.zone` is reachable from the public
   internet through the tunnel.

**Trust model:**
- Both the Cloudflare API token and the connector token are persisted **AES-256-GCM
  encrypted** in `settings.cf_api_token_enc` / `settings.tunnel_token_enc` using
  `TUNNEL_ENC_KEY`. Losing the key means re-provisioning.
- The connector token is also written to `/storage/cloudflared/tunnel.env` (0600)
  so cloudflared can read it at startup. The file is on a Docker volume.
- Caddy serves TLS internally with a self-signed CA; cloudflared accepts it
  via `noTLSVerify` + correct SNI. Public TLS is terminated at Cloudflare's edge.

**Disable / rotate:**
- **Disable tunnel** in the UI deletes the CNAME, deletes the Cloudflare tunnel,
  removes `tunnel.env`, removes the Caddyfile, and clears the encrypted tokens.
  Stop is best-effort if Docker socket is unreachable.
- To rotate the connector token: re-provision with the same name; Cloudflare
  returns the existing tunnel; a fresh connector token is fetched.

**Requires Docker socket access:** the api container in `docker-compose.prod.yml`
mounts `/var/run/docker.sock` so it can restart cloudflared after writing the
new env file. This is the standard pattern for self-managing tunnel apps; if
your environment forbids socket access, the operator must manually run
`docker compose -f docker/docker-compose.prod.yml restart cloudflared` after
each provision.

**Caveats / common issues:**
- **Outbound TCP 7844** from the host must be open for cloudflared to register
  with Cloudflare's edge.
- Once provisioned, the subdomain CNAME points at `<tunnel_id>.cfargotunnel.com`
  — leave it Proxied in the Cloudflare dashboard.
- Direct LAN access on port 3000 stays available for admin/IT use even with
  the tunnel running.
