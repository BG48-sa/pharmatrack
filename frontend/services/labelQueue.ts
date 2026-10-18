import { LabelQueue, LabelQueueEntry, LabelStatus } from '../types';

/**
 * Approval → label reconciliation queue (pending-labels.json).
 *
 * DrugRadar shows a medicine the day it is approved — often before its official
 * label exists. The nightly pipeline (scripts/label-reconciliation.py) tracks
 * every such hand-over until the authoritative document has been ingested and
 * verified, and publishes the queue with each data release. This service
 * answers, for one product, where that hand-over stands:
 *
 *   pending    official document not yet published (US: no prescribing
 *              information at openFDA; EU: no SmPC, or Commission decision pending)
 *   available  document detected, not yet ingested and validated
 *   verified   official text ingested, validated, hash + document reference recorded
 *
 * A VERIFIED US entry also carries the Indications and Usage text, so the app
 * can show the official wording where the live openFDA query finds nothing
 * (openFDA links a label to its application number only after harmonisation,
 * which can take months).
 *
 * Starts empty; services/liveData.ts loads the shipped snapshot at startup.
 */

let data: LabelQueue = { generated: '', entries: [] };
let byApp = new Map<string, LabelQueueEntry>();
let byBrand = new Map<string, LabelQueueEntry>();
let byEma = new Map<string, LabelQueueEntry>();

const norm = (t?: string | null): string =>
  (t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// Swap in a fresher snapshot fetched at runtime (see services/liveData.ts).
export const __setLabelQueue = (d: LabelQueue): void => {
  data = d && Array.isArray(d.entries) ? d : { generated: '', entries: [] };
  byApp = new Map();
  byBrand = new Map();
  byEma = new Map();
  for (const e of data.entries) {
    if (e.jurisdiction === 'FDA') {
      if (e.applicationNumber) byApp.set(e.applicationNumber.toUpperCase(), e);
      if (e.drug) byBrand.set(norm(e.drug), e);
    } else if (e.emaNumber) {
      byEma.set(e.emaNumber.toUpperCase(), e);
    }
  }
};

/** Date the queue was last rebuilt (YYYY-MM-DD), '' when no snapshot is loaded. */
export const labelQueueGenerated = (): string => data.generated || '';

/** Queue entry of a US product, by application number first, then by brand name. */
export const usLabelEntry = (app?: string, brand?: string): LabelQueueEntry | undefined =>
  (app ? byApp.get(app.toUpperCase()) : undefined) || (brand ? byBrand.get(norm(brand)) : undefined);

/** Queue entry of an EU medicine, by EMA product number (EMEA/H/C/…). */
export const euLabelEntry = (emaNumber?: string): LabelQueueEntry | undefined =>
  emaNumber ? byEma.get(emaNumber.toUpperCase()) : undefined;

/** Collapse the pipeline's five statuses into the three the reader sees. */
export const labelStatusOf = (e: LabelQueueEntry): LabelStatus =>
  e.status === 'LABEL_VERIFIED' ? 'verified' : e.status === 'LABEL_AVAILABLE' ? 'available' : 'pending';

const fmt = (iso?: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

/** One-sentence explanation of a US hand-over state, for the detail sheet and PDF. */
export const usLabelNote = (e: LabelQueueEntry, status: LabelStatus): string => {
  const lb = e.label || {};
  if (status === 'verified') {
    const version = lb.effective ? ` (label version${lb.version ? ` ${lb.version}` : ''} of ${fmt(lb.effective)})` : '';
    const ref = lb.setId ? `, DailyMed set ID ${lb.setId}` : '';
    const note = lb.note ? ` ${lb.note[0].toUpperCase()}${lb.note.slice(1)}.` : '';
    return `Official FDA prescribing information verified ${fmt(lb.retrieved || e.statusSince)}${version}${ref}.${note}`;
  }
  if (status === 'available') {
    return `Prescribing information found at openFDA; DrugRadar records and verifies it with the next data release (checked nightly, last ${fmt(e.lastChecked)}).`;
  }
  const shown = e.summary || e.sources?.includes('novel') || e.sources?.includes('cber')
    ? 'The indication shown is a summary.'
    : 'No indication text is available yet.';
  return `Newly approved — FDA has not yet published the full prescribing information in openFDA (DrugRadar checks nightly, last ${fmt(e.lastChecked)}). ${shown}`;
};

/** One-sentence explanation of an EU hand-over state, for the detail sheet and PDF. */
export const euLabelNote = (e: LabelQueueEntry, status: LabelStatus): string => {
  const lb = e.label || {};
  if (status === 'verified') {
    return `Product information (SmPC) ingested and verified${lb.retrieved ? `, text retrieved ${fmt(lb.retrieved)}` : ''}.`;
  }
  if (status === 'available') {
    return `EMA has published the product information${lb.detected ? ` (detected ${fmt(lb.detected)})` : ''}; the SmPC wording is ingested and verified by the next weekly label refresh.`;
  }
  if (e.status === 'AWAITING_EC_DECISION') {
    return 'Positive CHMP opinion — the Commission decision and the final product information are still pending; DrugRadar tracks this medicine until its SmPC is ingested.';
  }
  return `EU authorisation granted, but EMA has not yet published the product information (SmPC) — the indication wording comes from EMA's medicine table. DrugRadar checks daily (last ${fmt(e.lastChecked)}).`;
};

/** labelStatus + labelStatusNote for an EU detail sheet, or nothing when the medicine is not tracked. */
export const euLabelFields = (emaNumber?: string): { labelStatus?: LabelStatus; labelStatusNote?: string } => {
  const e = euLabelEntry(emaNumber);
  if (!e) return {};
  const status = labelStatusOf(e);
  return { labelStatus: status, labelStatusNote: euLabelNote(e, status) };
};
