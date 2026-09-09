// US Prescribing Information (USPI) extractor — the US counterpart to the SmPC
// pipeline. For every EU-authorised medicine it looks up the matching US label
// via the openFDA Structured Product Labeling API (already used by the app),
// extracts the PLR sections, and writes one JSON per drug keyed by the SAME EU
// slug — so the app can put a molecule's EU SmPC and US USPI side by side.
//
// MATCHING (rewritten Sept 2026 after an audit found 57% of pairings pointed at
// a different US product — biosimilars, combinations, even OTC creams):
//   tier 1 "brand"     — the US label whose brand name equals the EU brand
//                        (or a known US alias, e.g. Upstaza -> KEBILIDI). Brands
//                        are looked up in batches of 40 per openFDA query.
//   tier 2 "substance" — no US product of that name: the US label whose
//                        generic name is EXACTLY the EU active substance(s)
//                        (salts and biosimilar suffixes ignored, fixed-dose
//                        combinations and conjugates rejected), preferring the
//                        NDA/BLA originator over ANDA generics/biosimilars.
//   Prescription products only (openfda.product_type HUMAN PRESCRIPTION DRUG).
// The chosen tier is written as `match` so the app can tell the reader when the
// US column is a different product with the same active substance.
//
// openFDA returns clean structured fields (no PDF parsing) plus separate
// *_table fields holding the frequency tables as HTML, which we sanitise and
// bundle for native rendering.
//
// Usage:
//   node scripts/uspi/extract-all.mjs           fetch missing + parse
//   node scripts/uspi/extract-all.mjs 200        cap NEW lookups to 200
//   REPARSE=1 node scripts/uspi/extract-all.mjs  re-select/re-parse from cached candidates only
//   FORCE=1 ...                                   ignore cache
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const OUT_DIR = join(root, 'uspi-data');
const INDEX = join(root, 'uspi-index.json');
const CACHE = join(here, '.cache');      // legacy: single INN-query result per slug (kept for reference)
const CACHE2 = join(here, '.cache2');    // new: candidate lists per slug {brand:[...], substance:[...]}

