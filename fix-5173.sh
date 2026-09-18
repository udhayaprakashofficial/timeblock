#!/bin/bash
set -e
echo "Killing anything on 5173 / 5174 / 5175 / 5180..."
for port in 5173 5174 5175 5180; do
  for pid in $(lsof -t -iTCP:$port -sTCP:LISTEN 2>/dev/null); do
    echo "  kill $pid"
    kill -9 "$pid" 2>/dev/null || true
  done
done
pkill -9 -f "vite" 2>/dev/null || true
sleep 2
cd /Users/udhayaprakashharitha/timeblock/apps/web
echo "Starting Vite on http://127.0.0.1:5173 ..."
exec npm run dev
