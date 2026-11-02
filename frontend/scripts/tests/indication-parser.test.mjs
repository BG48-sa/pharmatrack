// Golden tests for services/indicationParser.ts — the "At a glance" badges.
//
// Every passage below is real approved wording (EMA SmPC section 4.1 or the US
// Indications and Usage section, as extracted into smpc-data / uspi-data) and the
// expected badges were written down by hand from the clinical meaning of the text,
// not copied from the parser's output. `has` lists badges that must be shown,
// `not` lists badges that would MISREPRESENT the indication if they appeared
// (a lost negation, a dropped age limit, the wrong HER2 polarity …).
//
// Run: node --test --experimental-strip-types frontend/scripts/tests/ (npm test does).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIndicationGroups, parseIndication } from '../../services/indicationParser.ts';

const labels = (text) => {
  const groups = parseIndicationGroups(text);
  return { groups, all: new Set(groups.flatMap((g) => g.facets.map((f) => f.label))) };
};

const CASES = [
  {
    name: 'Tagrisso (EU) — adjuvant after resection: EGFR alterations named, no metastatic setting',
    text: 'the adjuvant treatment after complete tumour resection in adult patients with stage IB-IIIA non- small cell lung cancer (NSCLC) whose tumours have epidermal growth factor receptor (EGFR) exon 19 deletions or exon 21 (L858R) substitution mutations (see section 5.1).',
    has: ['Adjuvant', 'EGFR exon 19 del', 'EGFR L858R', 'Adults'],
    not: ['Metastatic', 'First-line / untreated', 'Previously treated'],
  },
  {
    name: 'Tagrisso (EU) — T790M-positive advanced disease',
    text: 'the treatment of adult patients with locally advanced or metastatic EGFR T790M mutation- positive NSCLC.',
    has: ['Locally advanced', 'Metastatic', 'EGFR T790M', 'Adults'],
    not: ['Adjuvant', 'Resectable'],
  },
  {
    name: 'Keytruda (US) — first-line NSCLC "with no EGFR or ALK aberrations": the negated genes are not badges',
    text: 'in combination with pemetrexed and platinum chemotherapy, as first-line treatment of patients with metastatic nonsquamous NSCLC, with no EGFR or ALK genomic tumor aberrations.',
    has: ['Metastatic', 'First-line / untreated', 'Combination'],
    not: ['EGFR', 'ALK', 'Previously treated', 'Monotherapy'],
  },
  {
    name: 'Keytruda (US) — adjuvant melanoma, adults and children from 12, resected (not metastatic)',
    text: 'for the adjuvant treatment of adult and pediatric (12 years and older) patients with Stage IIB, IIC, or III melanoma following complete resection.',
    has: ['Adjuvant', 'Adults', 'Paediatric / age-limited'],
    not: ['Metastatic', 'Unresectable'],
  },
  {
    name: 'Lumykras (EU) — KRAS G12C after at least one prior line',
    text: 'LUMYKRAS as monotherapy is indicated for the treatment of adults with advanced non-small cell lung cancer (NSCLC) with KRAS G12C-mutation and who have progressed after at least one prior line of systemic therapy.',
    has: ['Advanced', 'KRAS G12C', 'Previously treated', 'Monotherapy', 'Adults'],
    not: ['First-line / untreated', 'Combination', 'KRAS'],
  },
  {
    name: 'Abecma (EU) — relapsed and refractory myeloma after two or more prior therapies',
    text: 'Abecma is indicated for the treatment of adult patients with relapsed and refractory multiple myeloma who have received at least two prior therapies, including an immunomodulatory agent, a proteasome inhibitor and an anti-CD38 antibody and have demonstrated disease progression on the last therapy.',
    has: ['Relapsed/refractory', 'Previously treated', 'Adults'],
    not: ['First-line / untreated', 'Maintenance'],
  },
  {
    name: 'Kymriah (EU) — paediatric and young adult ALL up to 25 years, relapsed/refractory',
    text: 'Paediatric and young adult patients up to and including 25 years of age with B-cell acute lymphoblastic leukaemia (ALL) that is refractory, in relapse post-transplant or in second or later relapse.',
    has: ['Paediatric / age-limited', 'Relapsed/refractory'],
    not: ['First-line / untreated', 'Maintenance'],
  },
  {
    name: 'Casgevy (EU) — from 12 years; "HLA-matched donor not available" is no HLA biomarker; no "Adults"',
    text: 'Casgevy is indicated for the treatment of transfusion-dependent β-thalassemia (TDT) in patients 12 years of age and older for whom haematopoietic stem cell (HSC) transplantation is appropriate and a human leukocyte antigen (HLA)-matched related HSC donor is not available.',
    has: ['Paediatric / age-limited'],
    not: ['Adults'],
    noGroup: 'Biomarker',
  },
  {
    name: 'Casgevy (US) — from 2 years',
    text: 'CASGEVY is indicated for the treatment of patients aged 2 years and older with: sickle cell disease (SCD) with recurrent vaso-occlusive crises transfusion-dependent β - thalassemia (TDT)',
    has: ['Paediatric / age-limited'],
    not: ['Adults'],
  },
  {
    name: 'Trodelvy (EU) — first-line metastatic TNBC with PD-L1 CPS ≥ 10: "have not received prior systemic therapy" is untreated, not previously treated',
    text: 'in combination with pembrolizumab, for the treatment of adult patients with unresectable locally advanced or metastatic triple-negative breast cancer (TNBC) who have not received prior systemic therapy for metastatic disease and whose tumours express PD-L1 with a combined positive score (CPS) ≥ 10 (see sections 4.2 and 5.1).',
    has: ['Combination', 'Unresectable', 'Locally advanced', 'Metastatic', 'Triple-negative', 'PD-L1 CPS ≥10', 'First-line / untreated', 'Adults'],
    not: ['Previously treated', 'Monotherapy'],
  },
  {
    name: 'Trodelvy (EU) — third-line TNBC after two or more prior therapies',
    text: 'as monotherapy for the treatment of adult patients with unresectable or metastatic TNBC who have received two or more prior systemic therapies, including at least one of them for advanced disease (see section 5.1).',
    has: ['Monotherapy', 'Previously treated', 'Unresectable', 'Metastatic', 'Triple-negative', 'Adults'],
    not: ['First-line / untreated', 'Combination', 'PD-L1'],
  },
  {
    name: 'Enhertu (EU) — HER2-low, HR-positive after endocrine therapy: polarity is "low", never "positive"',
    text: 'hormone receptor (HR)-positive, HER2-low or HER2-ultralow breast cancer who have received at least one endocrine therapy in the metastatic setting and who are not considered suitable for endocrine therapy as the next line of treatment (see sections 4.2 and 5.1).',
    has: ['HER2-low', 'HR-positive', 'Previously treated', 'Metastatic'],
    not: ['HER2-positive', 'HER2-negative', 'HR-negative', 'First-line / untreated'],
  },
  {
    name: 'Enhertu (EU) — first-line HER2-positive with pertuzumab',
    text: 'HER2-positive breast cancer Enhertu in combination with pertuzumab is indicated for the first-line treatment of adult patients with unresectable or metastatic HER2-positive breast cancer (for biomarker-based patient selection, see section 4.2).',
    has: ['HER2-positive', 'First-line / untreated', 'Combination', 'Unresectable', 'Metastatic', 'Adults'],
    not: ['HER2-low', 'HER2-negative', 'Previously treated', 'Monotherapy'],
  },
  {
    name: 'Verzenios (EU) — adjuvant HR-positive, HER2-negative early breast cancer',
    text: 'Verzenios in combination with endocrine therapy is indicated for the adjuvant treatment of adult patients with hormone receptor (HR)-positive, human epidermal growth factor receptor 2 (HER2)-negative, node-positive early breast cancer at high risk of recurrence (see section 5.1).',
    has: ['Adjuvant', 'HR-positive', 'HER2-negative', 'Combination', 'Adults'],
    not: ['HER2-positive', 'Metastatic', 'Recurrent', 'Monotherapy'],
  },
  {
    name: 'Imfinzi (EU) — perioperative resectable NSCLC "with no EGFR mutations or ALK rearrangements": both genes negated',
    text: 'IMFINZI in combination with platinum-based chemotherapy as neoadjuvant treatment, followed by IMFINZI as monotherapy as adjuvant treatment, is indicated for the treatment of adults with resectable NSCLC at high risk of recurrence and no EGFR mutations or ALK rearrangements (for selection criteria, see section 5.1).',
    has: ['Neoadjuvant', 'Adjuvant', 'Resectable', 'Combination', 'Monotherapy', 'Adults'],
    not: ['EGFR', 'ALK', 'Metastatic', 'Unresectable'],
  },
  {
    name: 'Imfinzi (EU) — stage III after chemoradiation: PD-L1 without a TPS/CPS threshold word, not "previously treated"',
    text: 'IMFINZI as monotherapy is indicated for the treatment of locally advanced, unresectable non-small cell lung cancer (NSCLC) in adults whose tumours express PD-L1 on ≥ 1% of tumour cells and whose disease has not progressed following platinum-based chemoradiation therapy (see section 5.1).',
    has: ['Locally advanced', 'Unresectable', 'PD-L1', 'Monotherapy', 'Adults'],
    not: ['Previously treated', 'First-line / untreated', 'Metastatic'],
  },
  {
    name: 'Libtayo (EU) — first-line NSCLC "with no EGFR, ALK or ROS1 aberrations": a comma-separated negated list',
    text: 'LIBTAYO as monotherapy is indicated for the first-line treatment of adult patients with non-small cell lung cancer (NSCLC) expressing PD-L1 (in ≥ 50% tumour cells), with no EGFR, ALK or ROS1 aberrations, who have locally advanced NSCLC who are not candidates for definitive chemoradiation, or metastatic NSCLC.',
    has: ['First-line / untreated', 'PD-L1', 'Monotherapy', 'Locally advanced', 'Metastatic', 'Adults'],
    not: ['EGFR', 'ALK', 'ROS1', 'Previously treated'],
  },
  {
    name: 'Talzenna (EU) — mCRPC with enzalutamide; "chemotherapy is not clinically indicated" is a condition, not a second indication',
    text: 'Talzenna is indicated in combination with enzalutamide for the treatment of adult patients with metastatic castration-resistant prostate cancer (mCRPC) in whom chemotherapy is not clinically indicated.',
    has: ['Combination', 'Metastatic', 'Adults'],
    not: ['BRCA', 'Monotherapy'],
    certain: true,
  },
  {
    name: 'Xalkori (EU) — paediatric ALK-positive ALCL, 1 to <18 years, relapsed/refractory, not adults',
    text: 'The treatment of paediatric patients (age ≥1 to <18 years) with relapsed or refractory systemic anaplastic lymphoma kinase (ALK)-positive anaplastic large cell lymphoma (ALCL)',
    has: ['Paediatric / age-limited', 'ALK', 'Relapsed/refractory'],
    not: ['Adults', 'First-line / untreated'],
  },
  {
    name: 'Tabrecta (EU) — METex14 skipping, after immunotherapy and/or platinum chemotherapy',
    text: 'Tabrecta as monotherapy is indicated for the treatment of adult patients with advanced non-small cell lung cancer (NSCLC) harbouring alterations leading to mesenchymal-epithelial transition factor gene exon 14 (METex14) skipping, who require systemic therapy following prior treatment with immunotherapy and/or platinum-based chemotherapy.',
    has: ['MET exon 14 skipping', 'Previously treated', 'Advanced', 'Monotherapy', 'Adults'],
    not: ['First-line / untreated', 'Combination'],
  },
  {
    name: 'Dupixent (EU) — severe atopic dermatitis in children 6 months to 11 years: no "Adults"',
    text: 'Children 6 months to 11 years of age Dupixent is indicated for the treatment of severe atopic dermatitis in children 6 months to 11 years old who are candidates for systemic therapy.',
    has: ['Paediatric / age-limited'],
    not: ['Adults'],
  },
  {
    name: 'Opdivo (EU) — adjuvant melanoma after complete resection: "metastatic disease who have undergone complete resection" is resected, not metastatic',
    text: 'OPDIVO as monotherapy is indicated for the adjuvant treatment of adults and adolescents 12 years of age and older with Stage IIB or IIC melanoma, or melanoma with involvement of lymph nodes or metastatic disease who have undergone complete resection (see section 5.1).',
    has: ['Adjuvant', 'Adults', 'Paediatric / age-limited', 'Monotherapy'],
    not: ['Metastatic'],
    certain: true,
  },
  {
    name: 'Vitrakvi (EU) — NTRK fusion, adults and children, bullet continuation lines belong to one indication',
    text: 'VITRAKVI as monotherapy is indicated for the treatment of adult and paediatric patients with solid tumours that display a Neurotrophic Tyrosine Receptor Kinase (NTRK) gene fusion,\n-    who have a disease that is locally advanced, metastatic or where surgical resection is likely to result in severe morbidity, and\n-    who have no satisfactory treatment options (see sections 4.4 and 5.1).',
    has: ['NTRK fusion', 'Monotherapy', 'Adults', 'Paediatric / age-limited'],
    not: ['Combination', 'Previously treated'],
  },
];