const slugOf = (m) => ((m.url || '').split('/EPAR/')[1]?.trim() || '').replace(/-previously-.*$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Data stamp = when openFDA was last actually read (newest fetch in the cache),
// NOT the parse time — a REPARSE run must not make old data look fresh.
const cacheStamp = (dir, ext) => {
  let latest = 0;
  if (existsSync(dir))
    for (const f of readdirSync(dir))
      if (f.endsWith(ext)) latest = Math.max(latest, statSync(join(dir, f)).mtimeMs);
  return latest ? new Date(latest).toISOString().slice(0, 10) : null;
};

// section key -> openFDA text field(s, first present wins) + optional table field
const FIELDS = {
  indications: { text: ['indications_and_usage'], table: 'indications_and_usage_table' },
  dosage: { text: ['dosage_and_administration'], table: 'dosage_and_administration_table' },
  contraindications: { text: ['contraindications'], table: 'contraindications_table' },
  boxed_warning: { text: ['boxed_warning'] },
  warnings: { text: ['warnings_and_cautions', 'warnings'], table: 'warnings_and_cautions_table' },
  adverse_reactions: { text: ['adverse_reactions'], table: 'adverse_reactions_table' },
  specific_populations: { text: ['use_in_specific_populations'] },
  mechanism: { text: ['mechanism_of_action', 'clinical_pharmacology'] },
  pharmacokinetics: { text: ['pharmacokinetics'] },
};
const CAP = 40000;

// Strip the leading "6 ADVERSE REACTIONS" style section heading and tidy spacing.
const cleanText = (arr) => {
  let t = arr.join('\n\n')
    .replace(/^\s*\d+(\.\d+)?\s+[A-Z][A-Z0-9 /,&()'-]{2,60}\s{2,}/, '') // leading numbered ALLCAPS heading
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (t.length > CAP) t = t.slice(0, CAP).replace(/\s+\S*$/, '') + '\n\n[…section truncated — open the full label via the source link above.]';
  return t;
};

// Decode HTML entities (numeric + common named) so tables read cleanly.
const NAMED = { gt: '>', lt: '<', amp: '&', quot: '"', apos: "'", nbsp: ' ', deg: '°', plusmn: '±', micro: 'µ', times: '×', ge: '≥', le: '≤' };
const decodeEntities = (s) =>
  s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => NAMED[n.toLowerCase()] ?? m);

// Reduce FDA SPL table HTML to safe, minimal, attribute-free structural markup.
const sanitizeTable = (html) =>
  decodeEntities(
    html
      .replace(/<\/?(?:script|style|col|colgroup|a|span|sup|sub|br|footnote)[^>]*>/gi, ' ')
      // Keep ONLY numeric rowspan/colspan on cells — dropping them shifts every
      // multi-row header (e.g. "Body System" spanning two rows) one column left.
      .replace(/<(th|td)\b([^>]*)>/gi, (_, t, a) => {
        const c = /colspan\s*=\s*"?(\d+)/i.exec(a), r = /rowspan\s*=\s*"?(\d+)/i.exec(a);
        return `<${t}${c && +c[1] > 1 ? ` colspan="${c[1]}"` : ''}${r && +r[1] > 1 ? ` rowspan="${r[1]}"` : ''}>`;
      })
      .replace(/<(table|thead|tbody|tfoot|tr|caption)[^>]*>/gi, '<$1>')
      .replace(/<(?!\/?(?:table|thead|tbody|tfoot|tr|th|td|caption)\b)[^>]*>/gi, '') // drop any other tag
  )
    .replace(/\s{2,}/g, ' ')
    .trim();

function parse(r) {
  const sections = {};
  let any = false;
  for (const [key, spec] of Object.entries(FIELDS)) {
    const field = spec.text.find((f) => Array.isArray(r[f]) && r[f].length);
    const text = field ? cleanText(r[field]) : '';
    const tables = spec.table && Array.isArray(r[spec.table]) ? r[spec.table].map(sanitizeTable).filter(Boolean) : [];
    if (text || tables.length) any = true;
    sections[key] = text || tables.length ? { text, tables } : { text: '', missing: true };
  }
  return any ? sections : null;
}

// ---------------------------------------------------------------------------
// Matching helpers
// ---------------------------------------------------------------------------
// EU brands whose US product carries a different name.
const US_ALIAS = {
  upstaza: 'KEBILIDI', libmeldy: 'LENMELDY', mabthera: 'RITUXAN', glivec: 'GLEEVEC',
  roactemra: 'ACTEMRA', forxiga: 'FARXIGA', novorapid: 'NOVOLOG', forsteo: 'FORTEO',
  jakavi: 'JAKAFI', lorviqua: 'LORBRENA', giotrif: 'GILOTRIF', verzenios: 'VERZENIO',
  lixiana: 'SAVAYSA', aspaveli: 'EMPAVELI', adtralza: 'ADBRY', betaferon: 'BETASERON',
  ilumetri: 'ILUMYA', cinqaero: 'CINQAIR', suliqua: 'SOLIQUA', aclasta: 'RECLAST',
  zavicefta: 'AVYCAZ', vaborem: 'VABOMERE', xigduo: 'XIGDUO XR', lucentis: 'LUCENTIS',
};
// Salt / form / grammar words that do not change the active substance.
const SALTS = new Set(('and human recombinant mesylate mesilate hydrochloride hcl sodium potassium calcium ' +
  'magnesium acetate sulfate sulphate citrate maleate malate tartrate phosphate succinate fumarate ' +
  'hemifumarate besylate besilate hydrobromide dihydrochloride monohydrate dihydrate trihydrate ' +
  'hemihydrate sesquihydrate anhydrous disodium dipotassium tosylate tosilate lactate bromide chloride ' +
  'hyclate pamoate nitrate oxalate propionate valerate aspartate benzoate carbonate gluconate ' +
  'glucuronate dimesylate esylate isethionate tromethamine hydrate tromethamine bisulfate ' +
  'dihydrogen monosodium trisodium hemisulfate oral').split(/\s+/));
const norm = (x) => String(x || '').toLowerCase().replace(/\s*\((?:previously|formerly)[^)]*\)/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const tokens = (x) => norm(String(x || '').replace(/-([a-z]{4})\b/gi, '')) // drop biosimilar suffix -xxxx
  .split(' ').filter((t) => t && !SALTS.has(t));
// EU active substance(s) vs a US generic_name: identical sets of active tokens.
const sameActives = (euInn, usGeneric) => {
  const a = new Set(tokens(String(euInn).replace(/[;/,]/g, ' ')));
  const b = new Set(tokens(usGeneric));
  if (!a.size || !b.size) return false;
  for (const t of a) if (!b.has(t)) return false;
  for (const t of b) if (!a.has(t)) return false;
  return true;
};
const brandCore = (n) => norm(n).split(' ');
// "Palbociclib Viatris"-style EU names carry the INN, not a brand: skip tier 1.
const isGenericStyleName = (m) => {
  const b = brandCore(m.n), inn = tokens(String(m.inn).replace(/[;/,]/g, ' '));
  return inn.length > 0 && inn.every((t) => b.includes(t));
};
const isRx = (r) => { const t = r.openfda?.product_type || []; return t.length === 0 || t.some((x) => OK_TYPES.includes(String(x).toUpperCase())); };
const brandEquals = (r, want) => (r.openfda?.brand_name || []).some((b) => norm(b) === want || norm(b).startsWith(want + ' '));
const matchedBrand = (r, want) => (r.openfda?.brand_name || []).find((b) => norm(b) === want) || (r.openfda?.brand_name || []).find((b) => norm(b).startsWith(want + ' ')) || r.openfda?.brand_name?.[0];
const isOriginator = (r) => (r.openfda?.application_number || []).some((a) => /^(BLA|NDA)/i.test(a));
const hasSuffix = (r) => (r.openfda?.generic_name || []).some((g) => /-[a-z]{4}\b/i.test(g));
const isBranded = (r) => { const b = norm(r.openfda?.brand_name?.[0]), g = norm(r.openfda?.generic_name?.[0]); return b && g && b !== g; };
// Among equally good candidates prefer the EARLIEST application number: for a
// substance match that is the original reference product (Lucentis BLA125156
// over the later Susvimo implant BLA761197; Prolia over the biosimilars).
const appNum = (r) => { const m = /(\d{5,7})/.exec((r.openfda?.application_number || [])[0] || ''); return m ? parseInt(m[1], 10) : 9e9; };
const rank = (r) => (isOriginator(r) ? 4 : 0) + (hasSuffix(r) ? 0 : 2) + (isBranded(r) ? 1 : 0) + (r.effective_time ? 0.5 : 0) - appNum(r) / 1e10;

const fetchJson = (url) => {
  let body = '';
  try { body = execFileSync('curl', ['-sL', '--max-time', '40', url], { encoding: 'utf8', maxBuffer: 120 * 1024 * 1024 }); } catch { body = ''; }
  try { return JSON.parse(body); } catch { return null; }
};
// Accept the regulated product types; reject OTC / homeopathic / consumer labels.
// CBER files CAR-T and gene therapies as "CELLULAR THERAPY", immunoglobulins and
// factor concentrates as "PLASMA DERIVATIVE" — none of them is a "HUMAN PRESCRIPTION DRUG".
const OK_TYPES = ['HUMAN PRESCRIPTION DRUG', 'CELLULAR THERAPY', 'PLASMA DERIVATIVE', 'VACCINE'];
const RX = `(${OK_TYPES.map((t) => `openfda.product_type:"${t}"`).join(' ')})`;
let apiCalls = 0;
const openfda = async (search, limit) => {
  apiCalls++;
  const j = fetchJson(`https://api.fda.gov/drug/label.json?search=${encodeURIComponent(search)}&limit=${limit}`);
  await sleep(350 + Math.floor(Math.random() * 250));
  if (j && j.results) return j.results;
  if (j && j.error && /NOT_FOUND/i.test(j.error.code || '')) return [];
  return null; // rate-limited / transient
};

async function run() {
  const reparse = process.env.REPARSE === '1';
  const force = process.env.FORCE === '1';
  const rebrand = process.env.REBRAND === '1';          // redo tier 1 for every brand
  const requeryEmpty = process.env.REQUERY_EMPTY === '1'; // redo tier 2 where it returned nothing
  const maxCalls = process.env.MAX_CALLS ? parseInt(process.env.MAX_CALLS, 10) : Infinity;
  for (const d of [OUT_DIR, CACHE, CACHE2]) mkdirSync(d, { recursive: true });

  // Write-time guard: a re-run must never silently degrade a label that was
  // already good — a required section lost, the text collapsing under 40%, or
  // a same-product ('brand') pairing demoted to a same-substance one. The old
  // file is kept and the slug reported (index.guarded) for a manual look.
  const REQUIRED = ['indications', 'dosage', 'contraindications', 'warnings', 'adverse_reactions'];
  const secText = (v) => (typeof v === 'string' ? v : (v && !v.missing && v.text) || '');
  const hasSec = (secs, k) => !!secText(secs?.[k]).trim();
  const secLen = (secs) => Object.values(secs || {}).reduce((n, v) => n + secText(v).length, 0);
  const guarded = [];
  const regressed = (slug, next) => {
    const file = join(OUT_DIR, `${slug}.json`);
    if (!existsSync(file)) return null;
    let prev; try { prev = JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
    if (prev.match === 'brand' && next.match === 'substance') return 'pairing brand→substance';
    const lost = REQUIRED.filter((k) => hasSec(prev.sections, k) && !hasSec(next.sections, k));
    if (lost.length) return `lost ${lost.join('/')}`;
    const pl = secLen(prev.sections), nl = secLen(next.sections);
    if (pl >= 2000 && nl < 0.4 * pl) return `text ${pl}→${nl} chars`;
    return null;
  };
  const data = JSON.parse(readFileSync(join(root, 'ema-medicines.json'), 'utf8'));

  const seen = new Set();
  const drugs = data.authorised.filter((m) => {
    const s = slugOf(m);
    if (!s || !m.inn || seen.has(s)) return false;
    seen.add(s); return true;
  });
  const cacheFile = (slug) => join(CACHE2, `${slug}.json`);
  const loadCache = (slug) => { try { return JSON.parse(readFileSync(cacheFile(slug), 'utf8')); } catch { return null; } };
  const saveCache = (slug, c) => writeFileSync(cacheFile(slug), JSON.stringify(c));

  // ---- Tier 1: brand lookups, 40 EU brands per openFDA query ----------------
  if (!reparse) {
    const need = drugs.filter((m) => !isGenericStyleName(m) && (force || rebrand || !loadCache(slugOf(m))?.brand));
    console.log(`Tier 1 (brand): ${need.length} EU brands to look up in ${Math.ceil(need.length / 20)} batched queries`);
    for (let i = 0; i < need.length; i += 20) {
      if (apiCalls >= maxCalls) { console.log('MAX_CALLS reached — stopping tier 1'); break; }
      const batch = need.slice(i, i + 20);
      const wanted = batch.map((m) => US_ALIAS[slugOf(m)] || m.n).map((n) => norm(n)).filter(Boolean);
      const search = `(${[...new Set(wanted)].map((w) => `openfda.brand_name:"${w}"`).join(' ')}) AND ${RX}`;
      const results = await openfda(search, 250);
      if (results === null) { console.log('  ⏸ openFDA transient error — cooling down 60s'); await sleep(60000); i -= 20; continue; }
      for (const m of batch) {
        const want = norm(US_ALIAS[slugOf(m)] || m.n);
        const hits = results.filter((r) => brandEquals(r, want));
        const c = loadCache(slugOf(m)) || {};
        c.brand = hits; c.brandQueried = want;
        saveCache(slugOf(m), c);
      }
      process.stdout.write(`  …brand batch ${Math.floor(i / 20) + 1}/${Math.ceil(need.length / 20)} (${results.length} labels, ${apiCalls} calls)\n`);
    }
  }

  // ---- Select + tier 2 (substance) for the rest ------------------------------
  const index = { generated: 'dev', source: 'openFDA drug label (US Prescribing Information)', drugs: {} };
  const stats = { brand: 0, substance: 0, none: 0, skipped: 0 };
  let done = 0;
  for (const m of drugs) {
    const slug = slugOf(m);
    done++;
    let c = loadCache(slug) || {};
    let chosen = null, match = null;
    const want = norm(US_ALIAS[slug] || m.n);
    // tier 1 — exact brand with the same actives
    // CBER labels sometimes carry no generic_name at all — a brand match then stands on its own.
    const brandHits = (c.brand || []).filter((r) => isRx(r) && brandEquals(r, want) && (!r.openfda?.generic_name?.[0] || sameActives(m.inn, r.openfda.generic_name[0])));
    if (brandHits.length) { chosen = brandHits.sort((a, b) => rank(b) - rank(a))[0]; match = 'brand'; }
    // tier 2 — same active substance(s), originator preferred
    if (!chosen) {
      if ((!Array.isArray(c.substance) || (requeryEmpty && c.substance.length === 0)) && !reparse) {
        if (apiCalls >= maxCalls) { stats.skipped++; continue; }
        const inn = String(m.inn).split(/[;/]/).map((x) => x.trim()).filter(Boolean);
        const search = `(${inn.map((x) => `openfda.generic_name:"${x}"`).join(' AND ')}) AND ${RX}`;
        let results = await openfda(search, 100);
        if (results === null) { console.log(`  ⏸ transient error on ${slug} — cooling down 60s`); await sleep(60000); results = await openfda(search, 100); }
        if (results === null) { stats.skipped++; continue; }
        c.substance = results.map((r) => ({ ...r })); // full records (needed for sections)
        saveCache(slug, c);
      }
      const subHits = (c.substance || []).filter((r) => isRx(r) && sameActives(m.inn, r.openfda?.generic_name?.[0] || ''));
      if (subHits.length) { chosen = subHits.sort((a, b) => rank(b) - rank(a))[0]; match = 'substance'; }
    }
    if (!chosen) { stats.none++; continue; }
    const sections = parse(chosen);
    if (!sections) { stats.none++; continue; }
    const of = chosen.openfda || {};
    const doc = {
      slug, brand: (match === 'brand' ? matchedBrand(chosen, want) : of.brand_name?.[0]) || m.n, inn: m.inn,
      usBrand: (match === 'brand' ? matchedBrand(chosen, want) : of.brand_name?.[0]) || null,
      usGeneric: of.generic_name?.[0] || null,
      usRoute: of.route?.[0] || null,
      usApplication: of.application_number?.[0] || null,
      match, // 'brand' = same product name in the US; 'substance' = different US product, same active substance
      effective: chosen.effective_time ? `${chosen.effective_time.slice(0, 4)}-${chosen.effective_time.slice(4, 6)}-${chosen.effective_time.slice(6, 8)}` : null, // label version date (openFDA effective_time)
      retrieved: (() => { try { return new Date(statSync(cacheFile(slug)).mtimeMs).toISOString().slice(0, 10); } catch { return null; } })(),
      url: `https://labels.fda.gov/`, splSetId: chosen.set_id || null,
      dailymed: chosen.set_id ? `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${chosen.set_id}` : 'https://www.accessdata.fda.gov/scripts/cder/daf/',
      source: 'openFDA drug label (US Prescribing Information)', sections,
    };
    const why = regressed(slug, doc);
    if (why) {                                                     // keep the good file already on disk
      const prev = JSON.parse(readFileSync(join(OUT_DIR, `${slug}.json`), 'utf8'));
      guarded.push(`${slug} (${why})`);
      index.drugs[slug] = { brand: prev.brand, inn: prev.inn, match: prev.match, usGeneric: prev.usGeneric || null };
      stats[prev.match] = (stats[prev.match] || 0) + 1;
    } else {
      writeFileSync(join(OUT_DIR, `${slug}.json`), JSON.stringify(doc));
      index.drugs[slug] = { brand: doc.brand, inn: m.inn, match, usGeneric: of.generic_name?.[0] || null };
      stats[match]++;
    }
    if (done % 100 === 0) process.stdout.write(`  …${done}/${drugs.length}  brand:${stats.brand} substance:${stats.substance} none:${stats.none} (${apiCalls} calls)\n`);
  }

  if (guarded.length) index.guarded = guarded; else delete index.guarded;

  // Remove per-drug files for slugs that no longer have an acceptable US label.
  let removed = 0;
  for (const f of readdirSync(OUT_DIR)) {
    if (!f.endsWith('.json')) continue;
    const slug = f.replace(/\.json$/, '');
    if (!index.drugs[slug] && !stats.skipped) { try { unlinkSync(join(OUT_DIR, f)); removed++; } catch { /* ignore */ } }
  }

  index.count = Object.keys(index.drugs).length;
  index.generated = process.env.STAMP || cacheStamp(CACHE2, '.json') || index.generated;
  writeFileSync(INDEX, JSON.stringify(index));
  console.log(`\nDONE. brand-matched:${stats.brand} substance-matched:${stats.substance} noUSlabel:${stats.none} skipped(no calls left):${stats.skipped} removedStale:${removed} guarded(kept previous file):${guarded.length} apiCalls:${apiCalls}`);
  if (guarded.length) console.log(`  guarded: ${guarded.join('; ')}`);
  console.log(`Manifest: ${index.count} drugs → uspi-index.json ; per-drug JSON → uspi-data/`);
}
run();
