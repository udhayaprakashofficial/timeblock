#!/bin/bash
cd /Users/udhayaprakashharitha/timeblock
echo "Stopping servers on 3001 / 5173 / 5174..."
for port in 3001 5173 5174; do
  pids=$(lsof -t -iTCP:$port -sTCP:LISTEN 2>/dev/null || true)
  if [ -n "$pids" ]; then
    kill -9 $pids 2>/dev/null || true
  fi
done
pkill -9 -f "nest start" 2>/dev/null || true
pkill -9 -f "vite" 2>/dev/null || true
sleep 2

cd apps/server
npm run dev > /tmp/timeblock-api.log 2>&1 &
cd ../web
npm run dev -- --host 127.0.0.1 --port 5173 > /tmp/timeblock-web.log 2>&1 &
sleep 6
echo ""
echo "=== Status ==="
lsof -nP -iTCP:3001 -sTCP:LISTEN || echo "API not up"
lsof -nP -iTCP:5173 -sTCP:LISTEN || echo "Web not on 5173"
tail -8 /tmp/timeblock-web.log
echo ""
echo "Open: http://localhost:5173/?mode=signup"
echo "Press Enter to close..."
read
