// Tests for the weekly EU label refresh under EMA rate limiting:
// scripts/smpc/throttle.mjs (pure pacing rules) and the changed-only run of
// scripts/smpc/extract-all.mjs + scripts/smpc/drift-report.mjs end to end.
//
// No network. Each end-to-end test builds a small world in a temporary folder
// (SMPC_ROOT): 1,010 stored label extracts, EMA's document list, last week's
// smpc-index.json — and puts a fake `curl` and `pdftotext` first on PATH. The
// fake curl answers like EMA's PDF server according to a rule file (200, 429,
// Retry-After …) and writes every request to a log, so the tests can assert
// WHAT was asked, in WHICH ORDER, and that nothing stored was lost.
// SLEEP_SCALE=0 skips the waiting. Background: on 16. and 23.11.2026 EMA
// refused the run's requests (HTTP 429); on 23.11. 99 optional checks were
// asked first and the 39 labels EMA had marked as changed were never fetched.
// Run: node --test --experimental-strip-types frontend/scripts/tests/ (npm test does).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRetryAfter, backoffMs, waitMs, createPacer, isBlock } from '../../scripts/smpc/throttle.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const EXTRACT = join(here, '..', 'smpc', 'extract-all.mjs');
const DRIFT = join(here, '..', 'smpc', 'drift-report.mjs');
const PDF_TEXT = join(here, 'fixtures', 'smpc', 'kymriah.txt');   // what the fake EMA serves as "the PDF"
const sha = (x) => createHash('sha256').update(x).digest('hex');

// ───────────────────────────── pacing rules ─────────────────────────────

test('Retry-After: seconds, HTTP date, the last response of a redirect chain, absent', () => {
  assert.equal(parseRetryAfter('HTTP/2 429 \r\nretry-after: 120\r\n\r\n'), 120000);
  assert.equal(parseRetryAfter('HTTP/2 429\nRetry-After:   7  \n'), 7000);
  const now = Date.parse('2026-11-23T08:00:00Z');
  assert.equal(parseRetryAfter('retry-after: Mon, 23 Nov 2026 08:05:00 GMT\r\n', now), 5 * 60000);
  assert.equal(parseRetryAfter('retry-after: Mon, 23 Nov 2026 07:00:00 GMT\r\n', now), 0, 'a date in the past is "now", never negative');
  assert.equal(parseRetryAfter('HTTP/2 301\r\nretry-after: 1\r\n\r\nHTTP/2 429\r\nretry-after: 30\r\n\r\n'), 30000);
  assert.equal(parseRetryAfter('HTTP/2 429 \r\ncontent-length: 0\r\n\r\n'), null);
  assert.equal(parseRetryAfter('retry-after: soon\r\n'), null);
  assert.equal(parseRetryAfter(''), null);
});

test('backoff doubles with every refusal in a row, stays within ±25 % and under the cap', () => {
  const mid = { rand: () => 0.5 };
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((n) => backoffMs(n, { base: 30000, cap: 600000, ...mid })), [30000, 60000, 120000, 240000, 480000, 600000]);
  assert.equal(backoffMs(1, { base: 30000, rand: () => 0 }), 22500);
  assert.equal(backoffMs(1, { base: 30000, rand: () => 1 }), 37500);
  assert.equal(backoffMs(40, { base: 30000, cap: 600000, rand: () => 1 }), 750000, 'never beyond cap + 25 %');
});

test('EMA\'s own Retry-After wins over the backoff, but is capped', () => {
  assert.equal(waitMs(90000, 5, { rand: () => 0 }), 90000);
  assert.equal(waitMs(6 * 3600000, 1, { rand: () => 0 }), 15 * 60000, 'an absurd Retry-After cannot stall the job for hours');
  assert.equal(waitMs(0, 3, { rand: () => 0 }), 0);
  assert.equal(waitMs(null, 2, { base: 30000, rand: () => 0.5 }), 60000);
});

