#!/usr/bin/env bash
# Restore a backup archive produced by backup.sh.
# Usage: restore.sh <archive.tar.gz>
set -euo pipefail
ARCHIVE="${1:?usage: restore.sh <archive.tar.gz>}"
DATABASE_URL="${DATABASE_URL:?set DATABASE_URL}"
STORAGE_ROOT="${STORAGE_ROOT:-/storage}"
WORK="$(mktemp -d)"
tar -xzf "$ARCHIVE" -C "$WORK"
echo "[restore] restoring database (drops & recreates objects)…"
pg_restore --clean --if-exists --no-owner --dbname="$DATABASE_URL" "$WORK/db.dump"
echo "[restore] restoring /storage…"
tar -xzf "$WORK/storage.tar.gz" -C "$(dirname "$STORAGE_ROOT")"
rm -rf "$WORK"
echo "[restore] done"
