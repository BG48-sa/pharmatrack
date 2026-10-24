// Tests for services/labelDiff.ts — the sentence-level EU-vs-US label comparison.
// Run: node --test --experimental-strip-types frontend/scripts/tests/ (npm test does).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffSections, splitUnits, tokens, similarity } from '../../services/labelDiff.ts';

test('units: sentences per line, cross-reference markers stay with their claim, table blocks are one unit', () => {
  const us = '1 INDICATIONS AND USAGE X is indicated: Melanoma for the treatment of patients with metastatic melanoma. ( 1.1 ) for the adjuvant treatment of adults. ( 1.1 ) Lung Cancer in combination with chemotherapy. ( 1.2 )';
  const units = splitUnits(us).map((u) => u.text);
  assert.deepEqual(units, [
    '1 INDICATIONS AND USAGE X is indicated: Melanoma for the treatment of patients with metastatic melanoma. ( 1.1 )',
    'for the adjuvant treatment of adults. ( 1.1 )',
    'Lung Cancer in combination with chemotherapy. ( 1.2 )',
  ]);
  const eu = 'Melanoma\n\nX is indicated for adults, e.g. with melanoma (see section 5.1). The dose is 2.5 mg.\nDose   Weight   Frequency\n200 mg   any      q3w\n400 mg   any      q6w';
  const u2 = splitUnits(eu);
  assert.deepEqual(u2.map((u) => u.text), [
    'Melanoma',
    'X is indicated for adults, e.g. with melanoma (see section 5.1).',
    'The dose is 2.5 mg.',
    'Dose   Weight   Frequency\n200 mg   any      q3w\n400 mg   any      q6w',
  ]);
  assert.equal(u2[3].table, true);
  assert.notEqual(u2[1].line, u2[2].line + 1, 'two sentences of one line share the line index');
});

test('tokens: lower-case, no stop words, cross references removed, decimals kept', () => {
  assert.deepEqual(tokens('Drug is indicated for the treatment of Adults (see section 5.1) at 2,5 mg/kg ( 1.1 )'), ['drug', 'indicated', 'treatment', 'adults', '2.5', 'mg', 'kg']);
  assert.equal(similarity(tokens('dose weight frequency'), tokens('dose weight frequency')), 1);
  assert.equal(similarity(['x'], []), 0);
});

test('a claim on one side only is unique; a matching claim with another number is changed with the number marked', () => {
  const eu = 'KEYTRUDA as monotherapy is indicated for the treatment of adults and adolescents aged 12 years and older with advanced melanoma.\nHypersensitivity to the active substance or to any of the excipients.';
  const us = 'KEYTRUDA as monotherapy is indicated for the treatment of adults and adolescents aged 18 years and older with advanced melanoma.\nNone.';
  const d = diffSections(eu, us);
  assert.ok(d);
  assert.equal(d.a[0].k, 'changed');
  assert.deepEqual(d.a[0].words.filter((w) => w.k !== 'same').map((w) => [w.t, w.k]), [['12', 'num']]);
  assert.deepEqual(d.b[0].words.filter((w) => w.k !== 'same').map((w) => [w.t, w.k]), [['18', 'num']]);
  assert.equal(d.a[1].k, 'unique');
  assert.equal(d.b[1].k, 'unique');
  assert.deepEqual(d.stats, { uniqueA: 1, uniqueB: 1, changed: 1, unitsA: 2, unitsB: 2 });
});

test('identical sentences are same; rephrased sentences are not word-marked, only numbers', () => {
  const a = 'The recommended dose is 200 mg every 3 weeks administered as an intravenous infusion over 30 minutes.';
  const b = 'The recommended dose is 200 mg every 3 weeks administered as an intravenous infusion over 30 minutes.';
  assert.equal(diffSections(a, b).a[0].k, 'same');
  // Loosely matched (overlap between 0.55 and 0.75): differing words are not painted, a differing number is.
  const c = 'Administer the recommended dosage of 400 mg by intravenous infusion over 30 minutes every 6 weeks until progression.';
  const d = diffSections(a, c);
  assert.equal(d.a[0].k, 'changed');
  assert.ok(d.a[0].sim < 0.75 && d.a[0].sim >= 0.55, `sim ${d.a[0].sim}`);
  assert.deepEqual(d.a[0].words.filter((w) => w.k === 'diff'), []);
  assert.deepEqual(d.a[0].words.filter((w) => w.k === 'num').map((w) => w.t), ['200', '3']);
  assert.deepEqual(d.b[0].words.filter((w) => w.k === 'num').map((w) => w.t), ['400', '6']);
});

test('empty or missing text is not compared', () => {
  assert.equal(diffSections('', 'x'), null);
  assert.equal(diffSections('Hypersensitivity.', '   '), null);
});
