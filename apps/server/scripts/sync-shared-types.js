/**
 * Copies packages/shared-types into apps/server when the monorepo package exists.
 * On Vercel (or any deploy that only has apps/server), the committed copy is used as-is.
 */
const fs = require('fs');
const path = require('path');

const dest = path.join(__dirname, '..', 'src', 'shared-types', 'index.ts');
const candidates = [
  path.join(__dirname, '..', '..', '..', 'packages', 'shared-types', 'src', 'index.ts'),
  path.join(__dirname, '..', '..', 'packages', 'shared-types', 'src', 'index.ts'),
];

const src = candidates.find((p) => fs.existsSync(p));
if (!src) {
  if (fs.existsSync(dest)) {
    console.log('[sync-shared-types] monorepo package missing; using committed server copy');
    process.exit(0);
  }
  console.error('[sync-shared-types] shared-types source not found');
  process.exit(1);
}

fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.copyFileSync(src, dest);
console.log('[sync-shared-types] synced from', src);
