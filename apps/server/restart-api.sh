#!/bin/zsh
set -e
cd "$(dirname "$0")"
echo "Stopping anything on :3001..."
kill -9 $(lsof -t -iTCP:3001 -sTCP:LISTEN) 2>/dev/null || true
sleep 1
echo "Testing Supabase REST (HTTPS)..."
node -e "
require('dotenv').config();
const url=(process.env.SUPABASE_URL||'').replace(/\\/\$/,'');
const key=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_PUBLISHABLE_KEY||'';
if(!url||!key){console.error('Missing SUPABASE_URL / SUPABASE_SECRET_KEY'); process.exit(0);}
fetch(url+'/rest/v1/User?select=id&limit=1',{headers:{apikey:key,Authorization:'Bearer '+key}})
  .then(async r=>{const t=await r.text(); console.log(r.ok?'Supabase REST OK':'REST '+r.status, t.slice(0,120));})
  .catch(e=>console.error('Supabase REST unreachable:', e.cause?.code||e.message));
" || true
if [ -f data/local-users.json ]; then
  echo "Pushing local users to Supabase..."
  node scripts/push-local-to-supabase.js || echo "(push skipped — run manually when online)"
fi
echo "Starting API..."
exec npm run dev
