// Drift report: does the EU SmPC corpus still match what EMA publishes today?
//
// The weekly label refresh only touches what it thinks changed, so a missed
// update would otherwise stay wrong silently while every later run reports
// success. This compares, independently of the refresh, every stored extract
// with EMA's EPAR document list (ema-feed.mjs) and the authorised list:
//   behind   EMA updated the product information after our extract was made
//   missing  authorised medicine without an extract
//   stale    extract of a medicine that is no longer authorised
// plus the refresh's own account of what it could not do (smpc-index.json:
// incomplete, unchecked, uncheckedWhy, failed, failedWhy, downloadFailed).
//
// PROBLEMS (they turn the weekly run red — GitHub mails the owner) are failures
// of OURS, or gaps nobody else reports:
//   • a label behind EMA for more than MAX_DAYS
//   • a stale extract
//   • a missing extract never attempted, more than MAX_DAYS after the authorisation
//   • a missing extract EMA's document list names a PI PDF for, still not
//     ingested LISTED_GRACE_DAYS after EMA listed it — EMA has published, the
//     failure is ours (wrong URL / product number, parse error, block)
//   • a missing extract with nothing listed at EMA FAILED_MAX_DAYS after the
//     decision — a backstop for a broken product-number join; before that it is
//     EMA publishing late, which the approval → label queue
//     (scripts/label-reconciliation.py) already reports as a warning after 30 days
//   • an incomplete refresh that left a REAL gap: the run was cut short (EMA
//     blocking, time budget, download limit), a label EMA's list had marked as
//     changed was not fetched, a label stayed unchecked two runs in a row, or
//     EMA refused more than SAMPLE_FAIL_SHARE of the rotating cross-check sample
//   • the EMA document list itself unavailable (drift not measurable)
// NOT a problem, only reported: refused cross-check HEADs for labels EMA's list
// says are unchanged (on 5., 12. and 19.10.2026 the run was red for nothing
// else), and a changed label whose download failed once — its old extract is
// kept, it shows as "behind" and escalates after MAX_DAYS.
//
//   node scripts/smpc/drift-report.mjs [--json out.json] [--md out.md]
//        [--max-days 14] [--listed-grace-days 7] [--failed-max-days 90]
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
const LISTED_GRACE_DAYS = parseInt(arg('--listed-grace-days', '7'), 10); // one weekly run after EMA lists the PI
const FAILED_MAX_DAYS = parseInt(arg('--failed-max-days', '90'), 10);   // backstop: nothing at EMA this long after the decision looks like a broken join
const SAMPLE_FAIL_SHARE = 0.5;                                          // more of the cross-check sample refused than this = EMA blocked the run

const authorised = JSON.parse(readFileSync(join(root, 'ema-medicines.json'), 'utf8')).authorised;
const meds = new Map();
for (const m of authorised) { const s = slugOf(m); if (s && !meds.has(s)) meds.set(s, m); }
const index = (() => { try { return JSON.parse(readFileSync(join(root, 'smpc-index.json'), 'utf8')); } catch { return {}; } })();
const knownFailed = new Set(index.failed || []);
const failedWhy = index.failedWhy || {};
const uncheckedWhy = index.uncheckedWhy || {};
const downloadFailed = index.downloadFailed || [];
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
    if (!known) { problem = age !== null && age > MAX_DAYS; why = 'not attempted by the refresh'; }
    else if (listed) { problem = listedDays !== null && listedDays > LISTED_GRACE_DAYS; why = `EMA lists the PI since ${day(listed.updated)}, ingest failed (${reason}) — ours to fix`; }
    else { problem = age !== null && age > FAILED_MAX_DAYS; why = `${reason}; EMA has not published the PI (not in EMA's list) — queue warning, red only after ${FAILED_MAX_DAYS} d`; }
    missing.push({ slug, brand: m.n, authorised: m.d || null, days: age, known, reason, emaListed: listed ? day(listed.updated) : null, problem, why });
    continue;
  }
  if (!feed) continue;
  const hit = feed.lookup(m);
  if (!hit) { notListed.push(slug); continue; }
  let prev; try { prev = JSON.parse(readFileSync(join(root, 'smpc-data', `${slug}.json`), 'utf8')); } catch { prev = null; }
  if (prev && feedNewer(hit.updated, prev)) {
    const days = daysSince(hit.updated);
    const lastRun = downloadFailed.includes(slug) || failedWhy[slug] === 'fetch' ? 'download failed last run, old extract kept'
      : failedWhy[slug] ? `${failedWhy[slug]} failed last run` : uncheckedWhy[slug] ? `unchecked last run (${uncheckedWhy[slug].code})` : '';
    behind.push({ slug, brand: m.n, ours: day(prev.emaUpdated || prev.sourceModified || prev.retrieved), ema: day(hit.updated), days, lastRun, problem: days > MAX_DAYS });
  }
}
for (const slug of files) if (!meds.has(slug)) stale.push(slug);
behind.sort((a, b) => b.days - a.days);

