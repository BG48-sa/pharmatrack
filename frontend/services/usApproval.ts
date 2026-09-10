import { cgtRecords } from './fdaService';
import { allNovelApprovals } from './novelApprovals';

/**
 * EU → US reverse lookup — the mirror image of fdaService.lookupEma.
 *
 * The US tab enriches every FDA record with its EU authorisation. The Europe
 * tab used to leave the FDA side empty ('N/A'), so an EU medicine such as
 * Carvykti showed no FDA date although the app carries it offline (CBER list,
 * BLA125746, 2022-02-28). This module answers "is this EU medicine FDA-approved?"
 * from the snapshots the app has WITHOUT a network call:
 *   • cgt-products.json    — FDA CBER approved cellular & gene therapy products
 *   • novel-approvals.json — CDER novel drug approvals (recent years)
 * Both lists are small, curated and product-specific, so matching stays strict:
 *   1. product name, exact after case/accent folding  → that product's FDA date
 *   2. INN, exact, and only when ONE US product carries it → reported as a
 *      substance match, because the US product may trade under another name
 *      (Libmeldy is Lenmeldy in the US) or be a different product altogether.
 * Anything else is 'N/A'. The snapshots do not cover older CDER approvals, so an
 * absence here says nothing about FDA status — the UI says what is covered.
 */

const norm = (t: string): string =>
  t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[®™]/g, '').trim();

interface UsRec { d: string; n: string; g: string }

const snapshotRecords = (): UsRec[] => [
  ...cgtRecords()
    .filter((r) => r.n && r.d)
    .map((r) => ({ d: r.d, n: r.n as string, g: r.g || '' })),
  ...allNovelApprovals()
    .filter((e) => e.brandName && e.approvalDate)
    .map((e) => ({ d: e.approvalDate, n: e.brandName, g: e.genericName || '' })),
];

export interface UsApprovalHit {
  d: string;       // FDA approval date (YYYY-MM-DD); the earliest when several records match
  n: string;       // US product name
  byName: boolean; // true = matched on the product name; false = on the INN only
}

const earliest = (rs: UsRec[]): string => rs.map((r) => r.d).sort()[0];

/** FDA approval of an EU medicine from the offline snapshots, or undefined when none is known. */
export const findUsApproval = (brand: string, inn?: string): UsApprovalHit | undefined => {
  const b = norm(brand || '');
  const i = norm(inn || '');
  const all = snapshotRecords();
  if (b) {
    const byName = all.filter((r) => norm(r.n) === b);
    if (byName.length) return { d: earliest(byName), n: byName[0].n, byName: true };
  }
  if (i) {
    const byInn = all.filter((r) => r.g && norm(r.g) === i);
    const names = new Set(byInn.map((r) => norm(r.n)));
    if (names.size === 1) return { d: earliest(byInn), n: byInn[0].n, byName: false };
  }
  return undefined;
};

/**
 * The DrugDetailData.approvalDate value for an EU medicine: the ISO date when
 * the product itself is found, 'Same substance in US (<name>, <date>)' for an
 * INN-only match, else 'N/A' (nothing known offline).
 */
export const usApprovalFor = (brand: string, inn?: string): string => {
  const hit = findUsApproval(brand, inn);
  if (!hit) return 'N/A';
  return hit.byName ? hit.d : `Same substance in US (${hit.n}, ${hit.d})`;
};

export type UsApprovalState = 'approved' | 'substance' | 'none';

/**
 * Wording for the US (FDA) side, shared by the detail header, the access-status
 * ladder and the compare cards so the three never disagree. `fmt` formats an
 * ISO date the way the caller displays dates.
 */
export const describeUsApproval = (
  value: string | undefined,
  fmt: (iso: string) => string,
): { state: UsApprovalState; text: string; date?: string } => {
  const v = value || '';
  if (/^\d{4}-\d{2}/.test(v)) {
    const f = fmt(v);
    if (f) return { state: 'approved', text: `Approved ${f}`, date: f };
  }
  const m = v.match(/^Same substance in US \((.+), (\d{4}-\d{2}(?:-\d{2})?)\)$/);
  if (m) return { state: 'substance', text: `Same substance approved in the US as ${m[1]}, ${fmt(m[2]) || m[2]}` };
  return { state: 'none', text: 'No FDA record in app data' };
};

/** Why an FDA record can be missing here (shown under a 'none' row). */
export const US_COVERAGE_NOTE =
  'The app’s FDA data covers CBER cell & gene therapies and CDER’s recent novel approvals; for other products, check Drugs@FDA.';
