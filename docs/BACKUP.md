# Backup & Restore

## What is backed up
- **PostgreSQL** — full database via `pg_dump --format=custom`.
- **/storage** — branding, attachments, generated invoices, imports.

**Redis is intentionally NOT backed up** — it holds only sessions and transient job
queues. Losing it logs users out and drops in-flight jobs; no business data is lost.

## Nightly backup (cron)
```
0 2 * * *  DATABASE_URL=postgres://… STORAGE_ROOT=/storage BACKUP_DIR=/storage/backups \
           bash /app/scripts/backup.sh >> /var/log/darrow-backup.log 2>&1
```
Each run writes `darrow-backup-YYYYMMDD-HHMMSS.tar.gz` and prunes archives older than 30
days.

## Restore
```
DATABASE_URL=postgres://… STORAGE_ROOT=/storage bash scripts/restore.sh <archive.tar.gz>
```
This drops & recreates DB objects (`pg_restore --clean --if-exists`) and unpacks
`/storage`. Run with the app stopped, then start it (migrations run on boot).

## Verify a backup
Restore into a scratch database periodically and confirm `/api/health` + a sample invoice
render.
