// Batch SmPC extractor — builds an offline, full-text Summary-of-Product-
// Characteristics comparison corpus for the whole EU authorised catalogue.
//
// For every authorised medicine in ema-medicines.json it derives the product-
// information PDF URL from the EPAR slug, downloads it ONCE (raw text is cached
// so re-parsing never re-downloads), and extracts the standardised QRD sections
// into one compact JSON per drug in smpc-data/ (committed source), plus a
// manifest. copy-data.mjs publishes these to public/data/smpc/ for the app to
// bundle — so the comparison works fully offline for any two EU medicines.
//
// Usage:
//   node scripts/smpc/extract-all.mjs            fetch missing + (re)parse all from cache
//   node scripts/smpc/extract-all.mjs 50         cap NEW downloads to 50 (parsing still runs on all cached)
//   REPARSE=1 node scripts/smpc/extract-all.mjs  re-parse every cached drug (after changing caps/reflow), no new fetch
//   FORCE=1 node scripts/smpc/extract-all.mjs    ignore cache, re-download everything
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');                    // frontend/
const OUT_DIR = join(root, 'smpc-data');                // committed per-drug JSON
const INDEX = join(root, 'smpc-index.json');            // committed manifest
const CACHE = join(here, '.cache');                     // gitignored raw-text cache

const PI = (slug) =>
  `https://www.ema.europa.eu/en/documents/product-information/${slug}-epar-product-information_en.pdf`;
