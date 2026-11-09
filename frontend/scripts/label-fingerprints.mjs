// Source fingerprints for label extracts that do not carry one — the ledger
// frontend/label-fingerprints.json.
//
// WHY THIS EXISTS
//   Gate G7 of validate-release.py tells a regulatory change from a parser
//   fault by the fingerprint of the SOURCE an extract was parsed from: same
//   fingerprint + different sections = the parser changed the text, not the
//   regulator. The extractors only started recording `sourceSha` in autumn
//   2026; on 9.11.2026 920 of 1,563 EU extracts and 1,139 of 1,252 US extracts
//   had none, so "0 labels with parser drift" covered a fraction of the corpus.
//
// WHAT IT DOES
//   For every extract without a usable fingerprint it goes back to the source,
//   extracts it again with the CURRENT parser and records the fingerprint only
//   when the result is identical to the stored extract, section for section:
//     EU  the cached PDF text (scripts/smpc/.cache/<slug>.txt) whose file date
//         is the extract's `retrieved` day → sha256 of that text, exactly what
//         smpc/extract-all.mjs records for new extracts;
//     US  openFDA's current record of the stored set ID, same version date
//         (`effective`) → labelSha() of uspi/extract-all.mjs.
//   An extract that cannot be reproduced gets NO fingerprint and is listed.
//
//   The fingerprints go into a ledger next to the corpus, not into the label
//   files: every label file is hash-bound to the data release (copy-data.mjs →
//   label index → services/labelFiles.ts), so rewriting 2,000 files to add one
//   field would make every label bundled with the App Store build "from a
//   different data release" for offline users. An entry applies only while the
//   extract still is the one that was verified (EU: same `retrieved` day; US:
//   same set ID + version date); an extract rewritten by an extractor carries
//   its own fingerprint, which wins.
//
// Usage (from frontend/):
//   node scripts/label-fingerprints.mjs              verify + record what is missing, drop dead entries
//   node scripts/label-fingerprints.mjs --dry-run    the same, nothing written
//   node scripts/label-fingerprints.mjs --prune      offline: only drop entries whose extract was replaced or removed (weekly CI)
//   node scripts/label-fingerprints.mjs --coverage   offline: print how many extracts have a fingerprint
//   --no-eu / --no-us                                 one corpus only (the EU side needs the local text cache)
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
export const LEDGER = join(root, 'label-fingerprints.json');
const CORPORA = { smpc: 'smpc-data', uspi: 'uspi-data' };
const ABOUT = 'Source fingerprints of label extracts that do not carry their own (scripts/label-fingerprints.mjs). Each entry was verified on day `v` by extracting the label again from its source — EU: the cached PDF text of the `retrieved` day; US: the openFDA record of that set ID and version date — and finding every section identical to the stored extract. validate-release.py (gate G7) uses an entry only while the extract still has that retrieval day / set ID + version date.';

// ---- pure helpers (also used by copy-data.mjs and the tests) -----------------
/** The ledger's fingerprint for this extract, or null when the entry belongs to an earlier extract. */
export const ledgerSha = (corpus, doc, entry) => {
  if (!entry || !doc) return null;
  if (corpus === 'smpc') return entry.retrieved && entry.retrieved === doc.retrieved ? entry.sha : null;
  return entry.setId && entry.setId === doc.splSetId && entry.effective === doc.effective ? entry.sha : null;
};
/**
 * The fingerprint G7 compares. EU: the extract's own, else the ledger's. US: an
 * own fingerprint counts only when it covers the label alone (`shaScope`, see
 * labelSha in uspi/extract-all.mjs); older ones also hashed openFDA's
 * harmonisation block and are superseded by a ledger entry.
 * Mirrored in validate-release.py (`fingerprint`).
 */
export const fingerprintOf = (corpus, doc, entry) => {
  if (!doc) return null;
  if (corpus === 'smpc') return doc.sourceSha || ledgerSha(corpus, doc, entry);
  if (doc.shaScope === 'label' && doc.sourceSha) return doc.sourceSha;
  return ledgerSha(corpus, doc, entry) || doc.sourceSha || null;
};
/** Does the extract still need a ledger entry (no own fingerprint of the current kind)? */
export const needsEntry = (corpus, doc) => (corpus === 'smpc' ? !doc.sourceSha : !(doc.shaScope === 'label' && doc.sourceSha));

