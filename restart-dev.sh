#!/bin/bash
cd /Users/udhayaprakashharitha/timeblock

echo "Stopping old servers..."
for port in 3001 5173 5174; do
  pids=$(lsof -t -iTCP:$port -sTCP:LISTEN 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "  kill port $port -> $pids"
    kill -9 $pids 2>/dev/null || true
  fi
done
pkill -9 -f "nest start" 2>/dev/null || true
pkill -9 -f "vite" 2>/dev/null || true
sleep 2

echo "Starting API on :3001..."
cd /Users/udhayaprakashharitha/timeblock/apps/server
npm run dev > /tmp/timeblock-api.log 2>&1 &
API_PID=$!

echo "Starting Web on :5173..."
cd /Users/udhayaprakashharitha/timeblock/apps/web
npm run dev -- --host 127.0.0.1 --port 5173 > /tmp/timeblock-web.log 2>&1 &
WEB_PID=$!

sleep 5
echo ""
echo "API log (tail):"
tail -15 /tmp/timeblock-api.log
echo ""
echo "Web log (tail):"
tail -15 /tmp/timeblock-web.log
echo ""
lsof -nP -iTCP:3001 -sTCP:LISTEN || echo "API not listening"
lsof -nP -iTCP:5173 -sTCP:LISTEN || echo "Web not listening"
echo ""
echo "Open http://localhost:5173/?mode=signup"
echo "Done. Logs: /tmp/timeblock-api.log /tmp/timeblock-web.log"
