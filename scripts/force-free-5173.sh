#!/bin/bash
set -euo pipefail
PIDS=$(lsof -nP -iTCP:5173 -sTCP:LISTEN -t 2>/dev/null || true)
if [ -n "${PIDS:-}" ]; then
  echo "Killing: $PIDS"
  kill -9 $PIDS || true
  sleep 1
fi
lsof -nP -iTCP:5173 -sTCP:LISTEN || echo "5173 FREE"
cd "$(dirname "$0")/../apps/web"
npm run dev -- --host localhost --port 5173 --strictPort
