/**
 * US medical-device service — live openFDA queries (CDRH databases).
 *
 * Three feeds, matching how a clinician thinks about devices:
 *   • pmaApprovals()   — original PMA approvals (Class III, high-risk: the
 *                        closest device equivalent of a new-drug approval).
 *   • clearances510k() — 510(k) clearances and De Novo grants (moderate risk;
 *                        the bulk of device market entries).
 *   • deviceRecalls()  — recent recalls (safety signal feed).
 *
 * US-only by design: the EU has no queryable device-approval database yet.
 * EUDAMED registration became mandatory for new MDR/IVDR devices on
 * 28 May 2026, but public coverage stays thin until certificates finish
 * loading (~May 2027) — revisit an EU feed then.
 */

const PMA_API = 'https://api.fda.gov/device/pma.json';
const K510_API = 'https://api.fda.gov/device/510k.json';
const RECALL_API = 'https://api.fda.gov/device/recall.json';

export interface DevicePma {
  pmaNumber: string;
  tradeName: string;
  genericName: string;
  applicant: string;
  decisionDate: string;   // YYYY-MM-DD
  committee: string;      // advisory-committee description, e.g. "Cardiovascular"
  expedited: boolean;
  aoStatement: string;    // FDA approval-order statement (what was approved)
  url: string;            // FDA PMA database page
}

export interface Device510k {
  kNumber: string;
  deviceName: string;
  applicant: string;
  decisionDate: string;
  committee: string;
  deNovo: boolean;        // DEN number = De Novo grant (novel low/moderate-risk)
  url: string;
}

export interface DeviceRecall {
  firm: string;
  product: string;
  reason: string;
  rootCause: string;
  date: string;           // event initiated
  status: string;
  url?: string;
}

const iso = (v?: string): string => {
  const s = (v || '').trim();
  // openFDA device dates are already YYYY-MM-DD
  return s.slice(0, 10);
};

const monthsAgoISO = (months: number): string => {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
};

const todayISO = (): string => new Date().toISOString().slice(0, 10);

// openFDA free-text term: quote it so multi-word queries stay one phrase.
const quoted = (q: string): string => `"${q.replace(/["+]/g, ' ').trim()}"`;

const request = async (api: string, search: string, sort: string, limit: number): Promise<any[]> => {
  const params = new URLSearchParams({ search, sort, limit: String(limit) });
  const res = await fetch(`${api}?${params.toString()}`);
  if (res.status === 404) return []; // openFDA's "no matches" is a 404
  if (!res.ok) throw new Error(`openFDA device request failed (${res.status}).`);
  const json = await res.json();
  return json.results || [];
};

/** Original PMA approvals (supplements excluded), newest first. */
export const pmaApprovals = async (query = ''): Promise<DevicePma[]> => {
  // Originals are rare (~25/year) — look back further than the other feeds.
  let search = `decision_date:[${monthsAgoISO(24)} TO ${todayISO()}] AND NOT supplement_number:S*`;
  if (query.trim()) {
    const q = quoted(query);
    search += ` AND (trade_name:${q} OR generic_name:${q} OR applicant:${q} OR advisory_committee_description:${q})`;
  }
  const rows = await request(PMA_API, search, 'decision_date:desc', 60);
  return rows
    .filter((r) => r.decision_code === 'APPR')
    .map((r) => ({
      pmaNumber: r.pma_number || '',
      tradeName: r.trade_name || r.generic_name || '—',
      genericName: r.generic_name || '',
      applicant: r.applicant || '',
      decisionDate: iso(r.decision_date),
      committee: r.advisory_committee_description || '',
      expedited: r.expedited_review_flag === 'Y',
      aoStatement: r.ao_statement || '',
      url: `https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfpma/pma.cfm?id=${encodeURIComponent(r.pma_number || '')}`,
    }));
};

/** 510(k) clearances + De Novo grants, newest first. */
export const clearances510k = async (query = ''): Promise<Device510k[]> => {
  let search = `decision_date:[${monthsAgoISO(3)} TO ${todayISO()}]`;
  if (query.trim()) {
    const q = quoted(query);
    search = `decision_date:[${monthsAgoISO(12)} TO ${todayISO()}] AND (device_name:${q} OR applicant:${q} OR advisory_committee_description:${q})`;
  }
  const rows = await request(K510_API, search, 'decision_date:desc', 60);
  return rows.map((r) => {
    const k = r.k_number || '';
    const deNovo = k.startsWith('DEN');
    return {
      kNumber: k,
      deviceName: r.device_name || '—',
      applicant: r.applicant || '',
      decisionDate: iso(r.decision_date),
      committee: r.advisory_committee_description || '',
      deNovo,
      url: deNovo
        ? `https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfpmn/denovo.cfm?id=${encodeURIComponent(k)}`
        : `https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfpmn/pmn.cfm?ID=${encodeURIComponent(k)}`,
    };
  });
};

/** Recent device recalls, newest first. */
export const deviceRecalls = async (query = ''): Promise<DeviceRecall[]> => {
  let search = `event_date_initiated:[${monthsAgoISO(6)} TO ${todayISO()}]`;
  if (query.trim()) {
    const q = quoted(query);
    search = `event_date_initiated:[${monthsAgoISO(24)} TO ${todayISO()}] AND (product_description:${q} OR recalling_firm:${q})`;
  }
  const rows = await request(RECALL_API, search, 'event_date_initiated:desc', 60);
  return rows.map((r) => ({
    firm: r.recalling_firm || '—',
    product: r.product_description || '—',
    reason: r.reason_for_recall || '',
    rootCause: r.root_cause_description || '',
    date: iso(r.event_date_initiated),
    status: r.recall_status || '',
    url: r.cfres_id
      ? `https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfRES/res.cfm?id=${encodeURIComponent(r.cfres_id)}`
      : undefined,
  }));
};
