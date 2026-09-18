#!/bin/bash
# Kill whatever is holding port 5173
set -e
echo "Processes on 5173:"
lsof -nP -iTCP:5173 -sTCP:LISTEN || true
for pid in $(lsof -t -iTCP:5173 -sTCP:LISTEN 2>/dev/null); do
  echo "Killing PID $pid..."
  kill -9 "$pid"
done
sleep 1
if lsof -nP -iTCP:5173 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Still in use:"
  lsof -nP -iTCP:5173 -sTCP:LISTEN
  exit 1
fi
echo "5173 is free."
