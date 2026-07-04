// US Prescribing Information (USPI) extractor — the US counterpart to the SmPC
// pipeline. For every EU-authorised medicine it looks up the matching US label
// via the openFDA Structured Product Labeling API (already used by the app),
// extracts the PLR sections, and writes one JSON per drug keyed by the SAME EU
// slug — so the app can put a molecule's EU SmPC and US USPI side by side.
//
// openFDA returns clean structured fields (no PDF parsing) plus separate
// *_table fields holding the frequency tables as HTML, which we sanitise and
// bundle for native rendering.
//
// Usage:
//   node scripts/uspi/extract-all.mjs           fetch missing + parse
//   node scripts/uspi/extract-all.mjs 200        cap NEW lookups to 200
//   REPARSE=1 node scripts/uspi/extract-all.mjs  re-parse cached responses only
//   FORCE=1 ...                                   ignore cache
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const OUT_DIR = join(root, 'uspi-data');
const INDEX = join(root, 'uspi-index.json');
const CACHE = join(here, '.cache');

const slugOf = (m) => ((m.url || '').split('/EPAR/')[1]?.trim() || '').replace(/-previously-.*$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
      .replace(/<(table|thead|tbody|tfoot|tr|th|td|caption)[^>]*>/gi, '<$1>')
      .replace(/<(?!\/?(?:table|thead|tbody|tfoot|tr|th|td|caption)\b)[^>]*>/gi, '') // drop any other tag
      .replace(/<th>\s*<th>/gi, '<th></th><th>') // repair rowspan-collapsed empty header cells
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

async function run() {
  const limit = process.argv[2] ? parseInt(process.argv[2], 10) : Infinity;
  const reparse = process.env.REPARSE === '1';
  for (const d of [OUT_DIR, CACHE]) mkdirSync(d, { recursive: true });
  const data = JSON.parse(readFileSync(join(root, 'ema-medicines.json'), 'utf8'));

  const seen = new Set();
  const drugs = data.authorised.filter((m) => {
    const s = slugOf(m);
    if (!s || !m.inn || seen.has(s)) return false;
    seen.add(s); return true;
  });

  const index = { generated: process.env.STAMP || 'dev', source: 'openFDA drug label (US Prescribing Information)', drugs: {} };
  let done = 0, ok = 0, fetched = 0, miss = 0, consecutiveFail = 0, cooldowns = 0;

  for (const m of drugs) {
    const slug = slugOf(m);
    done++;
    const cacheFile = join(CACHE, `${slug}.json`);
    const cached = existsSync(cacheFile);
    if (!cached && (reparse || fetched >= limit)) continue;
    let r;
    if (cached) { try { const c = readFileSync(cacheFile, 'utf8'); r = c === 'null' ? null : JSON.parse(c); } catch { r = null; } }
    else {
      const q = encodeURIComponent(`openfda.generic_name:"${m.inn}"`);
      const url = `https://api.fda.gov/drug/label.json?search=${q}&limit=1`;
      let body = '';
      try { body = execFileSync('curl', ['-sL', '--max-time', '30', url], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }); } catch { body = ''; }
      let j = null; try { j = JSON.parse(body); } catch { /* rate-limited */ }
      if (j && j.results && j.results[0]) { r = j.results[0]; writeFileSync(cacheFile, JSON.stringify(r)); fetched++; consecutiveFail = 0; }
      else if (j && j.error && /NOT_FOUND/i.test(j.error.code || '')) { r = null; writeFileSync(cacheFile, 'null'); fetched++; consecutiveFail = 0; }
      else { // rate-limit / transient
        consecutiveFail++;
        if (consecutiveFail >= 6) {
          if (++cooldowns > 4) { console.log(`\n⚠ openFDA still failing after ${cooldowns} cooldowns — stopping (cache persists, ${ok} done).`); break; }
          console.log(`\n⏸ openFDA rate-limited — cooling down 60s (${cooldowns}/4)…`); await sleep(60000); consecutiveFail = 0;
        }
        continue; // retry this drug next run
      }
      await sleep(400 + Math.floor(Math.random() * 300)); // ~2/s, well under openFDA's 240/min
    }
    if (!r) { miss++; continue; }
    const sections = parse(r);
    if (!sections) { miss++; continue; }
    writeFileSync(join(OUT_DIR, `${slug}.json`), JSON.stringify({
      slug, brand: (r.openfda?.brand_name?.[0]) || m.n, inn: m.inn,
      usBrand: r.openfda?.brand_name?.[0] || null,
      url: `https://labels.fda.gov/`, splSetId: r.set_id || null,
      dailymed: r.set_id ? `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${r.set_id}` : 'https://www.accessdata.fda.gov/scripts/cder/daf/',
      source: 'openFDA drug label (US Prescribing Information)', sections,
    }));
    index.drugs[slug] = { brand: (r.openfda?.brand_name?.[0]) || m.n, inn: m.inn };
    ok++;
    if (done % 25 === 0) process.stdout.write(`  …${done}/${drugs.length}  matched:${ok} fetched:${fetched} noUSlabel:${miss}\n`);
  }

  index.count = Object.keys(index.drugs).length;
  writeFileSync(INDEX, JSON.stringify(index));
  console.log(`\nDONE. US labels matched:${ok} newLookups:${fetched} noUSlabel:${miss}`);
  console.log(`Manifest: ${index.count} drugs → uspi-index.json ; per-drug JSON → uspi-data/`);
}
run();
