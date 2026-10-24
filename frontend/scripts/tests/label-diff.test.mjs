// Tests for services/labelDiff.ts — the sentence-level EU-vs-US label comparison.
// Run: node --test --experimental-strip-types frontend/scripts/tests/ (npm test does).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffSections, splitUnits, tokens, similarity, isHeading } from '../../services/labelDiff.ts';

test('units: sentences per line, cross-reference markers stay with their claim, table blocks are one unit', () => {
  const us = '1 INDICATIONS AND USAGE X is indicated: Melanoma for the treatment of patients with metastatic melanoma. ( 1.1 ) for the adjuvant treatment of adults. ( 1.1 ) Lung Cancer in combination with chemotherapy. ( 1.2 )';
  const units = splitUnits(us).map((u) => u.text);
  assert.deepEqual(units, [
    'X is indicated: Melanoma for the treatment of patients with metastatic melanoma. ( 1.1 )',   // section title stripped
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
  assert.deepEqual(tokens('Drug is indicated for the treatment of Adults (see section 5.1) at 2,5 mg/kg ( 1.1 , 2.1 )'), ['drug', 'indicate', 'treat', 'adult', '2.5', 'mg', 'kg']);
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
  // Rephrased: filler words are not painted, differing numbers are.
  const c = 'Administer the recommended dosage of 400 mg by intravenous infusion over 30 minutes every 6 weeks until progression.';
  const d = diffSections(a, c);
  assert.equal(d.a[0].k, 'changed');
  assert.deepEqual(d.a[0].words.filter((w) => w.k === 'diff'), []);
  assert.deepEqual(d.a[0].words.filter((w) => w.k === 'num').map((w) => w.t), ['200', '3']);
  assert.deepEqual(d.b[0].words.filter((w) => w.k === 'num').map((w) => w.t), ['400', '6']);
  // "patients" / "undergone" are style; "adjuvant" vs "neoadjuvant", "not" are substance.
  const e = diffSections('X is indicated for the adjuvant treatment of adults with melanoma who have undergone resection.',
                         'X is indicated for the neoadjuvant treatment of adult patients with melanoma not amenable to resection.');
  assert.deepEqual(e.a[0].words.filter((w) => w.k === 'diff').map((w) => w.t), ['adjuvant']);
  assert.deepEqual(e.b[0].words.filter((w) => w.k === 'diff').map((w) => w.t), ['neoadjuvant', 'not']);
  // "adults" against silence is style; against a stated population it is substance.
  const f = diffSections('X is indicated for the treatment of adults with melanoma.', 'X is indicated for the treatment of patients with melanoma.');
  assert.deepEqual(f.a[0].words.filter((w) => w.k !== 'same'), []);
  const g = diffSections('X is indicated for the treatment of adults with melanoma.', 'X is indicated for the treatment of pediatric patients with melanoma.');
  assert.deepEqual(g.a[0].words.filter((w) => w.k === 'diff').map((w) => w.t), ['adults']);
  assert.deepEqual(g.b[0].words.filter((w) => w.k === 'diff').map((w) => w.t), ['pediatric']);
  // An inline cross-reference is never a differing number.
  const h = diffSections('X is indicated in adults (for selection criteria, see section 5.1).', 'X is indicated in adults.');
  assert.deepEqual(h.a[0].words.filter((w) => w.k === 'num'), []);
});

test('dialects fold: abbreviations, monotherapy / single agent, British spelling, adolescents / pediatric', () => {
  assert.deepEqual(tokens('as monotherapy for adolescents with NSCLC'), tokens('as a single agent for pediatric patients with non-small cell lung cancer'));
  assert.deepEqual(tokens('oesophageal carcinoma'), tokens('esophageal cancer'));
  const eu = 'KEYTRUDA as monotherapy is indicated for the adjuvant treatment of adults with non-small cell lung carcinoma who are at high risk of recurrence following complete resection and platinum-based chemotherapy (see section 5.1).';
  const us = 'as a single agent, for adjuvant treatment following resection and platinum-based chemotherapy for adult patients with Stage IB (T2a ≥4 cm), II, or IIIA NSCLC. ( 1.2 )';
  const d = diffSections(eu, us);
  assert.equal(d.a[0].k, 'changed', 'the same adjuvant NSCLC claim in both dialects pairs up');
  assert.equal(d.b[0].pair, 0);
});

test('headings are neither claims nor differences; a claim stated twice on one side is not unique', () => {
  assert.ok(isHeading('Melanoma'));
  assert.ok(isHeading('Head and neck squamous cell carcinoma (HNSCC)'));
  assert.ok(isHeading('▸ KEYTRUDA 25 mg/mL concentrate for solution for infusion'));
  assert.ok(isHeading('4 CONTRAINDICATIONS'));
  assert.ok(!isHeading('Hypersensitivity to the active substance.'));
  assert.ok(!isHeading('The recommended dose is 200 mg every 3 weeks.'));
  const claim = 'KEYTRUDA as monotherapy is indicated for the treatment of adults with advanced melanoma.';
  const d = diffSections(`Melanoma\n${claim}\n▸ KEYTRUDA 395 mg solution for injection\nMelanoma\n${claim}`, `1 INDICATIONS AND USAGE ${claim}`);
  assert.deepEqual(d.a.map((u) => u.k), ['heading', 'same', 'heading', 'heading', 'same']);
  assert.deepEqual(d.stats, { uniqueA: 0, uniqueB: 0, changed: 0, unitsA: 5, unitsB: 1 });
  assert.equal(d.b[0].text, claim, 'the US section title is stripped from the first sentence');
});

test('a number the other side states in the neighbouring sentence is not marked', () => {
  const eu = 'KEYTRUDA as monotherapy is indicated for the treatment of adults and adolescents aged 12 years and older with advanced melanoma.';
  const us = 'KEYTRUDA is indicated: Melanoma for the treatment of patients with unresectable or metastatic melanoma. ( 1.1 )\nfor the adjuvant treatment of adult and pediatric (12 years and older) patients with Stage III melanoma. ( 1.1 )';
  const d = diffSections(eu, us);
  assert.equal(d.a[0].k, 'changed');
  assert.deepEqual(d.a[0].words.filter((w) => w.k === 'num'), []);
});

test('empty or missing text is not compared', () => {
  assert.equal(diffSections('', 'x'), null);
  assert.equal(diffSections('Hypersensitivity.', '   '), null);
});
