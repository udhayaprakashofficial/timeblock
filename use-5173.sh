#!/bin/bash
# Free :5173 and start Timeblock web+API for local testing
set -e
cd "$(dirname "$0")"

echo "=== Killing ports 5173 / 5201 / 3001 ==="
for port in 5173 5201 3001 5174 5175 5180 5199; do
  for pid in $(lsof -t -iTCP:$port -sTCP:LISTEN 2>/dev/null); do
    echo "  kill $pid (port $port)"
    kill -9 "$pid" 2>/dev/null || true
  done
done
pkill -9 -f "vite" 2>/dev/null || true
pkill -9 -f "nest start" 2>/dev/null || true
sleep 2

if lsof -nP -iTCP:5173 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "ERROR: 5173 still in use:"
  lsof -nP -iTCP:5173 -sTCP:LISTEN
  exit 1
fi
echo "5173 is free."

echo "=== Starting API on :3001 ==="
(cd apps/server && npm run dev) &
for i in $(seq 1 20); do
  if curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3001/api/users/auth-config 2>/dev/null | grep -q 200; then
    echo "API ready"
    break
  fi
  sleep 0.5
done

echo "=== Starting Vite on http://localhost:5173 ==="
cd apps/web
exec npx vite --host localhost --port 5173 --strictPort
