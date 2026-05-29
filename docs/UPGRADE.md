# Upgrade Procedure

Migrations are **always run before** the new image boots (the entrypoint runs them).

1. **Back up** (`scripts/backup.sh`).
2. Pull the new image: `docker compose -f docker/docker-compose.prod.yml pull app`.
3. Recreate: `docker compose -f docker/docker-compose.prod.yml up -d`.
   The entrypoint applies any new numbered migrations (`packages/db/migrations/*.sql`)
   idempotently, then starts api + workers.
4. Confirm `/api/health` returns all deps up and the `version` matches.

Migrations are forward-only and committed; never hand-edit an applied migration. To add a
schema change, add the next `NNNN_*.sql` file and commit it.

## Rollback
Restore the pre-upgrade backup (`scripts/restore.sh`) and redeploy the previous image tag.
