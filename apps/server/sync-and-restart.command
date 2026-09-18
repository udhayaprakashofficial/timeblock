#!/bin/bash
cd "$(dirname "$0")"
node scripts/push-local-to-supabase.js
kill -9 $(lsof -t -iTCP:3001 -sTCP:LISTEN) 2>/dev/null || true
sleep 1
exec npm run dev
