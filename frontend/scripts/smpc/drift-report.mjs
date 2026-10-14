// Drift report: does the EU SmPC corpus still match what EMA publishes today?
//
// The weekly label refresh only touches what it thinks changed, so a missed
// update would otherwise stay wrong silently while every later run reports
// success. This compares, independently of the refresh, every stored extract
// with EMA's EPAR document list (ema-feed.mjs) and the authorised list:
//   behind   EMA updated the product information after our extract was made
//   missing  authorised medicine without an extract
//   stale    extract of a medicine that is no longer authorised
// plus the refresh's own "incomplete" flag. Problems = behind > MAX_DAYS days,
// stale extracts, missing extracts of medicines authorised > MAX_DAYS days ago,
// or an incomplete run. A missing extract the refresh could not ingest
// (index.failed, reason in index.failedWhy: 404 / fetch / parse) gets more
// rope, but not for good: EMA publishes the EPAR about two weeks after the
// Commission decision, so it is a problem once the medicine is more than
// FAILED_MAX_DAYS past its decision, or LISTED_GRACE_DAYS after EMA's own
// document list names its product-information PDF (then EMA has published,
// and the failure is ours: wrong URL / product number, parse error, block).
//
//   node scripts/smpc/drift-report.mjs [--json out.json] [--md out.md]
//        [--max-days 14] [--failed-max-days 28] [--listed-grace-days 7]
// Writes `problems=<n>` to $GITHUB_OUTPUT when set; always exits 0 (the
// workflow decides what a problem means for the run).
import { readFileSync, writeFileSync, readdirSync, existsSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFeed, feedNewer, daysSince, day, slugOf } from './ema-feed.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const MAX_DAYS = parseInt(arg('--max-days', '14'), 10);
const FAILED_MAX_DAYS = parseInt(arg('--failed-max-days', '28'), 10);   // twice EMA's ~2-week EPAR publication time
const LISTED_GRACE_DAYS = parseInt(arg('--listed-grace-days', '7'), 10); // one weekly run after EMA lists the PI

const authorised = JSON.parse(readFileSync(join(root, 'ema-medicines.json'), 'utf8')).authorised;
const meds = new Map();
for (const m of authorised) { const s = slugOf(m); if (s && !meds.has(s)) meds.set(s, m); }
const index = (() => { try { return JSON.parse(readFileSync(join(root, 'smpc-index.json'), 'utf8')); } catch { return {}; } })();
const knownFailed = new Set(index.failed || []);
const failedWhy = index.failedWhy || {};
const files = new Set(readdirSync(join(root, 'smpc-data')).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)));
const feed = loadFeed(join(here, '.cache'), [...meds.values()]);

const behind = [], missing = [], stale = [], notListed = [];
for (const [slug, m] of meds) {
  if (!files.has(slug)) {
    const age = m.d ? daysSince(m.d) : null;
    const known = knownFailed.has(slug);
    const reason = known ? failedWhy[slug] || 'failed' : null;
    const listed = known && feed ? feed.lookup(m) : null;        // EMA's document list already names a PI PDF for it?
    const listedDays = listed ? daysSince(listed.updated) : null;
    let problem, why;
    if (!known) { problem = age !== null && age > MAX_DAYS; why = 'no extract'; }
    else if (listed) { problem = listedDays !== null && listedDays > LISTED_GRACE_DAYS; why = `EMA lists the PI since ${day(listed.updated)}, ingest failed (${reason})`; }
    else { problem = age !== null && age > FAILED_MAX_DAYS; why = `${reason}, not in EMA's document list (EMA late, or wrong URL / product number)`; }
    missing.push({ slug, brand: m.n, authorised: m.d || null, days: age, known, reason, emaListed: listed ? day(listed.updated) : null, problem, why });
    continue;
  }
  if (!feed) continue;
  const hit = feed.lookup(m);
  if (!hit) { notListed.push(slug); continue; }
  let prev; try { prev = JSON.parse(readFileSync(join(root, 'smpc-data', `${slug}.json`), 'utf8')); } catch { prev = null; }
  if (prev && feedNewer(hit.updated, prev)) {
    const days = daysSince(hit.updated);
    behind.push({ slug, brand: m.n, ours: day(prev.emaUpdated || prev.sourceModified || prev.retrieved), ema: day(hit.updated), days, problem: days > MAX_DAYS });
  }
}
for (const slug of files) if (!meds.has(slug)) stale.push(slug);
behind.sort((a, b) => b.days - a.days);

const problems =
  behind.filter((x) => x.problem).length + missing.filter((x) => x.problem).length + stale.length + (index.incomplete ? 1 : 0) + (feed ? 0 : 1);
const report = {
  date: new Date().toISOString().slice(0, 10), emaList: feed?.timestamp || null, maxDays: MAX_DAYS, failedMaxDays: FAILED_MAX_DAYS, listedGraceDays: LISTED_GRACE_DAYS,
  authorised: meds.size, extracts: files.size, problems,
  incomplete: index.incomplete || null, behind, missing, stale, notListed,
};

const md = [];
md.push(`## EU label drift vs EMA — ${report.date}`);
md.push('');
md.push(feed ? `EMA document list of ${feed.timestamp || '?'} · ${meds.size} authorised medicines · ${files.size} label extracts` : '⚠ EMA document list unavailable — drift not measured');
md.push('');
md.push(`**${problems ? `REVIEW NEEDED — ${problems} problem(s)` : 'OK — corpus matches EMA'}** (tolerance ${MAX_DAYS} days; failed ingests ${FAILED_MAX_DAYS} days after the decision or ${LISTED_GRACE_DAYS} days after EMA lists the PI)`);
md.push('');
md.push(`| check | count |\n|---|---|\n| labels behind EMA | ${behind.length} (over ${MAX_DAYS} days: ${behind.filter((x) => x.problem).length}) |\n| authorised medicines without a label | ${missing.length} (ingest failures: ${missing.filter((x) => x.known).length}, past tolerance: ${missing.filter((x) => x.problem).length}) |\n| labels of medicines no longer authorised | ${stale.length} |\n| labels not in EMA's list (not measurable) | ${notListed.length} |\n| last refresh complete | ${index.incomplete ? `no — ${index.incomplete.reason}, ${index.incomplete.unchecked} unchecked` : 'yes'} |`);
if (behind.length) {
  md.push('', '| behind | ours | EMA | days |', '|---|---|---|---|');
  for (const x of behind.slice(0, 40)) md.push(`| ${x.brand} (${x.slug}) | ${x.ours} | ${x.ema} | ${x.days}${x.problem ? ' ⚠' : ''} |`);
}
if (missing.length) {
  md.push('', '| without a label | authorised | days | status |', '|---|---|---|---|');
  for (const x of [...missing].sort((a, b) => (b.days ?? -1) - (a.days ?? -1)).slice(0, 40)) md.push(`| ${x.brand} (${x.slug}) | ${x.authorised || '?'} | ${x.days ?? '?'} | ${x.why}${x.problem ? ' ⚠' : ''} |`);
}
if (stale.length) md.push('', `⚠ No longer authorised: ${stale.join(', ')}`);
const text = md.join('\n') + '\n';

const out = arg('--json'); if (out) writeFileSync(out, JSON.stringify(report, null, 1));
const mdOut = arg('--md'); if (mdOut) writeFileSync(mdOut, text);
if (process.env.GITHUB_OUTPUT && existsSync(dirname(process.env.GITHUB_OUTPUT))) appendFileSync(process.env.GITHUB_OUTPUT, `problems=${problems}\n`);
console.log(text);