// The refresh's own account of what it could not do — and whether that is a gap.
const inc = index.incomplete || null;
const legacy = !!inc && inc.changed === undefined;                      // written by an older extractor: no breakdown — treat as before
const cutShort = !!inc && /blocking|budget|limit/.test(inc.reason || '');
const sampleShare = inc && inc.sampleSize ? (inc.sample || 0) / inc.sampleSize : 0;
const incompleteWhy = !inc ? [] : [
  legacy && 'no breakdown recorded',
  cutShort && `run cut short (${inc.reason})`,
  inc.changed > 0 && `${inc.changed} label(s) EMA marked as changed not fetched`,
  inc.repeat > 0 && `${inc.repeat} label(s) unchecked two runs in a row`,
  sampleShare > SAMPLE_FAIL_SHARE && `EMA refused ${inc.sample} of ${inc.sampleSize} cross-check HEADs`,
].filter(Boolean);
const incompleteProblem = incompleteWhy.length > 0;
const codes = inc?.codes ? Object.entries(inc.codes).map(([c, n]) => `${c}×${n}`).join(' ') : '';

const problems =
  behind.filter((x) => x.problem).length + missing.filter((x) => x.problem).length + stale.length + (incompleteProblem ? 1 : 0) + (feed ? 0 : 1);
const report = {
  date: new Date().toISOString().slice(0, 10), emaList: feed?.timestamp || null, maxDays: MAX_DAYS, listedGraceDays: LISTED_GRACE_DAYS, failedMaxDays: FAILED_MAX_DAYS,
  authorised: meds.size, extracts: files.size, problems,
  incomplete: inc, incompleteProblem, incompleteWhy, downloadFailed, behind, missing, stale, notListed,
};

const md = [];
md.push(`## EU label drift vs EMA — ${report.date}`);
md.push('');
md.push(feed ? `EMA document list of ${feed.timestamp || '?'} · ${meds.size} authorised medicines · ${files.size} label extracts` : '⚠ EMA document list unavailable — drift not measured');
md.push('');
md.push(`**${problems ? `REVIEW NEEDED — ${problems} problem(s)` : 'OK — corpus matches EMA'}** (tolerance ${MAX_DAYS} days; an ingest EMA has published: ${LISTED_GRACE_DAYS} days; nothing published at EMA: ${FAILED_MAX_DAYS} days backstop)`);
md.push('');
const incompleteCell = !inc ? 'yes'
  : `no — ${inc.reason}: ${inc.unchecked} unchecked`
    + (legacy ? '' : ` (changed at EMA: ${inc.changed}, cross-check sample: ${inc.sample} of ${inc.sampleSize}, carried over: ${inc.carry}, unlisted: ${inc.unlisted}, repeat: ${inc.repeat}${codes ? `; ${codes}` : ''})`)
    + (incompleteProblem ? ` ⚠ ${incompleteWhy.join('; ')}` : " — EMA's list says these labels are unchanged: no gap, checked first next run");
md.push(`| check | count |\n|---|---|\n| labels behind EMA | ${behind.length} (over ${MAX_DAYS} days: ${behind.filter((x) => x.problem).length}) |\n| authorised medicines without a label | ${missing.length} (ingest failures: ${missing.filter((x) => x.known).length}, past tolerance: ${missing.filter((x) => x.problem).length}) |\n| labels of medicines no longer authorised | ${stale.length} |\n| labels not in EMA's list (not measurable) | ${notListed.length} |\n| downloads failed, old extract kept | ${downloadFailed.length ? downloadFailed.join(', ') : 0} |\n| last refresh complete | ${incompleteCell} |`);
if (behind.length) {
  md.push('', '| behind | ours | EMA | days | last run |', '|---|---|---|---|---|');
  for (const x of behind.slice(0, 40)) md.push(`| ${x.brand} (${x.slug}) | ${x.ours} | ${x.ema} | ${x.days}${x.problem ? ' ⚠' : ''} | ${x.lastRun} |`);
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
