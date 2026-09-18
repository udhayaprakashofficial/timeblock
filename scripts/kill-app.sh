#!/bin/bash
# Kill Timeblock web (5173) + API (3001) and related Vite/preview listeners.
set -euo pipefail
PORTS='5173,3001,4173,5210,5174,5199'
echo "Stopping listeners on: $PORTS"
PIDS=$(lsof -nP -iTCP:"$PORTS" -sTCP:LISTEN -t 2>/dev/null | sort -u || true)
if [[ -z "${PIDS}" ]]; then
  echo "Nothing listening — already stopped."
  exit 0
fi
echo "Killing PIDs: $PIDS"
# shellcheck disable=SC2086
kill -9 $PIDS 2>/dev/null || true
sleep 1
if lsof -nP -iTCP:"$PORTS" -sTCP:LISTEN 2>/dev/null; then
  echo "Some processes still running (permission denied?). Run this in your own Terminal."
  exit 1
fi
echo "Stopped."
