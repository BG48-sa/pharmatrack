/**
 * Per-drug private notes, stored on-device.
 *
 * A single JSON map (Capacitor Preferences → native UserDefaults, localStorage
 * fallback) keyed by a stable drug identity, so a note written on a card opened
 * from any tab (Europe, Novel, US…) reattaches to the same drug next time. Notes
 * never leave the device. All calls are best-effort and never throw.
 */
import { storeGet, storeSet } from './storage';
import { DrugDetailData } from '../types';

const KEY = 'dr_notes';

export interface Note {
  text: string;
  updated: string; // ISO timestamp of the last edit
}

type NoteMap = Record<string, Note>;

// A stable identity for a drug across tabs: brand + INN/generic, normalised.
// Brand alone collides across biosimilars/holders; brand+generic is stable
// because every tab fills genericName (falling back to substance or '—').
export const drugKey = (d: Pick<DrugDetailData, 'brandName' | 'genericName'>): string =>
  `${(d.brandName || '').trim().toLowerCase()}::${(d.genericName || '').trim().toLowerCase()}`;

const readAll = async (): Promise<NoteMap> => {
  const raw = await storeGet(KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as NoteMap) : {};
  } catch {
    return {};
  }
};

export const getNote = async (key: string): Promise<string> => {
  const all = await readAll();
  return all[key]?.text ?? '';
};

/** Persist (or clear, when text is empty) the note for a drug. Returns the saved text. */
export const setNote = async (key: string, text: string): Promise<string> => {
  const trimmed = text.trim();
  const all = await readAll();
  if (trimmed) all[key] = { text: trimmed, updated: new Date().toISOString() };
  else delete all[key];
  await storeSet(KEY, JSON.stringify(all));
  return trimmed;
};

/** How many drugs currently have a saved note (for a badge/overview). */
export const notedCount = async (): Promise<number> =>
  Object.keys(await readAll()).length;