test('pacer: the gap between requests widens after a refusal and narrows slowly after answers', () => {
  const p = createPacer({ min: 800, max: 15000, rand: () => 0 });
  assert.equal(p.next(), 800);
  assert.equal(p.next(2), 1600, 'downloads keep twice the gap');
  p.blocked(); p.blocked();
  assert.equal(p.next(), 3200);
  for (let i = 0; i < 10; i++) p.blocked();
  assert.equal(p.next(), 15000);
  p.ok();
  assert.equal(p.next(), 12000);
  for (let i = 0; i < 40; i++) p.ok();
  assert.equal(p.next(), 800);
  assert.ok(isBlock('429') && isBlock(403) && isBlock('503'));
  assert.ok(!isBlock('404') && !isBlock('timeout') && !isBlock('200'));
});

// ───────────────────────────── the test world ─────────────────────────────

const N = 1010;                                        // EMA's list is only trusted with ≥ 1,000 labels
const slug = (i) => `m${String(i).padStart(4, '0')}`;
const CHANGED = ['m0500', 'm0501', 'm0502'];           // EMA's list: updated after our extract
const CARRIED = ['m0900', 'm0901'];                    // optional checks last week's run did not reach
const UNLISTED = 'm1010';                              // stored, but EMA's list does not name it
const NEW = 'newmed';                                  // authorised, listed at EMA, no extract yet
const OLD = '2026-10-01T00:00:00Z', UPDATED = '2026-11-18T10:00:00Z';
const pi = (s) => `https://www.ema.europa.eu/en/documents/product-information/${s}-epar-product-information_en.pdf`;

const FAKE_CURL = `#!/usr/bin/env node
// Fake curl for smpc-refresh.test.mjs: answers like EMA's PDF server per the rule file in $FAKE_EMA.
const fs = require('fs');
const args = process.argv.slice(2);
const cfg = JSON.parse(fs.readFileSync(process.env.FAKE_EMA, 'utf8'));
const url = args[args.length - 1];
const isHead = args.includes('-sIL');
const flag = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const s = (/product-information\\/(.+?)-epar-product-information_en\\.pdf$/.exec(url) || [])[1] || url;
const method = isHead ? 'HEAD' : 'GET';
const line = method + ' ' + s;
const seen = fs.existsSync(cfg.log) ? fs.readFileSync(cfg.log, 'utf8').split('\\n').filter((l) => l === line).length : 0;
fs.appendFileSync(cfg.log, line + '\\n');
const rule = cfg[method][s] ?? cfg[method]['*'];       // one status, or a sequence (the last one repeats)
const code = Array.isArray(rule) ? rule[Math.min(seen, rule.length - 1)] : rule;
const headers = code === '200'
  ? 'HTTP/2 200 \\r\\nlast-modified: Thu, 01 Oct 2026 00:00:00 GMT\\r\\n\\r\\n'
  : 'HTTP/2 ' + code + ' \\r\\n' + (cfg.retryAfter != null ? 'retry-after: ' + cfg.retryAfter + '\\r\\n' : '') + '\\r\\n';
if (isHead) { process.stdout.write(headers); process.exit(0); }
if (flag('-D')) fs.writeFileSync(flag('-D'), headers);
if (flag('-o')) fs.writeFileSync(flag('-o'), code === '200' ? fs.readFileSync(cfg.pdf) : 'Too Many Requests');
process.stdout.write(code);
`;

