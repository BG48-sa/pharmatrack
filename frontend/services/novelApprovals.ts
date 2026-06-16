import { NovelApproval } from '../types';
import novelDataRaw from '../novel-approvals.json';

/**
 * CDER Novel Drug Approvals service.
 *
 * The main Approvals view is driven live by openFDA, which requires the
 * `openfda.pharm_class_epc` field — a harmonised field that lags real approvals,
 * so the newest novel drugs are dropped from that view for weeks/months. This
 * service serves CDER's official "Novel Drug Therapy Approvals" lists from a
 * bundled snapshot (novel-approvals.json) so those drugs always appear.
 *
 * Regenerate the snapshot with scripts/build-novel-approvals.py.
 */

const NOVEL_SOURCE_BASE =
  'https://www.fda.gov/drugs/novel-drug-approvals-fda/novel-drug-approvals-';

const data = novelDataRaw as Record<string, NovelApproval[]>;

/** Years available, newest first (e.g. ['2026', '2025']). */
export const getNovelYears = (): string[] => Object.keys(data);

/** Official CDER novel approvals for a year, newest approval first. */
export const getNovelApprovals = (year: string): NovelApproval[] => data[year] || [];

/** Link to the FDA page this year's list was sourced from. */
export const novelSourceUrl = (year: string): string => `${NOVEL_SOURCE_BASE}${year}`;

/** Client-side free-text filter over brand, ingredient, and indication. */
export const filterNovel = (entries: NovelApproval[], query: string): NovelApproval[] => {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  return entries.filter(
    (e) =>
      e.brandName.toLowerCase().includes(q) ||
      e.genericName.toLowerCase().includes(q) ||
      e.indication.toLowerCase().includes(q)
  );
};
