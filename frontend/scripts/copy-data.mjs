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
import { mkdirSync, copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
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
  'disease-entities.json',
];

mkdirSync(outDir, { recursive: true });
for (const f of FILES) copyFileSync(join(root, f), join(outDir, f));
console.log(`[copy-data] published ${FILES.length} snapshots to public/data/`);

// Full-text label corpora (EU SmPC + US USPI): per-drug JSON + a manifest
// GENERATED from the files actually present, so a manifest can never claim a
// drug the bundle lacks (or miss one) even if an extractor was interrupted.
const publishLabels = (srcDir, outSub, indexName) => {
  const src = join(root, srcDir);
  if (!existsSync(src)) return;
  const out = join(outDir, outSub);
  mkdirSync(out, { recursive: true });
  const files = readdirSync(src).filter((f) => f.endsWith('.json'));
  const drugs = {};
  for (const f of files) {
    copyFileSync(join(src, f), join(out, f));
    try { const d = JSON.parse(readFileSync(join(src, f), 'utf8')); drugs[d.slug] = { brand: d.brand, inn: d.inn }; } catch { /* skip */ }
  }
  const idxFile = join(root, indexName);
  const stamp = existsSync(idxFile) ? (JSON.parse(readFileSync(idxFile, 'utf8')).generated || 'dev') : 'dev';
  writeFileSync(join(outDir, indexName), JSON.stringify({ generated: stamp, count: files.length, drugs }));
  console.log(`[copy-data] published ${files.length} ${outSub.toUpperCase()} files + manifest`);
};
publishLabels('smpc-data', 'smpc', 'smpc-index.json');
publishLabels('uspi-data', 'uspi', 'uspi-index.json');
