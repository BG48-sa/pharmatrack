// Publish the bundled snapshot JSON as fetchable static files.
//
// The services import these JSON files directly (baked into the JS bundle as an
// offline fallback). This step ALSO copies them into public/data/ so Vite emits
// them as plain files at /data/<file>, letting the app fetch the freshest copy
// at runtime (see services/liveData.ts) — the key to keeping the native App
// Store build current without a resubmission.
//
// Runs as part of `npm run build` (see package.json), so web and iOS builds and
// deploy-pages.sh all stay in sync.
import { mkdirSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const outDir = join(root, 'public', 'data');

const FILES = [
  'ema-medicines.json',
  'novel-approvals.json',
  'pdufa.json',
  'critical-medicines.json',
  'cgt-products.json',
];

mkdirSync(outDir, { recursive: true });
for (const f of FILES) copyFileSync(join(root, f), join(outDir, f));
console.log(`[copy-data] published ${FILES.length} snapshots to public/data/`);