export const readLedger = (file = LEDGER) => {
  try { const j = JSON.parse(readFileSync(file, 'utf8')); return { smpc: j.smpc || {}, uspi: j.uspi || {} }; } catch { return { smpc: {}, uspi: {} }; }
};
/** One entry per line, sorted — a weekly change is a readable diff. */
export const ledgerText = (ledger) => {
  const block = (o) => Object.keys(o).sort().map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(o[k])}`).join(',\n');
  return `{\n "about": ${JSON.stringify(ABOUT)},\n "smpc": {\n${block(ledger.smpc)}\n },\n "uspi": {\n${block(ledger.uspi)}\n }\n}\n`;
};
/** Entries whose extract is gone, was replaced, or now carries its own fingerprint. */
export const deadEntries = (corpus, docs, entries) =>
  Object.keys(entries).filter((slug) => { const d = docs.get(slug); return !d || !needsEntry(corpus, d) || !ledgerSha(corpus, d, entries[slug]); });
/** { total, own, ledger, none: [slugs] } for one corpus. */
export const coverage = (corpus, docs, entries) => {
  const c = { total: docs.size, own: 0, ledger: 0, none: [] };
  for (const [slug, d] of docs) {
    if (!needsEntry(corpus, d)) c.own++;
    else if (ledgerSha(corpus, d, entries[slug])) c.ledger++;
    else c.none.push(slug);
  }
  return c;
};
export const readCorpus = (corpus, base = root) => {
  const dir = join(base, CORPORA[corpus]), docs = new Map();
  if (!existsSync(dir)) return docs;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try { docs.set(f.slice(0, -5), JSON.parse(readFileSync(join(dir, f), 'utf8'))); } catch { /* G5 reports unreadable files */ }
  }
  return docs;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- EU: verify against the cached PDF text ------------------------------------
async function verifyEU(docs, ledger, today, out) {
  const { parseSections } = await import('./smpc/extract-all.mjs');
  const cache = join(here, 'smpc', '.cache');
  for (const [slug, d] of docs) {
    if (!needsEntry('smpc', d) || ledgerSha('smpc', d, ledger.smpc[slug])) continue;
    const file = join(cache, `${slug}.txt`);
    if (!existsSync(file)) { out.unresolved.push(`EU ${slug}: no cached source text (run on the machine that holds scripts/smpc/.cache, or let the weekly refresh re-download it)`); continue; }
    const fetched = new Date(statSync(file).mtimeMs).toISOString().slice(0, 10);
    if (fetched !== d.retrieved) { out.unresolved.push(`EU ${slug}: cached text is of ${fetched}, the extract of ${d.retrieved}`); continue; }
    const text = readFileSync(file, 'utf8');
    if (!same(parseSections(text), d.sections)) { out.unresolved.push(`EU ${slug}: extracting the cached text again gives different sections — look before fingerprinting`); continue; }
    ledger.smpc[slug] = { sha: createHash('sha256').update(text).digest('hex'), retrieved: d.retrieved, v: today };
    out.added.smpc++;
  }
}

// ---- US: verify against openFDA's current record of the same label version -----
async function verifyUS(docs, ledger, today, out) {
  const { parse, labelSha } = await import('./uspi/extract-all.mjs');
  const need = [...docs].filter(([slug, d]) => needsEntry('uspi', d) && !ledgerSha('uspi', d, ledger.uspi[slug]));
  const bySet = new Map();
  for (const [slug, d] of need) {
    if (!d.splSetId) { out.unresolved.push(`US ${slug}: extract has no set ID`); continue; }
    if (!bySet.has(d.splSetId)) bySet.set(d.splSetId, []);
    bySet.get(d.splSetId).push(slug);
  }
  const ids = [...bySet.keys()];
  const iso = (t) => (t && /^\d{8}$/.test(t) ? `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}` : null);
  if (ids.length) console.log(`US: asking openFDA for ${ids.length} label(s) in ${Math.ceil(ids.length / 50)} queries`);
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const url = `https://api.fda.gov/drug/label.json?search=${encodeURIComponent(`(${batch.map((id) => `set_id:"${id}"`).join(' ')})`)}&limit=100`;
    let results = null;
    for (let attempt = 0; attempt < 3 && !results; attempt++) {
      try { results = JSON.parse(execFileSync('curl', ['-sL', '--max-time', '60', url], { encoding: 'utf8', maxBuffer: 200 * 1024 * 1024 })).results || null; } catch { results = null; }
      if (!results) execFileSync('sleep', [String(10 * (attempt + 1))]);
    }
    if (!results) { for (const id of batch) for (const slug of bySet.get(id)) out.unresolved.push(`US ${slug}: openFDA did not answer`); continue; }
    const bySetId = new Map(results.map((r) => [r.set_id, r]));
    for (const id of batch) {
      const r = bySetId.get(id);
      for (const slug of bySet.get(id)) {
        const d = docs.get(slug);
        if (!r) { out.unresolved.push(`US ${slug}: openFDA no longer serves set ID ${id}`); continue; }
        const eff = iso(r.effective_time);
        if (eff !== d.effective) { out.unresolved.push(`US ${slug}: openFDA holds version ${eff}, the extract is of ${d.effective} — the weekly refresh will re-extract it`); continue; }
        if (!same(parse(r), d.sections)) { out.unresolved.push(`US ${slug}: extracting openFDA's record again gives different sections — look before fingerprinting`); continue; }
        ledger.uspi[slug] = { sha: labelSha(r), setId: id, effective: d.effective, splId: r.id || null, v: today };
        out.added.uspi++;
      }
    }
    execFileSync('sleep', ['0.4']);
  }
}