function world({ unchecked = [...CARRIED, 'm0502'], headOffset = 0 } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'smpc-refresh-'));
  const bin = join(root, 'bin');
  for (const d of ['smpc-data', '.smpc-cache', 'bin']) mkdirSync(join(root, d));
  writeFileSync(join(bin, 'curl'), FAKE_CURL); chmodSync(join(bin, 'curl'), 0o755);
  writeFileSync(join(bin, 'pdftotext'), '#!/bin/sh\ncp "$2" "$3"\n'); chmodSync(join(bin, 'pdftotext'), 0o755);

  const med = (s, i) => ({ n: `Brand ${s}`, inn: `inn-${s}`, holder: 'Holder B.V.', num: `EMEA/H/C/${100000 + i}`, d: '2020-01-01', url: `https://www.ema.europa.eu/en/medicines/human/EPAR/${s}` });
  const authorised = [], rows = [];
  for (let i = 1; i <= N; i++) {
    const s = slug(i);
    authorised.push(med(s, i));
    if (s !== UNLISTED) rows.push({ type: 'product-information', ema_product_number: `EMEA/H/C/${100000 + i}`, last_updated_date: CHANGED.includes(s) ? UPDATED : OLD, document_url: pi(s) });
    const sec = (t) => ({ title: t, text: `Stored text of ${s}, section ${t}.` });
    writeFileSync(join(root, 'smpc-data', `${s}.json`), JSON.stringify({
      slug: s, brand: `Brand ${s}`, inn: `inn-${s}`, url: pi(s), retrieved: '2026-10-05', sourceSha: sha(`old source of ${s}`),
      sourceModified: '2026-10-01T00:00:00.000Z', emaUpdated: OLD,
      sections: Object.fromEntries(['4.1', '4.2', '4.3', '4.4', '4.8', '5.1', '5.2'].map((k) => [k, sec(k)])),
    }));
  }
  authorised.push(med(NEW, 5000));
  rows.push({ type: 'product-information', ema_product_number: 'EMEA/H/C/105000', last_updated_date: UPDATED, document_url: pi(NEW) });
  writeFileSync(join(root, 'ema-medicines.json'), JSON.stringify({ authorised }));
  writeFileSync(join(root, '.smpc-cache', 'epar-documents.json'), JSON.stringify({ meta: { timestamp: '2026-11-23T05:48:57Z' }, data: rows }));
  writeFileSync(join(root, 'smpc-index.json'), JSON.stringify({ drugs: {}, unchecked, headOffset }));

  const log = join(root, 'requests.log');
  const cfgFile = join(root, 'fake-ema.json');
  const env = { ...process.env, SMPC_ROOT: root, SLEEP_SCALE: '0', CHANGED_ONLY: '1', HEAD_SAMPLE: '10', HEAD_RETRY_PAUSE_MS: '0', FAKE_EMA: cfgFile, PATH: `${bin}:${process.env.PATH}` };
  delete env.GITHUB_OUTPUT; delete env.TIME_BUDGET_MIN; delete env.FORCE; delete env.REPARSE; delete env.ONLY; delete env.STAMP;
  const node = (script, args, extra = {}) => spawnSync(process.execPath, [script, ...args], { env: { ...env, ...extra }, encoding: 'utf8' });
  return {
    root,
    /** One weekly run against a fake EMA that answers per `rules` ({HEAD: {'*': '200', slug: ['429','200']}, GET: …, retryAfter}). */
    refresh(rules, extraEnv = {}) {
      writeFileSync(cfgFile, JSON.stringify({ log, pdf: PDF_TEXT, ...rules }));
      if (existsSync(log)) rmSync(log);
      const r = node(EXTRACT, ['200'], extraEnv);
      assert.equal(r.status, 0, `the refresh must finish normally\n${r.stdout}\n${r.stderr}`);
      return { out: r.stdout, requests: existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : [], index: JSON.parse(readFileSync(join(root, 'smpc-index.json'), 'utf8')) };
    },
    drift() {
      const out = join(root, 'drift.json');
      const r = node(DRIFT, ['--json', out]);
      assert.equal(r.status, 0, r.stderr);
      return JSON.parse(readFileSync(out, 'utf8'));
    },
    doc: (s) => JSON.parse(readFileSync(join(root, 'smpc-data', `${s}.json`), 'utf8')),
    snapshot: () => Object.fromEntries(readdirSync(join(root, 'smpc-data')).map((f) => [f.slice(0, -5), sha(readFileSync(join(root, 'smpc-data', f)))])),
    done: () => rmSync(root, { recursive: true, force: true }),
  };
}
const only = (requests, method) => requests.filter((r) => r.startsWith(method + ' ')).map((r) => r.split(' ')[1]);
const sameExcept = (before, after, changed) => {
  for (const [s, h] of Object.entries(before)) if (!changed.includes(s)) assert.equal(after[s], h, `${s} must be byte-identical`);
};

// ───────────────────────────── end to end ─────────────────────────────