// Renamed products carry a "-previously-<oldname>" tail in the EPAR slug that the
// product-information URL does not use — strip it.
const slugOf = (m) => ((m.url || '').split('/EPAR/')[1]?.trim() || '').replace(/-previously-.*$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TARGETS = {
  '4.1': 'Therapeutic indications',
  '4.2': 'Posology and method of administration',
  '4.3': 'Contraindications',
  '4.4': 'Special warnings and precautions for use',
  '4.8': 'Undesirable effects',
  '5.1': 'Pharmacodynamic properties',
  '5.2': 'Pharmacokinetic properties',
};
// Per-section length caps. The sections a clinician actually compares (dosing,
// contraindications, warnings, harms, PK) are kept COMPLETE so the comparison is
// fully usable offline — only a high safety cap guards against pathological
// blow-ups. 5.1 is the exception: it is mostly trial-efficacy narrative, so it is
// capped (mechanism of action, its useful part, sits at the top) with the full
// text one tap away via the live SmPC link.
const CAPS = { '4.1': 12000, '4.2': 40000, '4.3': 8000, '4.4': 40000, '4.8': 40000, '5.1': 8000, '5.2': 40000 };
const HEADING = /^[ \t]*(\d\.\d+)[ \t.]+([A-Z][^\n]{3,80})$/gm;

const stripNoise = (raw) =>
  raw
    .replace(/\f/g, '\n')
    .replace(/^[ \t]*\d+\/\d+[ \t]*$/gm, '')
    .replace(/^[ \t]*Page \d+.*$/gim, '')
    .replace(/^[ \t]{2,}\d{1,3}[ \t]*$/gm, '')
    .split('\n').map((l) => l.replace(/[ \t]+$/g, '')).join('\n');

// Re-flow hard-wrapped narrative into paragraphs while preserving table rows
// (2+ column gaps) and bullet lines verbatim, so the app can wrap prose cleanly
// yet keep frequency tables aligned.
function reflow(text) {
  const isTable = (l) => (l.match(/ {2,}/g) || []).length >= 2;
  const isBullet = (l) => /^\s*[••–\-*]\s+/.test(l);
  const out = [];
  let buf = '';
  const flush = () => { if (buf) { out.push(buf); buf = ''; } };
  for (const raw of text.split('\n')) {
    const l = raw.replace(/\s+$/g, '');
    if (l.trim() === '') { flush(); out.push(''); continue; }
    if (isTable(l)) { flush(); out.push(l); continue; }        // keep table row verbatim
    if (isBullet(l)) { flush(); buf = l.trim(); continue; }    // start paragraph at the bullet
    buf = buf ? `${buf} ${l.trim()}` : l.trim();               // continuation → append
  }
  flush();
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function parseSections(txt) {
  let text = stripNoise(txt);
  const annexII = text.search(/^\s*ANNEX II\b/m);
  if (annexII > 0) text = text.slice(0, annexII);
  const heads = [];
  let m; HEADING.lastIndex = 0;
  while ((m = HEADING.exec(text)) !== null)
    heads.push({ num: m[1], title: m[2].trim(), start: m.index, end: m.index + m[0].length });
  const sections = {};
  for (const [num, title] of Object.entries(TARGETS)) {
    const idx = heads.findIndex(
      (h) => h.num === num && h.title.toLowerCase().startsWith(title.slice(0, 8).toLowerCase())
    );
    if (idx === -1) { sections[num] = { title, text: '', missing: true }; continue; }
    const s = heads[idx].end;
    const e = idx + 1 < heads.length ? heads[idx + 1].start : text.length;
    let body = reflow(text.slice(s, e));
    const cap = CAPS[num];
    if (body.length > cap) body = body.slice(0, cap).replace(/\s+\S*$/, '') + '\n\n[…section truncated — open the full SmPC via the source link above.]';
    sections[num] = { title, text: body };
  }
  return sections;
}

// Returns raw text (from cache or fresh download), or null on failure.
async function rawText(slug, pdfTmp) {
  const cacheFile = join(CACHE, `${slug}.txt`);
  if (process.env.FORCE !== '1' && existsSync(cacheFile)) return readFileSync(cacheFile, 'utf8');
  for (let attempt = 0; attempt < 3; attempt++) {
    let code = '000';
    try {
      code = execFileSync('curl', ['-sL', '-A', 'Mozilla/5.0', '--max-time', '60', '-o', pdfTmp, '-w', '%{http_code}', PI(slug)], { encoding: 'utf8' }).trim();
    } catch { code = '000'; }
    if (code === '200' && existsSync(pdfTmp)) {
      const txtTmp = pdfTmp + '.txt';
      try {
        execFileSync('pdftotext', ['-layout', pdfTmp, txtTmp], { stdio: 'ignore' });
        const t = readFileSync(txtTmp, 'utf8');
        writeFileSync(cacheFile, t);
        rmSync(txtTmp);
        return t;
      } catch { return null; }
    }
    if (code === '404') return '404';
    // EMA rate-limits aggressively (429); cool down for a long, growing window.
    await sleep(15000 * (attempt + 1) + Math.floor(Math.random() * 5000)); // 15s,30s,45s,60s,75s,90s
  }
  return null;
}

async function run() {
  const limit = process.argv[2] ? parseInt(process.argv[2], 10) : Infinity;
  const reparse = process.env.REPARSE === '1';
  for (const d of [OUT_DIR, CACHE]) mkdirSync(d, { recursive: true });
  const data = JSON.parse(readFileSync(join(root, 'ema-medicines.json'), 'utf8'));

  const seen = new Set();
  const drugs = data.authorised.filter((m) => {
    const s = slugOf(m);
    if (!s || seen.has(s)) return false;
    seen.add(s); return true;
  });

  const index = { generated: process.env.STAMP || 'dev', source: 'EMA product-information (Annex I, SmPC)', drugs: {}, failed: [] };
  let done = 0, ok = 0, fetched = 0, notfound = 0, fail = 0;
  const CONC = 1; // single-threaded: EMA's burst limit is low, so pace one-at-a-time
  const queue = [...drugs];

  let consecutiveFail = 0, cooldowns = 0, aborted = false;
  async function worker(id) {
    const pdf = join(CACHE, `.tmp.${id}.pdf`);
    while (queue.length) {
      if (aborted) return;
      const m = queue.shift();
      const slug = slugOf(m);
      done++;
      const cached = existsSync(join(CACHE, `${slug}.txt`));
      if (!cached && !reparse && fetched >= limit) continue; // download budget hit; parse only cached
      let t = reparse && !cached ? null : await rawText(slug, pdf);
      if (!cached && t && t !== '404') { fetched++; consecutiveFail = 0; }
      if (!t) { // genuine fetch failure (not 404): ride out EMA's block with a long cooldown, then retry this drug once
        consecutiveFail++;
        if (consecutiveFail >= 6) {
          if (++cooldowns > 5) { aborted = true; console.log(`\n⚠ EMA still blocking after ${cooldowns} cooldowns — stopping. Re-run later to resume (cache persists, ${ok} done).`); return; }
          console.log(`\n⏸ ${consecutiveFail} consecutive failures — EMA rate-limit active. Cooling down 20 min (cooldown ${cooldowns}/5)…`);
          await sleep(20 * 60 * 1000);
          consecutiveFail = 0;
          queue.unshift(m); // retry this drug after the cooldown
          continue;
        }
      }
      if (!t || t === '404') { if (t === '404') notfound++; else fail++; index.failed.push(slug); if (!cached) await sleep(200); continue; }
      const sections = parseSections(t);
      if (!Object.values(sections).some((s) => !s.missing && s.text)) { fail++; index.failed.push(slug); continue; }
      writeFileSync(join(OUT_DIR, `${slug}.json`), JSON.stringify({
        slug, brand: m.n, inn: m.inn, holder: m.holder, url: PI(slug), source: 'EMA product-information (Annex I, SmPC)', sections,
      }));
      index.drugs[slug] = { brand: m.n, inn: m.inn };
      ok++;
      if (done % 25 === 0) process.stdout.write(`  …${done}/${drugs.length}  ok:${ok} fetched:${fetched} 404:${notfound} fail:${fail}\n`);
      if (!cached) await sleep(1500 + Math.floor(Math.random() * 1000)); // ~1 request / 2s to stay under EMA's burst limit
    }
    if (existsSync(pdf)) rmSync(pdf);
  }

  console.log(`SmPC batch: ${drugs.length} unique authorised medicines (downloadLimit=${limit}, reparse=${reparse})`);
  await Promise.all(Array.from({ length: CONC }, (_, i) => worker(i)));

  index.count = Object.keys(index.drugs).length;
  writeFileSync(INDEX, JSON.stringify(index));
  console.log(`\nDONE. parsed:${ok} newDownloads:${fetched} 404:${notfound} failed:${fail}`);
  console.log(`Manifest: ${index.count} drugs → smpc-index.json ; per-drug JSON → smpc-data/`);
}
run();
