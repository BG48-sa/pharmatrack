/**
 * FDA approval ANNOUNCEMENTS — press releases mirrored into announcements.json
 * by scripts/build-announcements.py (refresh-data.sh runs it).
 *
 * Purpose: openFDA's datasets refresh on a ~weekly cycle, so a drug approved
 * this morning is announced by the FDA press office hours before it becomes
 * searchable in the Approvals tab. These entries bridge that gap: shown as an
 * "announced — database entry pending" banner, and as a hint when a search
 * for a just-approved drug returns nothing.
 *
 * Starts empty; services/liveData.ts loads the shipped snapshot at startup.
 */

export interface Announcement {
  title: string;
  url: string;
  date: string; // YYYY-MM-DD
  source: 'FDA' | 'Drugs.com';
  /** Lowercased drug names extracted from the headline (may be empty). */
  names: string[];
}

let allItems: Announcement[] = [];

// Swap in a fresher snapshot fetched at runtime (see services/liveData.ts).
export const __setAnnouncementsData = (d: { items?: Announcement[] }): void => {
  allItems = d.items || [];
};

const daysAgoISO = (days: number): string =>
  new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

/** Recent announcements, newest first. Default window: the openFDA lag risk
 *  period plus margin — older approvals are in the database by then. */
export const getAnnouncements = (maxAgeDays = 45): Announcement[] =>
  allItems.filter((a) => a.date >= daysAgoISO(maxAgeDays));

/** Announcements whose extracted drug names or headline match a search query.
 *  Used when an FDA search returns nothing: "approved yesterday, data pending"
 *  is a better answer than an empty list. */
export const findAnnouncements = (query: string): Announcement[] => {
  const q = query.trim().toLowerCase();
  if (q.length < 4) return [];
  return getAnnouncements(60).filter(
    (a) =>
      a.names.some((n) => n.includes(q) || q.includes(n)) ||
      a.title.toLowerCase().includes(q),
  );
};