test('EMA refuses everything (429): no label lost, the changed ones stay visible, few requests wasted, the gate fails', () => {
  const w = world();
  try {
    const before = w.snapshot();
    const { index, requests, out } = w.refresh({ HEAD: { '*': '429' }, GET: { '*': '429' } });
    const after = w.snapshot();

    assert.deepEqual(after, before, 'every stored extract is exactly as it was');
    assert.equal(index.count, N);
    for (let i = 1; i <= N; i++) assert.ok(index.drugs[slug(i)], `${slug(i)} still listed in the manifest`);

    // the changed labels were tried first — before any optional direct check
    assert.equal(requests[0], 'GET m0502', 'first request: a changed label, the one carried over from last week');
    const firstHead = requests.findIndex((r) => r.startsWith('HEAD '));
    for (const s of CHANGED) {
      const tries = requests.map((r, i) => (r === `GET ${s}` ? i : -1)).filter((i) => i >= 0);
      assert.ok(tries.length >= 6, `${s}: two rounds of three tries, got ${tries.length}`);
      assert.ok(firstHead < 0 || tries[tries.length - 1] < firstHead, `${s}: all tries before the first optional check`);
    }
    // …and they are named, not silently dropped
    for (const s of CHANGED) assert.ok((index.downloadFailed || []).includes(s) || index.uncheckedWhy?.[s]?.plan === 'feed', `${s} is recorded as not fetched`);

    // optional checks: suspended after 6 refusals in a row (23.11.2026: 47 were sent)
    assert.equal(only(requests, 'HEAD').length, 6);
    assert.match(out, /direct checks suspended for this run/);
    assert.equal(index.incomplete.codes.suspended, 5);
    assert.equal(index.incomplete.codes['429'], 6);
    assert.equal(index.unchecked.length, 11, '2 carried + 1 unlisted + 8 new sample');
    assert.deepEqual(index.uncheckedRepeat.sort(), CARRIED, 'unchecked two runs in a row is still reported');

    const drift = w.drift();
    assert.ok(drift.problems >= 1, 'an incomplete run turns the weekly job red');
    assert.ok(drift.incompleteProblem);
    assert.deepEqual(drift.behind.map((x) => x.slug).sort(), CHANGED, 'drift report names every label that is behind EMA');
    assert.ok(drift.behind.every((x) => /download failed|unchecked/.test(x.lastRun)));
  } finally { w.done(); }
});

