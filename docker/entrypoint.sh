#!/usr/bin/env bash
# Runs migrations on boot, then starts the API + workers concurrently.
set -euo pipefail
echo "[entrypoint] running migrations…"
node packages/db/dist/migrate.js
echo "[entrypoint] starting api + workers…"
node apps/api/dist/index.js &
API_PID=$!
node packages/workers/dist/index.js &
WORKERS_PID=$!
# Forward signals and exit if either dies.
trap 'kill $API_PID $WORKERS_PID 2>/dev/null || true' TERM INT
wait -n $API_PID $WORKERS_PID
echo "[entrypoint] a process exited; shutting down"
kill $API_PID $WORKERS_PID 2>/dev/null || true
exit 1
