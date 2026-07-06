/**
 * Home-screen widget snapshot.
 *
 * The DrugRadarWidget extension cannot read Capacitor Preferences directly
 * (they live in the app's own UserDefaults, which app extensions can't see).
 * We keep a small JSON snapshot of upcoming estimated EU decisions under the
 * Preferences key `dr_widget_snapshot`; the native AppDelegate mirrors it into
 * the shared App Group on launch/resign-active/background and asks WidgetKit
 * to reload timelines. The snapshot can only change while the app is in use,
 * so those hooks cover every update.
 */
import { pipeline, estimatedDecisionDate } from './emaService';
import { storeSet } from './storage';

const KEY = 'dr_widget_snapshot';
const MAX_ITEMS = 10; // the largest widget family renders 5

interface WidgetItem {
  drug: string;
  indication: string; // the watched indication that matched
  date: string; // estimated EC decision date, YYYY-MM-DD
}

/**
 * Upcoming estimated EC decisions for the watched indications, soonest first,
 * one row per drug. Unlike the notification scheduler this keeps decisions due
 * within the lead-days window — the widget should show a decision expected
 * tomorrow even though it's too late to schedule a reminder for it.
 */
export const computeWidgetItems = (terms: string[]): WidgetItem[] => {
  const today = new Date().toISOString().slice(0, 10);
  const seen = new Set<string>();
  const out: WidgetItem[] = [];

  for (const term of terms) {
    for (const m of pipeline(term, 'all')) {
      const date = estimatedDecisionDate(m.op);
      // Full dates only — the widget parses yyyy-MM-dd strictly.
      if (!date || date.length !== 10 || date < today) continue;
      if (seen.has(m.n)) continue;
      seen.add(m.n);
      out.push({ drug: m.n, indication: term, date });
    }
  }

  out.sort((a, b) => (a.date < b.date ? -1 : 1));
  return out.slice(0, MAX_ITEMS);
};

/** Persist the snapshot the widget renders. Best-effort — never throws. */
export const syncWidgetSnapshot = async (terms: string[]): Promise<void> => {
  try {
    const snapshot = {
      updated: new Date().toISOString().slice(0, 10),
      items: computeWidgetItems(terms),
    };
    await storeSet(KEY, JSON.stringify(snapshot));
  } catch {
    /* widget refresh is best-effort */
  }
};