test('EMA refuses only the optional checks: every changed label is fetched, the rest carries over and clears next run', () => {
  const w = world();
  try {
    const before = w.snapshot();
    const run1 = w.refresh({ HEAD: { '*': '429' }, GET: { '*': '200' }, retryAfter: 7 });
    const after = w.snapshot();

    // order of work: changed (carried one first) → missing → carried checks → unlisted → rotating sample
    assert.deepEqual(run1.requests.slice(0, 4), ['GET m0502', 'GET m0500', 'GET m0501', `GET ${NEW}`]);
    assert.deepEqual(only(run1.requests, 'HEAD'), ['m0900', 'm0901', UNLISTED, 'm0001', 'm0002', 'm0003']);
    assert.match(run1.out, /Retry-After 7 s\) — waiting [78] s \(refusal 1 of 6 in a row\)/, 'EMA\'s Retry-After is what the run waits');

    // the changed labels are current, with a valid source fingerprint
    const text = readFileSync(PDF_TEXT, 'utf8');
    for (const s of [...CHANGED, NEW]) {
      const d = w.doc(s);
      assert.equal(d.emaUpdated, UPDATED, `${s} carries EMA's new date`);
      assert.equal(d.sourceSha, sha(text), `${s}: fingerprint of the text it was parsed from`);
      assert.match(d.sections['4.1'].text, /Kymriah/);
    }
    sameExcept(before, after, CHANGED);
    assert.equal(Object.keys(after).length, N + 1);

    // what was not checked: recorded with reason and category, nothing changed at EMA is waiting
    const inc = run1.index.incomplete;
    assert.equal(inc.changed, 0, 'zero EMA-confirmed changes awaiting ingestion');
    assert.match(inc.reason, /blocking/);
    assert.deepEqual([inc.carry, inc.unlisted, inc.sample, inc.sampleSize], [2, 1, 8, 8]);
    assert.deepEqual(run1.index.uncheckedWhy.m0900, { code: '429', plan: 'carry' });
    assert.deepEqual(run1.index.uncheckedWhy.m0008, { code: 'suspended', plan: 'sample' });
    assert.equal(run1.index.headOffset, 8);
    const d1 = w.drift();
    assert.deepEqual(d1.behind, []);
    assert.ok(d1.problems >= 1 && d1.incompleteProblem, 'still red: the cross-check did not happen');

    // next run, EMA answers: the backlog is worked off, no new sample is piled on top
    const run2 = w.refresh({ HEAD: { '*': '200' }, GET: { '*': '200' } });
    assert.deepEqual(only(run2.requests, 'GET'), [], 'nothing changed at EMA since — nothing downloaded again');
    assert.deepEqual(only(run2.requests, 'HEAD'), ['m0001', 'm0002', 'm0003', 'm0004', 'm0005', 'm0006', 'm0007', 'm0008', 'm0900', 'm0901', UNLISTED]);
    assert.equal(run2.index.incomplete, undefined);
    assert.equal(run2.index.unchecked, undefined);
    assert.equal(run2.index.headOffset, 8, 'the rotation waited for the backlog');
    sameExcept(after, w.snapshot(), []);
    assert.equal(w.drift().problems, 0, 'complete run, corpus matches EMA: green');

    // the week after: the rotation resumes where it stopped
    const run3 = w.refresh({ HEAD: { '*': '200' }, GET: { '*': '200' } });
    assert.deepEqual(only(run3.requests, 'HEAD'), [UNLISTED, 'm0009', 'm0010', 'm0011', 'm0012', 'm0013', 'm0014', 'm0015', 'm0016', 'm0017', 'm0018']);
    assert.equal(run3.index.headOffset, 18);
  } finally { w.done(); }
});

test('a refusal that passes: the download is tried again, a refused check is retried at the end of the run', () => {
  const w = world({ unchecked: [] });
  try {
    const { index, requests, out } = w.refresh({ HEAD: { '*': '200', m0003: ['429', '200'] }, GET: { '*': '200', m0500: ['429', '200'], m0501: ['429', '503', '429', '200'] }, retryAfter: 3 });
    assert.equal(requests.filter((r) => r === 'GET m0500').length, 2, 'one refusal, one more try');
    assert.equal(requests.filter((r) => r === 'GET m0501').length, 4, 'three refusals: second round after the other changed labels');
    assert.ok(requests.lastIndexOf('GET m0501') > requests.indexOf('GET m0502'));
    assert.ok(requests.lastIndexOf('GET m0501') < requests.findIndex((r) => r.startsWith('HEAD ')), 'the second round still comes before the optional checks');
    for (const s of CHANGED) assert.equal(w.doc(s).emaUpdated, UPDATED);
    assert.deepEqual(index.failed, []);
    assert.equal(index.downloadFailed, undefined);
    assert.equal(requests.filter((r) => r === 'HEAD m0003').length, 2);
    assert.match(out, /retry: 1 of 1 recovered/);
    assert.equal(index.incomplete, undefined, 'everything was checked in the end');
    assert.equal(w.drift().problems, 0);
  } finally { w.done(); }
});

test('catch-up run (HEAD_SAMPLE=0): changed labels and backlog only, no new sample', () => {
  const w = world();
  try {
    const { index, requests } = w.refresh({ HEAD: { '*': '200' }, GET: { '*': '200' } }, { HEAD_SAMPLE: '0' });
    assert.deepEqual(requests, ['GET m0502', 'GET m0500', 'GET m0501', `GET ${NEW}`, 'HEAD m0900', 'HEAD m0901', `HEAD ${UNLISTED}`]);
    assert.equal(index.headOffset, 0, 'the rotation does not move');
    assert.equal(index.incomplete, undefined);
  } finally { w.done(); }
});
