export interface Drug {
  id: number;
  brandName: string;
  genericName: string;
  indication: string;
  drugClass?: string;
  fdaApprovalDate: string;
  emaApprovalDate: string;
  emaUrl?: string;
  company: string;
  is351k?: boolean;
  applicationDate351k?: string;
}

export interface Source {
  title: string;
  uri: string;
}

// One row from CDER's official "Novel Drug Therapy Approvals" list for a given
// year (bundled snapshot, novel-approvals.json). These are the authoritative
// new-drug rosters; regenerate with scripts/build-novel-approvals.py.
export interface NovelApproval {
  no: number;
  brandName: string;
  genericName: string;
  approvalDate: string; // YYYY-MM-DD
  indication: string;
}

// EMA regulatory flags carried on every European medicine / pipeline item.
// These are the levers an EMA committee member reads first.
export interface EmaFlags {
  atmp: boolean;     // Advanced therapy medicinal product (CAT's remit)
  orphan: boolean;   // Orphan designation (rare disease)
  prime: boolean;    // PRIME priority medicine
  cond: boolean;     // Conditional marketing authorisation
  exc: boolean;      // Exceptional circumstances
  acc: boolean;      // Accelerated assessment
  bio: boolean;      // Biosimilar
  gen: boolean;      // Generic
}

// One authorised EU medicine from the bundled EMA snapshot (ema-medicines.json).
export interface EmaMedicine extends EmaFlags {
  n: string;        // product name
  inn: string;      // International non-proprietary name
  sub: string;      // active substance
  area: string;     // therapeutic area (MeSH) — ';'-separated
  atc: string;      // ATC code (human)
  ind: string;      // therapeutic indication (truncated)
  url: string;      // EMA medicine page
  holder: string;   // marketing-authorisation holder
  d: string;        // marketing-authorisation date (YYYY-MM-DD)
  op?: string;      // CHMP opinion date, if recorded
}

// A medicine with a positive CHMP opinion but no MA yet — the European
// Commission decision (≈67 days after opinion) is imminent. This is the
// "marketing authorisation expected" feed.
export interface EmaPipelineItem extends EmaFlags {
  n: string;
  inn: string;
  sub: string;
  area: string;
  atc: string;
  ind: string;
  url: string;
  holder: string;
  op: string;        // CHMP opinion adopted date (YYYY-MM-DD)
  reexam: boolean;   // opinion under re-examination
}

export interface EmaData {
  generated: string;
  byInn: Record<string, { d: string; n: string; u: string; b: boolean }>;
  authorised: EmaMedicine[];
  pipeline: EmaPipelineItem[];
}

// Normalized shape passed to the DrugDetail sheet, so a card from any tab
// (Novel, Approvals, or Europe) can open the same detail view and cross-link
// to trials.
export interface DrugDetailData {
  brandName: string;
  genericName: string;
  approvalDate: string;   // raw FDA value (ISO, or 'N/A')
  indication?: string;
  drugClass?: string;
  company?: string;
  emaApprovalDate?: string;
  emaUrl?: string;
  badge?: string;         // e.g. 'Novel 2025' or '351(k) Biosimilar'
  // EU-specific enrichment (set when opened from the Europe tab).
  therapeuticArea?: string;
  emaFlags?: EmaFlags;
  expectedDecision?: string; // estimated EC decision date for a pending opinion
  opinionDate?: string;      // CHMP positive-opinion date for a pending item
}

// Curated, user-maintained PDUFA watchlist (sponsor/analyst-disclosed target
// dates — NOT an official FDA feed). Edit frontend/pdufa.json to manage.
export interface PdufaEntry {
  brandName: string;
  genericName: string;
  company: string;
  indication: string;
  pdufaDate: string; // YYYY-MM-DD (or YYYY-MM)
  type?: string;     // e.g. NDA, BLA, sNDA, 351(k)
  note?: string;
  source?: string;   // URL to verify (press release / calendar)
}

// A late-stage clinical trial from ClinicalTrials.gov (pipeline proxy).
export interface Trial {
  nctId: string;
  title: string;
  status: string;
  phase: string;
  conditions: string[];
  sponsor: string;
  startDate?: string;
  completionDate?: string;
  url: string;
}

export interface DrugDataResponse {
  drugs: Drug[];
  sources: Source[];
}
