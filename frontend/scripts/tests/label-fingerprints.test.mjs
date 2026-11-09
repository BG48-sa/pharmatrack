// Tests for scripts/label-fingerprints.mjs (the verified source-fingerprint ledger)
// and labelSha() of scripts/uspi/extract-all.mjs. Pure helpers only — no network,
// no corpus. Run: node --test --experimental-strip-types frontend/scripts/tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { labelSha } from '../../scripts/uspi/extract-all.mjs';
import { ledgerSha, fingerprintOf, needsEntry, deadEntries, coverage, ledgerText } from '../../scripts/label-fingerprints.mjs';

const RECORD = {
  set_id: 'set-1', id: 'spl-1', effective_time: '20260501', version: '7',
  indications_and_usage: ['1 INDICATIONS AND USAGE  EXAMPLO is indicated for adults with X.'],
  openfda: { brand_name: ['EXAMPLO'], application_number: ['NDA999999'], rxcui: ['1'] },
};

test('labelSha: openFDA re-harmonising a record does not move the fingerprint, a label change does', () => {
  const reharmonised = { ...RECORD, openfda: { ...RECORD.openfda, rxcui: ['1', '2'], pharm_class_epc: ['Kinase Inhibitor [EPC]'] } };
  assert.equal(labelSha(reharmonised), labelSha(RECORD));
  assert.equal(labelSha({ ...RECORD, openfda: undefined }), labelSha(RECORD));
  assert.notEqual(labelSha({ ...RECORD, indications_and_usage: ['1 INDICATIONS AND USAGE  EXAMPLO is indicated for adults and children with X.'] }), labelSha(RECORD));
  assert.notEqual(labelSha({ ...RECORD, effective_time: '20261030' }), labelSha(RECORD));
  assert.match(labelSha(RECORD), /^[0-9a-f]{64}$/);
});

const EU = { retrieved: '2026-07-03', sections: {} };
const US = { splSetId: 'set-1', effective: '2026-05-01', sections: {} };
const E_EU = { sha: 'e'.repeat(64), retrieved: '2026-07-03', v: '2026-11-09' };
const E_US = { sha: 'u'.repeat(64), setId: 'set-1', effective: '2026-05-01', v: '2026-11-09' };

test('a ledger entry applies only to the extract that was verified', () => {
  assert.equal(ledgerSha('smpc', EU, E_EU), E_EU.sha);
  assert.equal(ledgerSha('smpc', { ...EU, retrieved: '2026-11-09' }, E_EU), null);        // re-downloaded since
  assert.equal(ledgerSha('uspi', US, E_US), E_US.sha);
  assert.equal(ledgerSha('uspi', { ...US, effective: '2026-10-30' }, E_US), null);        // newer label version
  assert.equal(ledgerSha('uspi', { ...US, splSetId: 'set-2' }, E_US), null);              // another label (re-selected)
  assert.equal(ledgerSha('smpc', EU, undefined), null);
});

test('fingerprintOf: own fingerprint first; an old whole-record US fingerprint yields to the ledger', () => {
  assert.equal(fingerprintOf('smpc', { ...EU, sourceSha: 'a'.repeat(64) }, E_EU), 'a'.repeat(64));
  assert.equal(fingerprintOf('smpc', EU, E_EU), E_EU.sha);
  assert.equal(fingerprintOf('smpc', EU, undefined), null);
  assert.equal(fingerprintOf('uspi', { ...US, sourceSha: 'b'.repeat(64), shaScope: 'label' }, E_US), 'b'.repeat(64));
  assert.equal(fingerprintOf('uspi', { ...US, sourceSha: 'f'.repeat(64) }, E_US), E_US.sha);
  assert.equal(fingerprintOf('uspi', US, undefined), null);
});

test('coverage and pruning', () => {
  const docs = new Map([
    ['own', { ...EU, sourceSha: 'a'.repeat(64) }],
    ['ledgered', EU],
    ['bare', { ...EU, retrieved: '2026-09-06' }],
  ]);
  const entries = { ledgered: E_EU, bare: E_EU, own: E_EU, gone: E_EU };
  const c = coverage('smpc', docs, entries);
  assert.deepEqual({ total: c.total, own: c.own, ledger: c.ledger, none: c.none }, { total: 3, own: 1, ledger: 1, none: ['bare'] });
  // dead: the extract has its own fingerprint now, was re-downloaded, or no longer exists
  assert.deepEqual(deadEntries('smpc', docs, entries).sort(), ['bare', 'gone', 'own']);
  assert.equal(needsEntry('uspi', { sourceSha: 'f'.repeat(64) }), true);                  // old whole-record fingerprint
  assert.equal(needsEntry('uspi', { sourceSha: 'b'.repeat(64), shaScope: 'label' }), false);
});

test('ledgerText: sorted, one entry per line, valid JSON', () => {
  const text = ledgerText({ smpc: { zeta: E_EU, alpha: E_EU }, uspi: { examplo: E_US } });
  const j = JSON.parse(text);
  assert.deepEqual(Object.keys(j.smpc), ['alpha', 'zeta']);
  assert.deepEqual(j.uspi.examplo, E_US);
  assert.equal(text.split('\n').filter((l) => l.includes('"sha"')).length, 3);
  assert.equal(ledgerText({ smpc: { alpha: E_EU, zeta: E_EU }, uspi: { examplo: E_US } }), text);   // order of insertion does not matter
});
