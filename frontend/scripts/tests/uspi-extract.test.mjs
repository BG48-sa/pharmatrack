// Golden tests for scripts/uspi/extract-all.mjs — parse(): an openFDA drug-label
// record → the stored US label sections. The records below follow openFDA's shape
// (every field an array of strings; tables as SPL HTML) with shortened text.
// Run: node --test --experimental-strip-types frontend/scripts/tests/ (npm test does).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, cleanText, sanitizeTable } from '../../scripts/uspi/extract-all.mjs';

const FULL = {
  indications_and_usage: ['1 INDICATIONS AND USAGE  EXAMPLO is a kinase inhibitor indicated for the treatment of adult patients with locally advanced or metastatic non-small cell lung cancer (NSCLC) whose tumors have EGFR exon 19 deletions, as detected by an FDA-approved test. ( 1.1 , 2.1 )'],
  indications_and_usage_table: ['<table width="100%"><tbody><tr><td colspan="2" align="left"><span class="Bold">Limitations of Use</span></td></tr><tr><td>Not recommended</td><td>in patients &lt;18 years (&#x2265;12 years studied)</td></tr></tbody></table>'],
  dosage_and_administration: ['2 DOSAGE AND ADMINISTRATION  Recommended dosage: 80 mg orally once daily, with or without food. ( 2.2 )'],
  contraindications: ['4 CONTRAINDICATIONS  None. ( 4 )'],
  boxed_warning: ['WARNING: HEPATOTOXICITY  Fatal hepatotoxicity occurred. Monitor liver function tests. ( 5.1 )'],
  warnings_and_cautions: ['5 WARNINGS AND PRECAUTIONS  Hepatotoxicity: withhold for Grade 3 transaminase elevation. ( 5.1 )'],
  adverse_reactions: ['6 ADVERSE REACTIONS  Most common adverse reactions (≥20%) were diarrhea, rash and nausea. ( 6.1 )'],
  use_in_specific_populations: ['8 USE IN SPECIFIC POPULATIONS  Lactation: advise not to breastfeed. ( 8.2 )'],
  mechanism_of_action: ['12.1 Mechanism of Action  Examplo is an inhibitor of EGFR.'],
  pharmacokinetics: ['12.3 Pharmacokinetics  Median time to peak concentration is 6 hours.'],
  openfda: { brand_name: ['EXAMPLO'], application_number: ['NDA999999'] },
};

test('a full record yields every section; headings are stripped, cross-reference markers and text kept verbatim', () => {
  const s = parse(FULL);
  assert.ok(s);
  assert.deepEqual(Object.keys(s), ['indications', 'dosage', 'contraindications', 'boxed_warning', 'warnings', 'adverse_reactions', 'specific_populations', 'mechanism', 'pharmacokinetics']);
  assert.ok(s.indications.text.startsWith('EXAMPLO is a kinase inhibitor indicated'), s.indications.text.slice(0, 60));
  assert.ok(s.indications.text.includes('EGFR exon 19 deletions, as detected by an FDA-approved test. ( 1.1 , 2.1 )'));
  assert.ok(s.dosage.text.startsWith('Recommended dosage: 80 mg orally once daily'), s.dosage.text);
  assert.equal(s.contraindications.text, 'None. ( 4 )');
  assert.ok(s.boxed_warning.text.startsWith('WARNING: HEPATOTOXICITY'), 'a boxed warning keeps its WARNING title');
  assert.ok(s.warnings.text.includes('Grade 3 transaminase elevation'));
  assert.ok(s.adverse_reactions.text.includes('(≥20%)'), 'plain text is kept verbatim: ' + s.adverse_reactions.text);
  for (const k of Object.keys(s)) assert.ok(!s[k].missing, `${k} must not be missing`);
});

test('tables keep only structural tags and numeric spans; entities decode; attributes go', () => {
  const s = parse(FULL);
  assert.equal(s.indications.tables.length, 1);
  const t = s.indications.tables[0];
  assert.ok(t.startsWith('<table>'), t.slice(0, 20));
  assert.match(t, /<td colspan="2">\s*Limitations of Use\s*<\/td>/, t);
  assert.ok(t.includes('<18 years (≥12 years studied)'), t);
  assert.ok(!/class=|width=|<span/.test(t), 'no attributes or inline tags survive: ' + t);
  assert.deepEqual(s.contraindications.tables, []);
});

test('an old-format label (warnings instead of warnings_and_cautions) and absent sections', () => {
  const s = parse({
    indications_and_usage: ['INDICATIONS AND USAGE Oldex tablets are indicated for the relief of mild pain.'],
    warnings: ['WARNINGS Do not exceed the recommended dose.'],
    contraindications: ['CONTRAINDICATIONS Hypersensitivity to oldex.'],
  });
  assert.ok(s);
  assert.equal(s.warnings.text, 'WARNINGS Do not exceed the recommended dose.');
  assert.equal(s.contraindications.text, 'CONTRAINDICATIONS Hypersensitivity to oldex.');
  assert.deepEqual(s.boxed_warning, { text: '', missing: true });
  assert.deepEqual(s.dosage, { text: '', missing: true });
});

test('a record without any label section parses to null (nothing stored, previous extract kept)', () => {
  assert.equal(parse({ openfda: { brand_name: ['NOTHING'] } }), null);
  assert.equal(parse({ indications_and_usage: [] }), null);
});

test('cleanText: numbered ALL-CAPS heading removed, long text truncated with a visible marker', () => {
  assert.equal(cleanText(['6 ADVERSE REACTIONS  The most common reactions.']), 'The most common reactions.');
  assert.equal(cleanText(['6.1 Clinical Trials Experience  Because clinical trials vary.']), '6.1 Clinical Trials Experience Because clinical trials vary.');
  const long = cleanText(['1 INDICATIONS AND USAGE  ' + 'word '.repeat(12000)]);
  assert.ok(long.length <= 40200 && long.endsWith('[…section truncated — open the full label via the source link above.]'), long.slice(-80));
});

test('sanitizeTable: rowspan/colspan of 1 dropped, >1 kept; scripts and links removed', () => {
  const t = sanitizeTable('<table border="1"><tr><th rowspan="1" colspan="3">Body System</th></tr><tr><td rowspan="2"><a href="#x">Blood</a><script>x()</script></td><td>5&#37;</td></tr></table>');
  assert.equal(t, '<table><tr><th colspan="3">Body System</th></tr><tr><td rowspan="2"> Blood x() </td><td>5%</td></tr></table>');
});