for (const c of CASES) {
  test(c.name, () => {
    const { groups, all } = labels(c.text);
    for (const l of c.has) assert.ok(all.has(l), `missing badge "${l}" — got ${[...all].join(', ') || '(none)'}`);
    for (const l of c.not) assert.ok(!all.has(l), `badge "${l}" must not appear — got ${[...all].join(', ')}`);
    if (c.noGroup) assert.ok(!groups.some((g) => g.facets.some((f) => f.group === c.noGroup)), `no ${c.noGroup} badge expected — got ${[...all].join(', ')}`);
    if (c.certain) {
      assert.equal(groups.length, 1, `expected one certain passage, got ${groups.length}`);
      assert.equal(groups[0].uncertain, undefined, `passage flagged uncertain: ${groups[0].uncertain}`);
    }
  });
}

test('Zolgensma (EU) — no eligibility keyword in the text: no badges at all rather than invented ones', () => {
  const t = 'Zolgensma is indicated for the treatment of:\n-    patients with 5q spinal muscular atrophy (SMA) with a bi-allelic mutation in the SMN1 gene and a clinical diagnosis of SMA Type 1, or\n-    patients with 5q SMA with a bi-allelic mutation in the SMN1 gene and up to 3 copies of the SMN2 gene.';
  assert.deepEqual(parseIndicationGroups(t), []);
  assert.deepEqual(parseIndication(t), []);
});

