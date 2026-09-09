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
import { execSync } from 'node:child_process';

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
  'biomarkers.json',
  'fda-cdx.json',
  'announcements.json',
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
    try { const d = JSON.parse(readFileSync(join(src, f), 'utf8')); drugs[d.slug] = { brand: d.brand, inn: d.inn, ...(d.match ? { match: d.match, usGeneric: d.usGeneric || null } : {}) }; } catch { /* skip */ }
  }
  const idxFile = join(root, indexName);
  const stamp = existsSync(idxFile) ? (JSON.parse(readFileSync(idxFile, 'utf8')).generated || 'dev') : 'dev';
  writeFileSync(join(outDir, indexName), JSON.stringify({ generated: stamp, count: files.length, drugs }));
  console.log(`[copy-data] published ${files.length} ${outSub.toUpperCase()} files + manifest`);
  const matches = {};
  for (const d of Object.values(drugs)) if (d.match) matches[d.match] = (matches[d.match] || 0) + 1;
  return { generated: stamp, count: files.length, ...(Object.keys(matches).length ? { matches } : {}) };
};
const smpc = publishLabels('smpc-data', 'smpc', 'smpc-index.json');
const uspi = publishLabels('uspi-data', 'uspi', 'uspi-index.json');

// Release manifest: the runtime snapshots (FILES) are only ever applied TOGETHER
// (services/liveData.ts checks every file's hash against this list), so a half-
// updated set — new regulatory catalogue beside an old biomarker list — can not
// be assembled from mixed CDN caches or partial downloads. The rest of the
// manifest is provenance: which pipeline commit built it, from which raw
// inputs (hashes written by scripts/build-ema-data.py), with which counts —
// so any published release can be traced back to its sources.
{
  const { createHash } = await import('node:crypto');
  const files = {};
  for (const f of FILES) files[f] = createHash('sha256').update(readFileSync(join(outDir, f))).digest('hex');
  const generated = new Date().toISOString();
  const readJson = (f) => { try { return JSON.parse(readFileSync(join(root, f), 'utf8')); } catch { return null; } };
  const ema = readJson('ema-medicines.json') || {};
  const cgt = readJson('cgt-products.json') || {};
  const bm = readJson('biomarkers.json') || {};
  const cdx = readJson('fda-cdx.json') || {};
  const sources = existsSync(join(root, 'scripts', '.sources.json')) ? readJson('scripts/.sources.json') : undefined;
  let commit = process.env.GITHUB_SHA;
  if (!commit) { try { commit = execSync('git rev-parse HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { commit = undefined; } }
  const manifest = {
    id: generated.slice(0, 19).replace(/[-:T]/g, ''),
    generated,
    commit,
    files,
    counts: {
      emaAuthorised: (ema.authorised || []).length, emaPending: (ema.pipeline || []).length, emaWithdrawn: (ema.gone || []).length,
      emaReportDate: ema.generated, cgtProducts: Object.keys(cgt).length, biomarkers: (bm.biomarkers || []).length,
      cdxAuthorisations: cdx.total, cdxListDate: cdx.listDate,
    },
    labels: { smpc, uspi },
    ...(sources ? { sources } : {}),
  };
  writeFileSync(join(outDir, 'release.json'), JSON.stringify(manifest));
  console.log(`[copy-data] release manifest for ${FILES.length} snapshots (commit ${(commit || 'unknown').slice(0, 7)}${sources ? ', with source hashes' : ''})`);
}
