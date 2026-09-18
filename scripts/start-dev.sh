#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "Starting Timeblock (API :3001 + Web :5173)"
echo "Ensure apps/server/.env has GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET set."
echo ""

# Free ports if stale processes are holding them
for port in 3001 5173; do
  if lsof -ti ":$port" >/dev/null 2>&1; then
    lsof -ti ":$port" | xargs kill -9 2>/dev/null || true
  fi
done

npm run build -w @timeblock/shared-types >/dev/null
npm run dev