test('Alecensa (EU) — two "indicated" sentences become two passages: first-line and previously treated never share one badge set', () => {
  const t = 'Alecensa as monotherapy is indicated for the first-line treatment of adult patients with ALK-positive advanced NSCLC. Alecensa as monotherapy is indicated for the treatment of adult patients with ALK-positive advanced NSCLC previously treated with crizotinib.';
  const groups = parseIndicationGroups(t);
  assert.equal(groups.length, 2, groups.map((g) => g.clause).join(' || '));
  const l = groups.map((g) => g.facets.map((f) => f.label));
  assert.ok(l[0].includes('First-line / untreated') && !l[0].includes('Previously treated'), l[0].join(', '));
  assert.ok(l[1].includes('Previously treated') && !l[1].includes('First-line / untreated'), l[1].join(', '));
  assert.deepEqual(parseIndication(t), [], 'flat facets are only for a single passage');
});

test('one passage that really holds two indications is flagged uncertain', () => {
  const t = 'X is indicated for the treatment of adult patients with metastatic colorectal cancer and is also indicated for the adjuvant treatment of adult patients with stage III colon cancer';
  const groups = parseIndicationGroups(t);
  assert.ok(groups.length === 1 && groups[0].uncertain, JSON.stringify(groups));
  assert.deepEqual(parseIndication(t), []);
});

test('the PD-L1 operator is kept as written: "<1%" never becomes "≥1"', () => {
  const { all } = labels('for the treatment of adult patients with metastatic NSCLC whose tumours express PD-L1 with a tumour proportion score (TPS) < 1%.');
  assert.ok(all.has('PD-L1 TPS <1%'), [...all].join(', '));
  assert.ok(![...all].some((l) => /PD-L1 TPS ≥/.test(l)));
});
