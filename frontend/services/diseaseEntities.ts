/**
 * Curated disease-entity catalog for side-by-side drug-class comparison.
 *
 * WHY THIS EXISTS
 *   Typing a disease into openFDA's label endpoint returns an incomplete, noisy
 *   set — e.g. "chronic myeloid leukemia" misses bosutinib and asciminib (their
 *   labels say "Ph+ CML" / "chronic myelogenous leukemia") and returns duplicate
 *   generic-manufacturer records. For a clinician-grade class comparison that is
 *   not good enough, so the canonical member drugs of each high-value disease
 *   entity are hand-curated here (like cgt-products.json for CBER therapies).
 *
 *   Each member drug is then ENRICHED offline from the bundled EMA data (central
 *   MA date + EPAR link, which also lets the same-molecule EU/US full-label
 *   comparison resolve), so the whole feature works with no network.
 *
 * SHAPE (disease-entities.json)
 *   { generated, entities: [ { id, name, short, syn[], cls, drugs:[{b,g,co}] } ] }
 *   b=brand, g=generic/INN, co=company. `syn` = lowercase search synonyms.
 *
 * To add a disease: append an entity with its canonical class members and re-run
 * nothing — it is pure data, bundled and also published for the live refresh.
 */
import diseaseRaw from '../disease-entities.json';
import { lookupEmaRec } from './fdaService';
import { DrugDetailData } from '../types';

export interface DiseaseDrug {
  b: string; // brand
  g: string; // generic / INN
  co?: string; // company
  // Optional offline overrides for the US column. openFDA keys its approval date
  // and label to the FIRST product with a given INN, so a newer brand that shares
  // its molecule with an older product inherits the wrong US date/indication
  // (alemtuzumab: Lemtrada[MS 2014] gets Campath[B-CLL 2001]; ofatumumab:
  // Kesimpta[MS 2020] gets Arzerra[CLL 2009]). When set, these win and the live
  // openFDA enrichment must not overwrite them (see enrichDiseaseFda in App.tsx).
  fda?: string; // correct US (FDA) approval date, ISO yyyy-mm-dd
  ind?: string; // correct US indication text
  // Optional offline overrides for the EU column, for the same reason on the EMA
  // side: `lookupEmaRec` matches by INN and returns the EARLIEST central MA for
  // that molecule, which can be a different product than the one being compared
  // (cabozantinib: Cabometyx[RCC 2016] resolves to Cometriq[thyroid 2014];
  // cladribine: Mavenclad[MS 2017] resolves to Litak[oncology]). When set, these
  // win over the byInn lookup in buildDiseaseComparison.
  emad?: string; // correct EU (EMA) marketing-authorisation date, ISO yyyy-mm-dd
  emau?: string; // correct EPAR URL (also used to resolve the EU full-label view)
}
export interface DiseaseEntity {
  id: string;
  name: string;
  short?: string;
  syn: string[];
  cls: string;
  drugs: DiseaseDrug[];
}

let entities = (diseaseRaw as { entities: DiseaseEntity[] }).entities;

/** Swap in the freshest catalog fetched at runtime (see services/liveData.ts). */
export const __setDiseaseData = (d: { entities?: DiseaseEntity[] }): void => {
  if (d.entities) entities = d.entities;
};

/**
 * Match a search query to a curated disease entity. Matches on the display name
 * or any synonym, requiring a whole-token overlap so a short query can't match
 * by accident. Returns the first (most specific) match, or undefined.
 */
export const findDisease = (query: string): DiseaseEntity | undefined => {
  const s = query.toLowerCase().trim();
  if (s.length < 3) return undefined;
  return entities.find((e) => {
    if (e.name.toLowerCase().includes(s)) return true;
    return e.syn.some((syn) => syn === s || syn.includes(s) || s.includes(syn));
  });
};

/**
 * Build the comparison rows for a disease: one normalised DrugDetailData per
 * member drug, enriched offline with the EU (EMA) marketing-authorisation date
 * and EPAR link. The US (FDA) date is left 'N/A' here and filled in live by the
 * caller when online (openFDA), so the feature always renders without a network.
 */
export const buildDiseaseComparison = (e: DiseaseEntity): DrugDetailData[] =>
  e.drugs.map((d) => {
    const ema = lookupEmaRec(d.g) || lookupEmaRec(d.g.split(/[\s,]/)[0]);
    return {
      brandName: d.b,
      genericName: d.g,
      approvalDate: d.fda || 'N/A',
      indication: d.ind || '',
      drugClass: e.cls,
      company: d.co || '—',
      emaApprovalDate: d.emad || (ema ? ema.d : 'Not in EMA'),
      emaUrl: d.emau || ema?.u || undefined,
      badge: e.short || undefined,
    };
  });
