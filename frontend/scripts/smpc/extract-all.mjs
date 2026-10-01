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
//   CHANGED_ONLY=1 node scripts/smpc/extract-all.mjs 200
//        weekly refresh (CI): EMA's EPAR document list (ema-feed.mjs — one
//        download, last_updated_date per product information) names the labels
//        EMA changed since our extract; only those (and medicines without an
//        extract yet) are downloaded and re-parsed, capped at 200 per run. As an
//        independent cross-check HEAD_SAMPLE (default 100) further labels, in
//        rotation, are asked directly for the PDF's Last-Modified, so the whole
//        corpus is re-verified every few months even if the list missed a change.
//        Without the list every label gets that HEAD check (the old sweep).
//        Every other label is kept exactly as it is — a label never disappears
//        because it was not checked; a run that stops early records the labels
//        it did not reach (index.unchecked, checked first next time) and marks
//        itself incomplete. Each refreshed extract records sourceModified and
//        emaUpdated. Extracts of medicines no longer authorised are removed.
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { loadFeed, feedNewer, day } from './ema-feed.mjs';

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
// slug -> product-information URL named by EMA's document list (when it differs
// from the PI() pattern); filled by run() in changed-only mode.
const feedUrl = new Map();
const urlOf = (slug) => feedUrl.get(slug) || PI(slug);

// Data stamp = when EMA was last actually read (newest fetch in the cache), NOT
// the parse time — a REPARSE run must not make old data look fresh.
const cacheStamp = (dir, ext) => {
  let latest = 0;
  if (existsSync(dir))
    for (const f of readdirSync(dir))
      if (f.endsWith(ext)) latest = Math.max(latest, statSync(join(dir, f)).mtimeMs);
  return latest ? new Date(latest).toISOString().slice(0, 10) : null;
};

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
const CAPS = { '4.1': 20000, '4.2': 60000, '4.3': 8000, '4.4': 40000, '4.8': 80000, '5.1': 40000, '5.2': 40000 };
const HEADING = /^[ \t]*(\d\.\d+)[ \t.]+([A-Z][^\n]{3,80})$/gm;
// One Annex I can bundle several SmPCs (one per presentation: an intravenous
// and a subcutaneous form, a tablet and granules, several vaccine doses …).
// Their indications and posology differ, so for these two sections every
// presentation's text is kept, each under the product name from its own
// "1. NAME OF THE MEDICINAL PRODUCT" heading; identical texts appear once.
const NAME_HEADING = /^[ \t]*1\.[ \t]+NAME OF THE MEDICINAL PRODUCT[ \t]*\n+[ \t]*([^\n]{3,160})/gm;
const ALL_PRESENTATIONS = new Set(['4.1', '4.2']);
const norm = (t) => t.toLowerCase().replace(/\s+/g, ' ').trim();

const stripNoise = (raw) =>
  raw
    .replace(//g, '•') // Symbol-font bullet (no glyph in normal fonts) → real bullet
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
  const names = [];
  let n; NAME_HEADING.lastIndex = 0;
  while ((n = NAME_HEADING.exec(text)) !== null) names.push({ name: n[1].trim(), start: n.index });
  const nameAt = (pos) => { let cur = null; for (const x of names) { if (x.start < pos) cur = x.name; else break; } return cur; };
  const sections = {};
  for (const [num, title] of Object.entries(TARGETS)) {
    const hits = heads
      .map((h, i) => ({ h, i }))
      .filter(({ h }) => h.num === num && h.title.toLowerCase().startsWith(title.slice(0, 8).toLowerCase()));
    if (!hits.length) { sections[num] = { title, text: '', missing: true }; continue; }
    const bodies = [];
    for (const { h, i } of ALL_PRESENTATIONS.has(num) ? hits : hits.slice(0, 1)) {
      const e = i + 1 < heads.length ? heads[i + 1].start : text.length;
      const b = reflow(text.slice(h.end, e));
      if (!b || bodies.some((x) => norm(x.text) === norm(b))) continue;
      bodies.push({ text: b, name: nameAt(h.start) });
    }
    let body = bodies.length <= 1
      ? (bodies[0]?.text || '')
      : bodies.map((b) => `▸ ${b.name || 'Further presentation'}\n\n${b.text}`).join('\n\n');
    const cap = CAPS[num];
    if (body.length > cap) body = body.slice(0, cap).replace(/\s+\S*$/, '') + '\n\n[…section truncated — open the full SmPC via the source link above.]';
    sections[num] = { title, text: body, ...(bodies.length > 1 ? { presentations: bodies.length } : {}) };
  }
  return sections;
}

