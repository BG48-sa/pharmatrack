// Golden tests for scripts/smpc/extract-all.mjs — parseSections(): an EMA
// product-information text dump (pdftotext) → the stored SmPC sections.
//
// fixtures/smpc/<slug>.txt are REAL EMA dumps, shortened (every heading kept, 4.1
// and 4.3 whole, other bodies cut to their first lines, Annex II kept so the cut
// is tested). <slug>.expected.json is the parser's output at the time the fixture
// was reviewed by hand; the explicit assertions below are the clinically important
// facts that must survive any parser change. If a deliberate parser change moves
// the golden output, re-check these facts and regenerate the .expected.json file.
// Run: node --test --experimental-strip-types frontend/scripts/tests/ (npm test does).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSections } from '../../scripts/smpc/extract-all.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (slug) => readFileSync(join(here, 'fixtures', 'smpc', `${slug}.txt`), 'utf8');
const expected = (slug) => JSON.parse(readFileSync(join(here, 'fixtures', 'smpc', `${slug}.expected.json`), 'utf8'));
const SECTIONS = ['4.1', '4.2', '4.3', '4.4', '4.8', '5.1', '5.2'];
const count = (hay, needle) => hay.split(needle).length - 1;

for (const slug of ['keytruda', 'kymriah', 'lumykras', 'casgevy', 'dupixent']) {
  test(`${slug}: same source text → same sections (golden)`, () => {
    const s = parseSections(fixture(slug));
    assert.deepEqual(Object.keys(s), SECTIONS);
    for (const k of SECTIONS) assert.ok(!s[k].missing, `${k} must be found`);
    assert.deepEqual(s, expected(slug));
  });
  test(`${slug}: Annex II / package leaflet never leak in, page numbers are gone`, () => {
    const s = parseSections(fixture(slug));
    for (const k of SECTIONS) {
      assert.ok(!/ANNEX II|PACKAGE LEAFLET|MANUFACTURER|CONDITIONS OR RESTRICTIONS/.test(s[k].text), `${k} leaks Annex II text`);
      assert.ok(!/^\s*\d+\/\d+\s*$/m.test(s[k].text), `${k} keeps a "12/59" page number`);
    }
    assert.ok(/Hypersensitivity to the active substance/.test(s['4.3'].text), '4.3 starts with the hypersensitivity sentence');
  });
}

test('Keytruda: both presentations of 4.1 are merged with ▸ markers; age limit and PD-L1 threshold wording survive', () => {
  const s = parseSections(fixture('keytruda'));
  assert.equal(s['4.1'].presentations, 2);
  assert.equal(s['4.2'].presentations, 2);
  assert.ok(s['4.1'].text.startsWith('▸ KEYTRUDA 25 mg/mL concentrate for solution for infusion'), s['4.1'].text.slice(0, 80));
  assert.ok(/▸ KEYTRUDA 100 mg\/mL/.test(s['4.1'].text) || count(s['4.1'].text, '▸ ') === 2, 'second presentation marker');
  assert.ok(s['4.1'].text.includes('adults and adolescents aged 12 years and older'));
  assert.ok(/PD-L1 with a ≥ ?1% TPS|TPS\) ≥ ?50%|≥ ?50% TPS/.test(s['4.1'].text), 'PD-L1 thresholds kept as written');
  assert.ok(s['4.1'].text.includes('no EGFR or ALK positive tumour mutations'), 'negated biomarker wording kept');
  assert.equal(s['4.1'].presentations, 2);
});

test('Kymriah: the 25-year age ceiling and the relapse wording are kept', () => {
  const t = parseSections(fixture('kymriah'))['4.1'].text;
  assert.ok(t.includes('up to and including 25 years of age'), t);
  assert.ok(t.includes('after two or more lines of systemic therapy'), t);
  assert.equal(count(t, '•'), 3, 'three bullet indications');
});

test('Lumykras: a single-presentation label has no ▸ marker and keeps the prior-line requirement', () => {
  const s = parseSections(fixture('lumykras'));
  assert.equal(s['4.1'].presentations, undefined);
  assert.ok(!s['4.1'].text.includes('▸'));
  assert.ok(s['4.1'].text.includes('who have progressed after at least one prior line of systemic therapy'), s['4.1'].text);
  assert.ok(s['4.1'].text.includes('KRAS G12C'));
});

test('Casgevy: both diseases keep "12 years of age and older" and the donor condition', () => {
  const t = parseSections(fixture('casgevy'))['4.1'].text;
  assert.equal(count(t, '12 years of age and older'), 2, t);
  assert.equal(count(t, 'HLA)-matched related HSC donor is not available'), 2, t);
  assert.ok(t.startsWith('β-thalassemia'), 'the disease heading opens the section');
});

test('Dupixent: presentations merged; the paediatric age bands survive verbatim', () => {
  const s = parseSections(fixture('dupixent'));
  assert.ok((s['4.1'].presentations || 1) >= 2, 'several presentations');
  for (const phrase of ['adults and adolescents 12 years and older', 'children 6 months to 11 years old', 'Children 6 to 11 years'])
    assert.ok(s['4.1'].text.includes(phrase), `missing: ${phrase}`);
});

test('synthetic: a missing section is flagged, a cross-reference is not a heading, Annex II is cut', () => {
  const txt = [
    '1.     NAME OF THE MEDICINAL PRODUCT', 'Testex 10 mg tablets', '',
    '4.1    Therapeutic indications', 'Testex is indicated for adults (see section 4.4 Special warnings).', '12/59', '',
    '4.2    Posology and method of administration', 'One tablet daily.', '',
    '4.4    Special warnings and precautions for use', 'Monitor liver function.', '',
    '4.8    Undesirable effects', 'Headache.', '5.1    Pharmacodynamic properties', 'ATC code: X.', '5.2    Pharmacokinetic properties', 'Absorbed.', '',
    'ANNEX II', '4.3    Contraindications', 'This line must never be read.',
  ].join('\n');
  const s = parseSections(txt);
  assert.equal(s['4.1'].text, 'Testex is indicated for adults (see section 4.4 Special warnings).');
  assert.deepEqual(s['4.3'], { title: 'Contraindications', text: '', missing: true });
  assert.equal(s['4.4'].text, 'Monitor liver function.');
  assert.equal(s['4.2'].text, 'One tablet daily.');
});