async function run() {
  const arg = (f) => process.argv.includes(f);
  const today = process.env.STAMP || new Date().toISOString().slice(0, 10);
  const ledger = readLedger();
  const docs = { smpc: readCorpus('smpc'), uspi: readCorpus('uspi') };
  const line = (c, k) => `${k === 'smpc' ? 'EU SmPC' : 'US USPI'}: ${c.total - c.none.length} of ${c.total} extracts have a source fingerprint (own ${c.own}, ledger ${c.ledger}), ${c.none.length} without`;
  if (arg('--coverage')) {
    for (const k of ['smpc', 'uspi']) { const c = coverage(k, docs[k], ledger[k]); console.log(line(c, k) + (c.none.length ? `: ${c.none.slice(0, 20).join(', ')}` : '')); }
    return;
  }
  const out = { added: { smpc: 0, uspi: 0 }, pruned: { smpc: 0, uspi: 0 }, unresolved: [] };
  for (const k of ['smpc', 'uspi']) for (const slug of deadEntries(k, docs[k], ledger[k])) { delete ledger[k][slug]; out.pruned[k]++; }
  if (!arg('--prune')) {
    if (!arg('--no-eu')) await verifyEU(docs.smpc, ledger, today, out);
    if (!arg('--no-us')) await verifyUS(docs.uspi, ledger, today, out);
  }
  const text = ledgerText(ledger);
  const changed = !existsSync(LEDGER) || readFileSync(LEDGER, 'utf8') !== text;
  if (changed && !arg('--dry-run')) writeFileSync(LEDGER, text);
  console.log(`fingerprints verified and recorded: EU ${out.added.smpc}, US ${out.added.uspi}; entries dropped (extract replaced or removed): EU ${out.pruned.smpc}, US ${out.pruned.uspi}${arg('--dry-run') ? ' — DRY RUN, nothing written' : changed ? ' — ledger updated' : ' — ledger unchanged'}`);
  for (const k of ['smpc', 'uspi']) console.log(line(coverage(k, docs[k], ledger[k]), k));
  if (out.unresolved.length) { console.log(`\nNOT fingerprinted (${out.unresolved.length}):`); for (const u of out.unresolved) console.log(`  - ${u}`); }
}
// Run only as a script — copy-data.mjs and the tests import the helpers.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) run();
