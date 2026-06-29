// EMA "Union list of critical medicines" — a bundled snapshot of the medicines
// the European Medicines Agency considers critical for EU health systems
// (continuity of supply matters most; a shortage would cause serious harm).
// Source spreadsheet shipped by EMA; parsed into critical-medicines.json at build.
import raw from '../critical-medicines.json';

export interface CriticalMedicine {
  /** ATC level-5 code, e.g. "A02BC05". */
  atc5: string;
  /** Active substance / INN, title-cased. */
  n: string;
  /** Route(s) of administration. */
  route: string;
  /** Date of inclusion on the list (ISO yyyy-mm-dd). */
  d: string | null;
  /** ATC level-1 anatomical main group, e.g. "J - Antiinfectives for systemic use". */
  cat: string;
  /** ATC level-4 therapeutic subgroup. */
  grp: string;
}

interface CriticalData {
  version: string;
  ref: string;
  generated: string;
  source: string;
  count: number;
  medicines: CriticalMedicine[];
}

let data = raw as CriticalData;

// Swap in a fresher snapshot fetched at runtime (see services/liveData.ts).
export const __setCriticalData = (d: CriticalData): void => { data = d; };

export const criticalVersion = (): string => data.version;
export const criticalGeneratedDate = (): string => data.generated;
export const criticalCount = (): number => data.medicines.length;

/** Distinct ATC level-1 categories, in first-seen (alphabetical ATC) order. */
export const criticalCategories = (): string[] =>
  Array.from(new Set(data.medicines.map((m) => m.cat)));

/** The single-letter ATC code from a category label ("J - Anti…" → "J"). */
export const catCode = (cat: string): string => cat.split(' - ')[0].trim();
/** The human label without the leading code ("J - Anti…" → "Anti…"). */
export const catLabel = (cat: string): string => cat.split(' - ').slice(1).join(' - ').trim();

/**
 * Filter the list by a free-text query (substance, ATC code, route, or
 * therapeutic area) and/or an ATC level-1 category. Empty query + "all"
 * returns everything. Matching is case-insensitive substring.
 */
export const filterCritical = (query: string, category: string | 'all'): CriticalMedicine[] => {
  const q = query.trim().toLowerCase();
  return data.medicines.filter((m) => {
    if (category !== 'all' && m.cat !== category) return false;
    if (!q) return true;
    return (
      m.n.toLowerCase().includes(q) ||
      m.atc5.toLowerCase().includes(q) ||
      m.route.toLowerCase().includes(q) ||
      m.grp.toLowerCase().includes(q) ||
      m.cat.toLowerCase().includes(q)
    );
  });
};

/** Group a flat medicine list by ATC level-1 category, preserving list order. */
export const groupByCategory = (
  meds: CriticalMedicine[],
): Array<{ cat: string; items: CriticalMedicine[] }> => {
  const map = new Map<string, CriticalMedicine[]>();
  for (const m of meds) {
    const arr = map.get(m.cat);
    if (arr) arr.push(m);
    else map.set(m.cat, [m]);
  }
  return Array.from(map, ([cat, items]) => ({ cat, items }));
};
