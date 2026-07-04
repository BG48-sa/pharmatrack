import emaDataRaw from '../ema-medicines.json';
import { EmaData, EmaMedicine, EmaPipelineItem, DrugDetailData, EmaFlags } from '../types';

/**
 * European medicines service — the EU-first counterpart to fdaService.
 *
 * All data comes from a bundled snapshot of the EMA's official "Download
 * medicine data" report (EMA has no live, CORS-friendly query API). It answers
 * the two questions an EMA committee member cares about most:
 *
 *   • What has just been authorised in the EU?  -> recentApprovals()
 *   • What marketing authorisation is expected?  -> pipeline() (positive CHMP
 *     opinion adopted, European Commission decision pending ≈67 days out)
 *
 * Search spans drug name, INN/substance, therapeutic area, indication and ATC
 * code, so "by disease" and "by drug" both work. Regenerate the snapshot with
 * scripts/build-ema-data.py.
 */

let data = emaDataRaw as unknown as EmaData;

// Swap in a fresher snapshot fetched at runtime (see services/liveData.ts).
// Falls back to the bundled import if never called.
export const __setEmaData = (d: EmaData): void => { data = d; };

export const emaGeneratedDate = (): string => data.generated;

// CHMP positive opinion -> European Commission decision is ~67 days by law.
const EC_DECISION_LAG_DAYS = 67;

export const estimatedDecisionDate = (opinionISO: string): string => {
  const d = new Date(opinionISO);
  if (isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + EC_DECISION_LAG_DAYS);
  return d.toISOString().slice(0, 10);
};

export type EmaFilter = 'all' | 'atmp' | 'orphan' | 'prime' | 'gen';

const matchesFilter = (m: EmaFlags, f: EmaFilter): boolean => {
  switch (f) {
    case 'atmp': return m.atmp;
    case 'orphan': return m.orphan;
    case 'prime': return m.prime;
    case 'gen': return m.gen;
    default: return true;
  }
};

// Normalise British/American medical spelling so "coeliac"/"celiac",
// "anaemia"/"anemia", "tumour"/"tumor", "paediatric"/"pediatric" all match.
// Applied to BOTH the query and the searched text, so either spelling works.
const normalise = (s: string): string =>
  s
    .toLowerCase()
    .replace(/æ/g, 'ae')      // æ ligature
    .replace(/oe/g, 'e')      // coeliac->celiac, oedema->edema, oesophag->esophag, foetal->fetal
    .replace(/ae/g, 'e')      // anaemia->anemia, haem->hem, leukaemia->leukemia, paediatric->pediatric
    .replace(/our/g, 'or')    // tumour->tumor, colour->color
    .replace(/[^a-z0-9]+/g, ' ') // punctuation/hyphens -> space
    .trim();

// Generic filler words that shouldn't be required for a match — so
// "sickle cell disease" matches a record that only says "sickle cell".
const STOPWORDS = new Set([
  'disease', 'diseases', 'disorder', 'disorders', 'syndrome', 'syndromes',
  'the', 'of', 'and', 'in', 'a', 'an', 'for', 'with', 'to', 'type',
]);

// Significant search terms from a free-text query (normalised, filler removed).
export const queryTerms = (q: string): string[] => {
  const all = normalise(q).split(' ').filter(Boolean);
  const core = all.filter((t) => !STOPWORDS.has(t));
  return core.length ? core : all; // if the user typed only filler, keep it
};

