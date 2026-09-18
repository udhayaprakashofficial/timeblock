#!/usr/bin/env bash
# Create all Timeblock tables on Supabase.
# Run this on your Mac Terminal (not inside Cursor sandbox):
#
#   cd /Users/udhayaprakashharitha/timeblock/apps/server
#   ./scripts/push-supabase.sh
#
set -euo pipefail
cd "$(dirname "$0")/.."

export DATABASE_URL="${DATABASE_URL:-postgresql://postgres:Udhayaprakash%40123@db.dkwrmgmfhijimuvsewgz.supabase.co:5432/postgres?sslmode=require}"

echo "Pushing schema to Supabase…"
npx prisma db push
echo "Done. Check Supabase → Table Editor for: User, Task, Session, …"
