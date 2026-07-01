/**
 * Watched indications.
 *
 * The user follows medical indications (e.g. "multiple myeloma"), not individual
 * drugs — so a reminder fires for *any* drug reaching an EU decision in that
 * area, including ones that only enter the pipeline later. The list is stored
 * on-device (see storage.ts) and drives the local-notification scheduler.
 */
import { storeGet, storeSet } from './storage';

const KEY = 'dr_watched_indications';
const MAX_WATCHED = 20;

/** Read the saved indications. Returns [] on first launch or any read error. */
export const getWatched = async (): Promise<string[]> => {
  const raw = await storeGet(KEY);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((t) => typeof t === 'string') : [];
  } catch {
    return [];
  }
};

/** Normalise: trim, drop blanks, de-dupe case-insensitively, cap the count. */
export const normaliseWatched = (terms: string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of terms) {
    const t = raw.trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= MAX_WATCHED) break;
  }
  return out;
};

/** Persist the (normalised) list. */
export const setWatched = async (terms: string[]): Promise<string[]> => {
  const clean = normaliseWatched(terms);
  await storeSet(KEY, JSON.stringify(clean));
  return clean;
};
