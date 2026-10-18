// Stamp the built service worker with the release id (post-build step).
//
// Browsers install a new service worker only when sw.js itself changes byte
// for byte. The app's update path (index.html: controllerchange → reload)
// therefore fired only when sw.js was edited by hand — a code-only deploy
// left every long-open DrugRadar Web window (Safari web app, pinned tab) on
// the previous bundle until the user reloaded it manually. Writing the
// release id into dist/sw.js makes every deploy a new worker: it installs,
// takes control (skipWaiting + clients.claim) and the page reloads itself
// once. public/sw.js stays unchanged in git — only the built copy is stamped.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, '..', 'dist');
const swPath = join(dist, 'sw.js');
if (!existsSync(swPath)) {
  console.log('[stamp-sw] dist/sw.js not found — nothing to stamp');
  process.exit(0);
}
let release = 'unknown';
try { release = JSON.parse(readFileSync(join(dist, 'data', 'release.json'), 'utf8')).id || release; } catch { /* keep */ }
const commit = (process.env.VITE_BUILD_COMMIT || '').slice(0, 7);
const stamp = commit ? `${release}-${commit}` : release;
const src = readFileSync(swPath, 'utf8');
const out = src.replace(/^const BUILD_STAMP = '[^']*';/m, `const BUILD_STAMP = '${stamp}';`);
if (out === src) {
  console.log('[stamp-sw] BUILD_STAMP line not found in sw.js — worker will not auto-update on deploy');
  process.exit(0);
}
writeFileSync(swPath, out);
console.log(`[stamp-sw] dist/sw.js stamped ${stamp}`);