// Lay term -> EMA/MeSH equivalents. The EMA catalogue uses MeSH wording
// ("Breast Neoplasms", "Carcinoma, Non-Small-Cell Lung"), so a clinician typing
// "breast cancer" would otherwise miss everything. Values are already in the
// normalise() form. A query term matches if IT or any synonym is present.
const SYNONYMS: Record<string, string[]> = {
  cancer: ['neoplasm', 'neoplasms', 'carcinoma', 'carcinomas', 'tumor'],
  carcinoma: ['cancer', 'neoplasm', 'neoplasms'],
  neoplasm: ['cancer', 'carcinoma'],
  tumor: ['neoplasm', 'neoplasms', 'cancer'], // 'tumour' -> 'tumor' via normalise
  // Broad therapeutic-area chips (Europe tab). Each expands a single category
  // word to the MeSH/EMA disease terms that actually appear in the catalogue,
  // so tapping e.g. "Hematology" surfaces leukaemia/lymphoma/anaemia records
  // even though none of them literally says "hematology".
  cancer: ['neoplasm', 'neoplasms', 'carcinoma', 'carcinomas', 'tumor', 'melanoma', 'sarcoma', 'lymphoma', 'leukemia', 'myeloma', 'oncology'],
  hematology: ['leukemia', 'lymphoma', 'myeloma', 'anemia', 'hemophilia', 'thrombocyt', 'myelodysplastic', 'myelofibrosis', 'hematopoietic', 'sickle cell', 'neutropenia', 'coagulation', 'thalassemia', 'polycythemia'],
  cardiovascular: ['hypertension', 'myocardial', 'heart failure', 'cardiac', 'coronary', 'atrial fibrillation', 'thromboembolism', 'thrombosis', 'arrhythmia', 'angina', 'dyslipid', 'cholesterol', 'stroke', 'venous', 'embolism', 'hyperlipid'],
  respiratory: ['asthma', 'copd', 'pulmonary', 'chronic obstructive', 'respiratory', 'cystic fibrosis', 'bronchi', 'pneumon'],
  metabolic: ['diabetes', 'metabolism', 'lipoprotein', 'phenylketonuria', 'gaucher', 'fabry', 'pompe', 'mucopolysaccharid', 'hyperlipid', 'cholesterol', 'obesity', 'hyperuricemia', 'amyloidosis', 'porphyria', 'hypophosphat'],
  infectious: ['infection', 'hiv', 'hepatitis', 'viral', 'bacterial', 'antibiotic', 'antiviral', 'influenza', 'tuberculosis', 'sepsis', 'fungal', 'malaria', 'covid'],
  autoimmune: ['rheumatoid', 'psoriasis', 'psoriatic', 'crohn', 'colitis', 'lupus', 'sclerosis', 'spondylitis', 'vasculitis', 'myasthenia'],
  degenerative: ['degeneration', 'parkinson', 'alzheimer', 'neurodegenerat', 'sclerosis', 'dementia', 'huntington', 'muscular atrophy'],
  ophthalmology: ['macular', 'retina', 'retinopathy', 'glaucoma', 'ocular', 'uveitis', 'keratitis', 'dry eye', 'neovascular', 'ophthalm'],
  genetic: ['inborn', 'hereditary', 'muscular atrophy', 'hemophilia', 'cystic fibrosis', 'duchenne', 'congenital', 'gene therap', 'spinal muscular'],
};

const hasTerm = (hay: string, term: string): boolean =>
  hay.includes(term) || (SYNONYMS[term]?.some((s) => hay.includes(s)) ?? false);

// Free-text match across name, INN, substance, therapeutic area, indication, ATC.
const matchesQuery = (m: EmaMedicine | EmaPipelineItem, q: string): boolean => {
  if (!q) return true;
  const hay = normalise(`${m.n} ${m.inn} ${m.sub} ${m.area} ${m.ind} ${m.atc}`);
  return queryTerms(q).every((term) => hasTerm(hay, term));
};

/** Most recently authorised EU medicines, newest first. */
export const recentApprovals = (
  query = '',
  filter: EmaFilter = 'all',
  limit = 60
): EmaMedicine[] =>
  data.authorised
    .filter((m) => matchesFilter(m, filter) && matchesQuery(m, query))
    .slice(0, limit);

/** Medicines with a positive CHMP opinion awaiting the EC decision. */
export const pipeline = (query = '', filter: EmaFilter = 'all'): EmaPipelineItem[] =>
  data.pipeline.filter((m) => matchesFilter(m, filter) && matchesQuery(m, query));

/** Count of medicines authorised strictly after the given ISO date (for "new since last visit"). */
export const countSince = (sinceISO: string): number =>
  data.authorised.filter((m) => m.d > sinceISO).length;

/** Human-readable therapeutic areas: split the ';'-delimited MeSH string. */
export const splitAreas = (area: string): string[] =>
  area.split(';').map((a) => a.trim()).filter(Boolean);

const flagsOf = (m: EmaFlags): EmaFlags => ({
  atmp: m.atmp, orphan: m.orphan, prime: m.prime, cond: m.cond,
  exc: m.exc, acc: m.acc, bio: m.bio, gen: m.gen,
});

/** Map an authorised EU medicine into the shared DrugDetail sheet shape. */
export const approvalToDetail = (m: EmaMedicine): DrugDetailData => ({
  brandName: m.n,
  genericName: m.inn || m.sub || '—',
  approvalDate: 'N/A',
  indication: m.ind || undefined,
  company: m.holder || undefined,
  emaApprovalDate: m.d,
  emaUrl: m.url || undefined,
  badge: m.atmp ? 'Advanced therapy (ATMP)' : undefined,
  therapeuticArea: m.area || undefined,
  emaFlags: flagsOf(m),
});

/** Map a pending-opinion medicine into the shared DrugDetail sheet shape. */
export const pipelineToDetail = (m: EmaPipelineItem): DrugDetailData => ({
  brandName: m.n,
  genericName: m.inn || m.sub || '—',
  approvalDate: 'N/A',
  indication: m.ind || undefined,
  company: m.holder || undefined,
  emaApprovalDate: 'MA expected',
  emaUrl: m.url || undefined,
  badge: m.reexam ? 'CHMP opinion — re-examination' : 'CHMP positive opinion',
  therapeuticArea: m.area || undefined,
  emaFlags: flagsOf(m),
  opinionDate: m.op,
  expectedDecision: estimatedDecisionDate(m.op),
});