// Returns raw text (from cache or fresh download), or null on failure.
const lastModified = new Map(); // slug -> ISO timestamp of the PDF EMA served (from its Last-Modified header)
const parseLastModified = (headers) => { const m = /^last-modified:\s*(.+)$/im.exec(headers || ''); const d = m ? new Date(m[1].trim()) : null; return d && !isNaN(d) ? d.toISOString() : null; };
// HEAD request: is EMA's copy newer than ours? Returns {ok, lastModified} — no download.
async function headPdf(slug) {
  // one attempt only: a failed check just means "not checked this week" (the
  // label is kept), and retry sleeps here were the main cost of a full sweep
  let out = '';
  try { out = execFileSync('curl', ['-sIL', '-A', 'Mozilla/5.0', '--max-time', '20', urlOf(slug)], { encoding: 'utf8' }); } catch { out = ''; }
  const codes = [...out.matchAll(/^HTTP\/\S+\s+(\d{3})/gm)].map((m) => m[1]);
  const code = codes[codes.length - 1] || '000';
  if (code === '200') return { ok: true, lastModified: parseLastModified(out) };
  if (code === '404') return { ok: true, notFound: true };
  return { ok: false };
}
async function rawText(slug, pdfTmp, force = false) {
  const cacheFile = join(CACHE, `${slug}.txt`);
  if (!force && process.env.FORCE !== '1' && existsSync(cacheFile)) return readFileSync(cacheFile, 'utf8');
  for (let attempt = 0; attempt < 3; attempt++) {
    let code = '000';
    const hdrTmp = pdfTmp + '.hdr';
    try {
      code = execFileSync('curl', ['-sL', '-A', 'Mozilla/5.0', '--max-time', '60', '-D', hdrTmp, '-o', pdfTmp, '-w', '%{http_code}', urlOf(slug)], { encoding: 'utf8' }).trim();
    } catch { code = '000'; }
    try { lastModified.set(slug, parseLastModified(readFileSync(hdrTmp, 'utf8'))); rmSync(hdrTmp); } catch { /* no headers */ }
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
  const changedOnly = process.env.CHANGED_ONLY === '1';
  // Wall-clock budget for a changed-only run (minutes): once spent, the
  // remaining labels are kept unchecked and the run finishes normally, so a
  // slow EMA day can never push the job into its hard limit and lose the work.
  const budgetMs = (parseFloat(process.env.TIME_BUDGET_MIN || '0') || Infinity) * 60000;
  const startedAt = Date.now();
  let budgetSpent = false;
  for (const d of [OUT_DIR, CACHE]) mkdirSync(d, { recursive: true });
  const data = JSON.parse(readFileSync(join(root, 'ema-medicines.json'), 'utf8'));

  const only = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null; // debugging: restrict to these slugs (the manifest then lists only them — do not commit it)
  const seen = new Set();
  const drugs = data.authorised.filter((m) => {
    const s = slugOf(m);
    if (!s || seen.has(s) || (only && !only.has(s))) return false;
    seen.add(s); return true;
  });

  const index = { generated: 'dev', source: 'EMA product-information (Annex I, SmPC)', drugs: {}, failed: [] };
  let done = 0, ok = 0, fetched = 0, notfound = 0, fail = 0;
  const CONC = 1; // single-threaded: EMA's burst limit is low, so pace one-at-a-time
  const readDoc = (slug) => { try { return JSON.parse(readFileSync(join(OUT_DIR, `${slug}.json`), 'utf8')); } catch { return null; } };
  const prevIndex = (() => { try { return JSON.parse(readFileSync(INDEX, 'utf8')); } catch { return {}; } })();

  // Changed-only plan per stored label: 'feed' = EMA's list says it changed
  // (download), 'head' = ask EMA's PDF server (rotating cross-check sample, or
  // every label when the list is unavailable / does not name it), 'keep'.
  const plan = new Map();
  const feedUpdated = new Map();                 // slug -> EMA list last_updated_date
  let feed = null, headOffset = 0;
  const firstUp = new Set(prevIndex.unchecked || []); // labels a previous run did not reach
  if (changedOnly) {
    feed = loadFeed(CACHE, drugs);
    if (feed) for (const m of drugs) { const h = feed.lookup(m); if (h) { feedUpdated.set(slugOf(m), h.updated); if (h.url !== PI(slugOf(m))) feedUrl.set(slugOf(m), h.url); } }
    const stored = drugs.map(slugOf).filter((s) => existsSync(join(OUT_DIR, `${s}.json`))).sort();
    const sampleN = feed ? Math.max(0, parseInt(process.env.HEAD_SAMPLE ?? '100', 10) || 0) : Infinity;
    const start = feed && stored.length ? (prevIndex.headOffset || 0) % stored.length : 0;
    const sample = new Set(sampleN >= stored.length ? stored : [...stored, ...stored].slice(start, start + sampleN));
    headOffset = feed && stored.length ? (start + Math.min(sampleN, stored.length)) % stored.length : 0;
    for (const s of stored) {
      const u = feedUpdated.get(s);
      plan.set(s, u && feedNewer(u, readDoc(s)) ? 'feed' : (!u || sample.has(s) || firstUp.has(s)) ? 'head' : 'keep');
    }
    const n = (k) => [...plan.values()].filter((v) => v === k).length;
    console.log(feed
      ? `EMA document list ${feed.timestamp || ''}: ${feed.found}/${drugs.length} medicines found; ${n('feed')} labels changed at EMA, ${n('head')} cross-checked directly (rotation from #${start}), ${n('keep')} unchanged`
      : `No EMA document list — checking all ${stored.length} stored labels directly`);
  }
  // Labels a previous run did not reach go first, then the ones EMA changed.
  const rank = (m) => (firstUp.has(slugOf(m)) ? 0 : plan.get(slugOf(m)) === 'feed' ? 1 : 2);
  const queue = [...drugs].sort((a, b) => rank(a) - rank(b));
  const unchecked = [];                          // stored labels this run could not check

  let consecutiveFail = 0, cooldowns = 0, aborted = false;
  let unchanged = 0, headFailed = 0;
  const refreshed = [];
  // Keep the extract already on disk listed in the manifest (nothing about it changes).
  const keepExisting = (slug, m) => { if (existsSync(join(OUT_DIR, `${slug}.json`))) { index.drugs[slug] = { brand: m.n, inn: m.inn }; ok++; return true; } return false; };
  // EMA's copy counts as newer when its Last-Modified differs from the one we
  // extracted from — or, for extracts made before that was recorded, when it
  // post-dates the day the text was retrieved.
  const isNewer = (lm, prev) => !!lm && (prev.sourceModified ? lm !== prev.sourceModified : lm.slice(0, 10) > String(prev.retrieved || ''));
  async function worker(id) {
    const pdf = join(CACHE, `.tmp.${id}.pdf`);
    while (queue.length) {
      if (aborted) return;
      const m = queue.shift();
      const slug = slugOf(m);
      done++;
      let cached = existsSync(join(CACHE, `${slug}.txt`));
      let force = false;
      if (changedOnly) {
        const prev = readDoc(slug);
        if (prev) {
          const step = plan.get(slug) || 'head';
          if (step === 'keep') { unchanged++; keepExisting(slug, m); continue; } // EMA's list: not updated since our extract
          if (!budgetSpent && Date.now() - startedAt > budgetMs) { budgetSpent = true; console.log(`\n⏱ time budget spent after ${done - 1} labels — the rest is kept unchecked until next week`); }
          if (fetched >= limit || budgetSpent) { keepExisting(slug, m); unchecked.push(slug); continue; } // budget spent: not even checked this week
          if (step === 'feed') {
            refreshed.push(`${slug} (${day(prev.emaUpdated || prev.sourceModified || prev.retrieved)} → ${day(feedUpdated.get(slug))}, EMA list)`);
            force = true; cached = false;
          } else {
          const h = await headPdf(slug);
          await sleep(700 + Math.floor(Math.random() * 400));
          if (!h.ok) {                                                       // the label stays as it is; ride out a block like a failed download
            headFailed++; consecutiveFail++; keepExisting(slug, m); unchecked.push(slug);
            if (consecutiveFail >= 6) {
              if (++cooldowns > 5) { aborted = true; console.log(`\n⚠ EMA still blocking after ${cooldowns} cooldowns — stopping. Unchecked labels are kept as they are.`); return; }
              console.log(`\n⏸ ${consecutiveFail} consecutive HEAD failures — EMA rate-limit active. Cooling down 5 min (cooldown ${cooldowns}/5)…`);
              await sleep(5 * 60 * 1000);
              consecutiveFail = 0;
            }
            continue;
          }
          consecutiveFail = 0;
          if (h.notFound || !isNewer(h.lastModified, prev)) { unchanged++; keepExisting(slug, m); continue; }
          refreshed.push(`${slug} (${String(prev.sourceModified || prev.retrieved).slice(0, 10)} → ${h.lastModified.slice(0, 10)}, PDF date)`);
          force = true; cached = false;                                        // EMA has a newer PDF: download it
          }
        }
      }
      if (!cached && reparse) {                            // a re-parse only touches what is cached — never a fetch failure
        keepExisting(slug, m);                             // keep the file already on disk listed
        continue;
      }
      if (!cached && !reparse && fetched >= limit) { keepExisting(slug, m); continue; } // download budget hit; parse only cached
      let t = reparse && !cached ? null : await rawText(slug, pdf, force);
      if (!cached && t && t !== '404') { fetched++; consecutiveFail = 0; }
      if (!t) { // genuine fetch failure (not 404): ride out EMA's block with a long cooldown, then retry this drug once
        consecutiveFail++;
        if (consecutiveFail >= 6) {
          if (++cooldowns > 5) { aborted = true; queue.unshift(m); console.log(`\n⚠ EMA still blocking after ${cooldowns} cooldowns — stopping. Re-run later to resume (cache persists, ${ok} done).`); return; }
          console.log(`\n⏸ ${consecutiveFail} consecutive failures — EMA rate-limit active. Cooling down 20 min (cooldown ${cooldowns}/5)…`);
          await sleep(20 * 60 * 1000);
          consecutiveFail = 0;
          queue.unshift(m); // retry this drug after the cooldown
          continue;
        }
      }
      if (!t || t === '404') { if (t === '404') notfound++; else fail++; index.failed.push(slug); keepExisting(slug, m); if (!cached) await sleep(200); continue; }
      const sections = parseSections(t);
      if (!Object.values(sections).some((s) => !s.missing && s.text)) { fail++; index.failed.push(slug); keepExisting(slug, m); continue; }
      const doc = {
        slug, brand: m.n, inn: m.inn, holder: m.holder, url: urlOf(slug), source: 'EMA product-information (Annex I, SmPC)',
        retrieved: (() => { try { return new Date(statSync(join(CACHE, `${slug}.txt`)).mtimeMs).toISOString().slice(0, 10); } catch { return null; } })(), // when the PDF text was fetched from EMA
        sourceSha: createHash('sha256').update(t).digest('hex'), // fingerprint of the raw PDF text this extract was parsed from (validate-release.py: same source + different sections = parser drift)
        ...(lastModified.get(slug) || readDoc(slug)?.sourceModified ? { sourceModified: lastModified.get(slug) || readDoc(slug).sourceModified } : {}), // EMA's Last-Modified of the PDF (weekly change check)
        ...((!cached && feedUpdated.get(slug)) || readDoc(slug)?.emaUpdated ? { emaUpdated: (!cached && feedUpdated.get(slug)) || readDoc(slug).emaUpdated } : {}), // EMA document list's last_updated_date of the PDF this text came from
        sections,
      };
      const why = regressed(slug, doc);
      if (why) { guarded.push(`${slug} (${why})`); }               // keep the good file already on disk
      else writeFileSync(join(OUT_DIR, `${slug}.json`), JSON.stringify(doc));
      index.drugs[slug] = { brand: m.n, inn: m.inn };
      ok++;
      if (done % 25 === 0) process.stdout.write(`  …${done}/${drugs.length}  ok:${ok} fetched:${fetched} 404:${notfound} fail:${fail}\n`);
      if (!cached) await sleep(1500 + Math.floor(Math.random() * 1000)); // ~1 request / 2s to stay under EMA's burst limit
    }
    if (existsSync(pdf)) rmSync(pdf);
  }

  // Write-time guard: a re-parse must never silently degrade a label that was
  // already good. If the file on disk has a required section the new parse
  // lost, or the new text is under 40% of the old, the old file is kept and the
  // slug is reported (index.guarded) for a manual look.
  const REQUIRED = ['4.1', '4.2', '4.3', '4.4', '4.8'];
  const hasSec = (secs, k) => !!(secs?.[k] && !secs[k].missing && String(secs[k].text || '').trim());
  const secLen = (secs) => Object.values(secs || {}).reduce((n, x) => n + (x && !x.missing && x.text ? x.text.length : 0), 0);
  const guarded = [];
  const regressed = (slug, next) => {
    const file = join(OUT_DIR, `${slug}.json`);
    if (!existsSync(file)) return null;
    let prev; try { prev = JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
    const lost = REQUIRED.filter((k) => hasSec(prev.sections, k) && !hasSec(next.sections, k));
    if (lost.length) return `lost ${lost.join('/')}`;
    const pl = secLen(prev.sections), nl = secLen(next.sections);
    if (pl >= 2000 && nl < 0.4 * pl) return `text ${pl}→${nl} chars`;
    return null;
  };

  console.log(`SmPC batch: ${drugs.length} unique authorised medicines (downloadLimit=${limit}, reparse=${reparse})`);
  await Promise.all(Array.from({ length: CONC }, (_, i) => worker(i)));

  // A run that stopped early (EMA blocking) leaves part of the queue untouched:
  // those labels stay listed exactly as they are and are checked first next run.
  for (const m of queue) {
    const slug = slugOf(m);
    if (keepExisting(slug, m) && changedOnly && plan.get(slug) !== 'keep') unchecked.push(slug);
  }
  if (changedOnly) {
    if (unchecked.length) index.unchecked = [...new Set(unchecked)];
    if (aborted || budgetSpent || unchecked.length)
      index.incomplete = { reason: aborted ? 'EMA kept blocking requests' : budgetSpent ? 'time budget spent' : fetched >= limit ? 'download limit reached' : 'some checks failed', unchecked: new Set(unchecked).size };
    if (feed) index.headOffset = headOffset;
    if (feed?.timestamp) index.emaList = feed.timestamp;
  }

  // Extracts of medicines that are no longer authorised (withdrawn, revoked,
  // renamed to a new EPAR slug) must not stay in the corpus — the app would
  // still offer them as a current label. ema-medicines.json passed the daily
  // release gates; the plausibility floor guards against a truncated list.
  const removed = [];
  if (!only && drugs.length >= 1000) {
    const current = new Set(drugs.map(slugOf));
    const extra = readdirSync(OUT_DIR).filter((f) => f.endsWith('.json') && !current.has(f.slice(0, -5)));
    if (extra.length <= 50) for (const f of extra) { unlinkSync(join(OUT_DIR, f)); removed.push(f.slice(0, -5)); }
    else console.log(`⚠ ${extra.length} extracts without an authorised medicine — too many to be real, nothing removed`);
  }

  index.count = Object.keys(index.drugs).length;
  // a changed-only run DID read EMA today (every HEAD check), so the stamp is today
  index.generated = process.env.STAMP || (changedOnly ? new Date().toISOString().slice(0, 10) : cacheStamp(CACHE, '.txt')) || index.generated;
  if (guarded.length) index.guarded = guarded; else delete index.guarded;
  writeFileSync(INDEX, JSON.stringify(index));
  console.log(`\nDONE. parsed:${ok} newDownloads:${fetched} 404:${notfound} failed:${fail} guarded(kept previous file):${guarded.length} removed(no longer authorised):${removed.length}${removed.length ? ` [${removed.join(', ')}]` : ''}`);
  if (index.incomplete) console.log(`  ⚠ INCOMPLETE (${index.incomplete.reason}): ${index.incomplete.unchecked} labels not checked — first in line next run`);
  if (changedOnly) {
    console.log(`  changed-only: unchanged:${unchanged} refreshed:${refreshed.length} headFailed:${headFailed} minutes:${Math.round((Date.now() - startedAt) / 60000)}${budgetSpent ? ' (time budget spent)' : ''}`);
    if (refreshed.length) console.log(`  refreshed: ${refreshed.join('; ')}`);
  }
  if (guarded.length) console.log(`  guarded: ${guarded.join('; ')}`);
  console.log(`Manifest: ${index.count} drugs → smpc-index.json ; per-drug JSON → smpc-data/`);
}
run();
