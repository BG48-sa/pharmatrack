/**
 * Saved searches.
 *
 * Lets the user bookmark a query on any tab and re-run it in one tap. Stored
 * on-device like the watchlist (Capacitor Preferences with a localStorage
 * fallback, see storage.ts) — nothing leaves the device.
 */
import { storeGet, storeSet } from './storage';

const KEY = 'dr_saved_searches';
const MAX_SAVED = 15;

export interface SavedSearch {
  q: string;
  tab: string; // SearchBar mode: europe | novel | approvals | pipeline | critical
}

const sameSearch = (a: SavedSearch, b: SavedSearch): boolean =>
  a.tab === b.tab && a.q.toLowerCase() === b.q.toLowerCase();

/** Read the saved searches. Returns [] on first use or any read error. */
export const getSavedSearches = async (): Promise<SavedSearch[]> => {
  const raw = await storeGet(KEY);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr)
      ? arr.filter((s) => s && typeof s.q === 'string' && typeof s.tab === 'string')
      : [];
  } catch {
    return [];
  }
};

/** Add a search (most recent first, de-duped, capped). Returns the new list. */
export const addSavedSearch = async (s: SavedSearch): Promise<SavedSearch[]> => {
  const q = s.q.trim();
  if (!q) return getSavedSearches();
  const entry = { q, tab: s.tab };
  const list = [entry, ...(await getSavedSearches()).filter((x) => !sameSearch(x, entry))].slice(
    0,
    MAX_SAVED
  );
  await storeSet(KEY, JSON.stringify(list));
  return list;
};

/** Remove a search. Returns the new list. */
export const removeSavedSearch = async (s: SavedSearch): Promise<SavedSearch[]> => {
  const list = (await getSavedSearches()).filter((x) => !sameSearch(x, s));
  await storeSet(KEY, JSON.stringify(list));
  return list;
};
