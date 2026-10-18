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
  /** 'label' = text from the official label; 'summary' = DrugRadar's abbreviated summary (eligibility criteria may be shortened). */
  indicationSource?: 'label' | 'summary';
  is351k?: boolean;
  applicationDate351k?: string;
  applicationNumber?: string;  // NDA/BLA number (Drugs@FDA), when known
  /** Approval → label hand-over state from pending-labels.json (recent approvals only). */
  labelStatus?: LabelStatus;
  labelStatusNote?: string;
  /** Longer official Indications and Usage text (verified label), for the detail sheet and PDF; `indication` stays card-length. */
  indicationFull?: string;
}

// Approval → label reconciliation queue (pending-labels.json, rebuilt nightly by
// scripts/label-reconciliation.py): one entry per recently approved medicine
// until its official label (US prescribing information / EU SmPC) has been
// ingested and verified. Status never goes backwards (release gate G8).
export type LabelQueueStatus = 'AWAITING_USPI' | 'AWAITING_EC_DECISION' | 'AWAITING_SMPC' | 'LABEL_AVAILABLE' | 'LABEL_VERIFIED';
/** The three states the app shows: pending (no official document yet), available (document detected, not yet verified), verified. */
export type LabelStatus = 'pending' | 'available' | 'verified';
export interface LabelQueueEntry {
  id: string;
  jurisdiction: 'FDA' | 'EMA';
  drug: string;
  inn?: string | null;
  applicationNumber?: string | null;
  emaNumber?: string;
  slug?: string;
  approvalDate?: string;
  opinionDate?: string | null;
  decisionDate?: string | null;
  status: LabelQueueStatus;
  statusSince: string;
  lastChecked?: string;
  sources?: string[];
  summary?: string | null;
  note?: string;
  alert?: string;
  label?: {
    setId?: string | null; version?: string | null; effective?: string | null; retrieved?: string | null; detected?: string | null;
    url?: string | null; sha256?: string | null; indications?: string; note?: string; harmonised?: boolean; applicationNumber?: string | null;
  };
}
export interface LabelQueue {
  generated: string;
  entries: LabelQueueEntry[];
  summary?: { total: number; unresolved: number; byStatus: Record<LabelQueueStatus, number>; alerts: number };
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
  dev?: boolean;     // Drug-device combination (integral implant / inhaler / pen)
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
  num?: string;     // EMA product number (EMEA/H/C/006388) — joins the label queue and EMA's document list
  d: string;        // marketing-authorisation date (YYYY-MM-DD)
  op?: string;      // CHMP opinion date, if recorded
  fs?: string;      // date DrugRadar first imported this record (YYYY-MM-DD) — drives the NEW marker
  cls?: string;     // ATMP class (gene therapy / CAR-T / somatic-cell / tissue-engineered), reviewed or INN-stem based
  condFull?: string; // date a conditional MA was converted to a full MA (sourced override)
  ec?: 'register';  // MA date taken from the EU Union Register (Commission decision) because EMA's table still said 'Opinion'
  indSrc?: 'smpc';  // 'ind' is the SmPC section 4.1 wording (else EMA's medicine table)
  indRet?: string;  // date the SmPC text was retrieved from EMA (YYYY-MM-DD)
  indT?: string[];  // age phrases of EMA's table where it disagrees with the SmPC
}

// A medicine with a CHMP opinion adopted but no MA yet — the European
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
  outcome?: 'positive' | 'unknown'; // negative opinions are never listed here
  cls?: string;
}

// A medicine that is no longer authorised in the EU, or never was: the MA was
// withdrawn / expired / lapsed / revoked / suspended, the application was
// refused, or the applicant withdrew it before an opinion.
export interface EmaGoneItem extends EmaFlags {
  n: string;
  inn: string;
  sub: string;
  area: string;
  atc: string;
  ind: string;
  url: string;
  holder: string;
  st: string;        // EMA "Medicine status" (Withdrawn, Refused, Expired, …)
  e: string;         // date of that event (YYYY-MM-DD); '' when EMA records none
  ex?: boolean;      // e is the latest EC decision date, not an explicit withdrawal date
  d?: string;        // original marketing-authorisation date, if it ever had one
  op?: string;       // CHMP opinion date, if recorded
}

export interface EmaData {
  generated: string;
  byName?: Record<string, { d: string; n: string; u: string; b: boolean }>;
  byInn: Record<string, { d: string; n: string; u: string; b: boolean; k?: number }>; // k = number of EU products sharing the INN
  authorised: EmaMedicine[];
  pipeline: EmaPipelineItem[];
  gone?: EmaGoneItem[]; // absent in snapshots built before Sept 2026
}

// Normalized shape passed to the DrugDetail sheet, so a card from any tab
// (Novel, Approvals, or Europe) can open the same detail view and cross-link
// to trials.
export interface DrugDetailData {
  brandName: string;
  genericName: string;
  approvalDate: string;   // raw FDA value: ISO date; 'Same substance in US (<name>, <date>)' for an EU record matched on INN only; or 'N/A'
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
  opinionDate?: string;      // CHMP opinion date for a pending item
  statusNote?: string;       // e.g. 'Withdrawn 2025-02-20' for a no-longer-authorised EU medicine
  sourceNote?: string;       // provenance of the EU date when it is not EMA's own record (Union Register)
  indicationSource?: 'label' | 'summary';
  indicationNote?: string;   // which document the indication wording comes from, with its date
  indicationConflict?: string; // set when another official source words the age limits differently
  /** Approval → label hand-over state (pending-labels.json) for recently approved medicines. */
  labelStatus?: LabelStatus;
  labelStatusNote?: string;
  indicationFull?: string;   // longer official label text than the card-length `indication`, when available
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
