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
