/**
 * Curated Biomarkers & Companion Diagnostics catalog (Europe-centered).
 *
 * WHY THIS EXISTS
 *   The clinically actionable question a prescriber asks is "what do I test, and
 *   what does the result let me prescribe" — biomarker → validated test → drugs.
 *   EMA frames this as "Biomarkers and Companion Diagnostics" (governed in the EU
 *   by the IVD Regulation, in force since May 2022), where the SmPC requires a
 *   *validated test* for the biomarker rather than one branded FDA kit. So each
 *   entry leads with the test METHOD (IHC, NGS, PCR, FISH) and lists common
 *   CE-IVD assays only as examples.
 *
 *   Member drugs are restricted to molecules AUTHORISED IN THE EU and shown with
 *   their EU brand name (Glivec, Giotrif, Tyverb…). Each is enriched offline from
 *   the bundled EMA data (central MA date + EPAR link) exactly like the disease
 *   catalog — see [[medlog]]-style enrichment in diseaseEntities.ts — so the tab
 *   works with no network and tapping through opens the EU full-label compare.
 *
 * SHAPE (biomarkers.json)
 *   { generated, biomarkers: [ { id, name, gene, alt, type, method, group,
 *     context, syn[], assays[], drugs:[{b,g,co}] } ] }
 *   group = solid | heme | nononc.  b=brand, g=generic/INN, co=company.
 *
 * To add a biomarker: append an entry with its EU-authorised member drugs and
 * re-run nothing — it is pure data, bundled and also published for live refresh.
 */
import biomarkerRaw from '../biomarkers.json';
import { lookupEmaRec } from './fdaService';
import { DrugDetailData } from '../types';

export interface BiomarkerDrug {
  b: string; // brand (EU)
  g: string; // generic / INN
  co?: string; // company
}
export type BiomarkerGroup = 'solid' | 'heme' | 'nononc';
export interface Biomarker {
  id: string;
  name: string;
  gene: string;
  /** The specific alteration, e.g. "exon 19 deletion / L858R". */
  alt: string;
  /** mutation | fusion | expression | signature | hla | enzyme. */
  type: string;
  /** EU test method(s) per the SmPC, e.g. "IHC / FISH / NGS". */
  method: string;
  group: BiomarkerGroup;
  /** Tumour type / clinical setting. */
  context: string;
  syn: string[];
  /** Example CE-IVD validated assays (illustrative, not the requirement). */
  assays: string[];
  drugs: BiomarkerDrug[];
}

let biomarkers = (biomarkerRaw as { biomarkers: Biomarker[] }).biomarkers;

/** Swap in the freshest catalog fetched at runtime (see services/liveData.ts). */
export const __setBiomarkerData = (d: { biomarkers?: Biomarker[] }): void => {
  if (d.biomarkers) biomarkers = d.biomarkers;
};

/** Human labels for the three catalog groups (order defines display order). */
export const BIOMARKER_GROUPS: { key: BiomarkerGroup; label: string }[] = [
  { key: 'solid', label: 'Solid tumours' },
  { key: 'heme', label: 'Haematology' },
  { key: 'nononc', label: 'Non-oncology / pharmacogenomic' },
];

const tokenize = (s: string): string[] => s.toLowerCase().split(/[^a-z0-9+*:]+/).filter(Boolean);

// Two tokens match when identical, or (for tokens of >=4 chars) when one is a
// prefix of the other — so "mutation"~"mutations" match but a short token like
// "kit" only ever matches "kit" exactly (never inside "biomarKIT"). Mirrors the
// whole-word matching used by the disease catalog.
const tokenMatch = (a: string, b: string): boolean =>
  a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a)));

const tokenSeqIn = (hay: string[], needle: string[]): boolean => {
  if (!needle.length || needle.length > hay.length) return false;
  for (let i = 0; i + needle.length <= hay.length; i++) {
    if (needle.every((t, j) => tokenMatch(hay[i + j], t))) return true;
  }
  return false;
};

const matches = (m: Biomarker, sTok: string[]): boolean => {
  if (tokenSeqIn(tokenize(m.name), sTok)) return true;
  if (tokenSeqIn(tokenize(m.gene), sTok)) return true;
  if (tokenSeqIn(tokenize(m.alt), sTok)) return true;
  if (m.syn.some((syn) => {
    const synTok = tokenize(syn);
    return tokenSeqIn(synTok, sTok) || tokenSeqIn(sTok, synTok);
  })) return true;
  // Also findable by a member drug (brand or INN), e.g. "olaparib" -> BRCA/HRD.
  return m.drugs.some((d) =>
    tokenSeqIn(tokenize(d.b), sTok) || tokenSeqIn(tokenize(d.g), sTok),
  );
};

/** The full catalog in display order (used to browse the tab). */
export const allBiomarkers = (): Biomarker[] => biomarkers;

/**
 * Biomarkers matching a query — by name, gene, alteration, synonym, or a member
 * drug. A gene like "EGFR" legitimately spans several entries (activating,
 * T790M, exon 20), so this returns every match in catalog order. Returns [] for
 * queries under 2 chars so short gene symbols ("RET", "KIT") still search.
 */
export const findBiomarkers = (query: string, limit = 40): Biomarker[] => {
  const s = query.toLowerCase().trim();
  if (s.length < 2) return [];
  const sTok = tokenize(s);
  return biomarkers.filter((m) => matches(m, sTok)).slice(0, limit);
};

/**
 * Build the side-by-side comparison rows for a biomarker: one normalised
 * DrugDetailData per EU-authorised member drug, enriched offline with the EMA
 * marketing-authorisation date and EPAR link. The US (FDA) column is left 'N/A'
 * and filled in live by the caller when online, mirroring the disease compare.
 * Any member drug not resolvable in the bundled EMA data is dropped, so a
 * Europe-centered tab never shows a non-EU molecule.
 */
export const buildBiomarkerComparison = (m: Biomarker): DrugDetailData[] =>
  m.drugs
    .map((d) => {
      const ema = lookupEmaRec(d.g) || lookupEmaRec(d.g.split(/[\s/,]/)[0]);
      if (!ema) return null;
      return {
        brandName: d.b,
        genericName: d.g,
        approvalDate: 'N/A',
        indication: '',
        drugClass: `${m.gene} — ${m.context}`,
        company: d.co || '—',
        emaApprovalDate: ema.d,
        emaUrl: ema.u,
        badge: m.gene,
      } as DrugDetailData;
    })
    .filter((x): x is DrugDetailData => x !== null);
