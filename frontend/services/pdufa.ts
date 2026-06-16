import { PdufaEntry } from '../types';
import pdufaRaw from '../pdufa.json';

/**
 * Curated PDUFA watchlist (sponsor/analyst-disclosed FDA target action dates).
 * The FDA does not publish PDUFA dates, so this is a hand-maintained list in
 * frontend/pdufa.json — not a live or official feed.
 */
const allEntries = (pdufaRaw as { entries: PdufaEntry[] }).entries || [];

const todayISO = (): string => new Date().toISOString().slice(0, 10);

// Return upcoming entries (date today or later), soonest first.
export const getUpcomingPdufa = (): PdufaEntry[] => {
  const today = todayISO();
  return allEntries
    .filter((e) => (e.pdufaDate || '').slice(0, 10) >= today)
    .sort((a, b) => a.pdufaDate.localeCompare(b.pdufaDate));
};

// Days from today until a PDUFA date (negative if past). null if unparseable.
export const daysUntil = (pdufaDate: string): number | null => {
  const d = new Date(pdufaDate.length === 7 ? `${pdufaDate}-01` : pdufaDate);
  if (isNaN(d.getTime())) return null;
  const ms = d.getTime() - new Date(todayISO()).getTime();
  return Math.round(ms / 86_400_000);
};
