#!/bin/bash
cd "$(dirname "$0")/.." || exit 1
echo "Freeing port 5173…"
PIDS=$(lsof -nP -iTCP:5173 -sTCP:LISTEN -t 2>/dev/null || true)
if [[ -n "${PIDS}" ]]; then
  kill -9 ${PIDS} 2>/dev/null || true
  sleep 1
fi
rm -rf apps/web/node_modules/.vite
echo "Starting Vite on http://localhost:5173 …"
cd apps/web
exec npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
