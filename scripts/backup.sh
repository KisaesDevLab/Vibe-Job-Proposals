#!/usr/bin/env bash
# Nightly backup: pg_dump (custom format) + tar of /storage -> one timestamped .tar.gz.
# Redis is intentionally NOT backed up (sessions + transient queues only).
set -euo pipefail
BACKUP_DIR="${BACKUP_DIR:-/storage/backups}"
DATABASE_URL="${DATABASE_URL:?set DATABASE_URL}"
STORAGE_ROOT="${STORAGE_ROOT:-/storage}"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
WORK="$(mktemp -d)"
echo "[backup] pg_dump…"
pg_dump --format=custom --file="$WORK/db.dump" "$DATABASE_URL"
echo "[backup] tar storage (excluding backups dir)…"
tar --exclude="${STORAGE_ROOT#/}/backups" -czf "$WORK/storage.tar.gz" -C "$(dirname "$STORAGE_ROOT")" "$(basename "$STORAGE_ROOT")" || true
OUT="$BACKUP_DIR/darrow-backup-$STAMP.tar.gz"
tar -czf "$OUT" -C "$WORK" db.dump storage.tar.gz
rm -rf "$WORK"
echo "[backup] wrote $OUT"
# 30-day retention
find "$BACKUP_DIR" -name 'darrow-backup-*.tar.gz' -mtime +30 -delete
