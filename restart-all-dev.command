#!/bin/bash
set -e
cd /Users/udhayaprakashharitha/timeblock
echo "=== Killing old servers ==="
for port in 5173 5174 5175 5180 5199 3001; do
  for pid in $(lsof -t -iTCP:$port -sTCP:LISTEN 2>/dev/null); do
    echo "  kill $pid (port $port)"
    kill -9 "$pid" 2>/dev/null || true
  done
done
pkill -9 -f "vite" 2>/dev/null || true
pkill -9 -f "nest start" 2>/dev/null || true
sleep 2
echo "=== Ports after kill ==="
lsof -nP -iTCP:5173,3001 -sTCP:LISTEN 2>/dev/null || echo "5173/3001 free"

echo "=== Starting API :3001 ==="
cd /Users/udhayaprakashharitha/timeblock/apps/server
npm run dev &
API_PID=$!
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3001/api/users/auth-config 2>/dev/null | grep -q 200; then
    echo "API up"
    break
  fi
  sleep 1
done

echo "=== Starting Vite :5173 ==="
cd /Users/udhayaprakashharitha/timeblock/apps/web
exec npm run dev
