/**
 * Indication-based local notifications.
 *
 * For each watched indication (e.g. "multiple myeloma"), we find EMA pipeline
 * medicines — those with a CHMP opinion adopted whose European Commission
 * decision is estimated ~67 days later — and schedule an on-device reminder a
 * few days before that estimated decision. This is genuinely native: the
 * notification is generated and delivered on the device, with no server.
 *
 * Re-syncing is idempotent: we cancel the set we scheduled last time (tracked in
 * on-device storage) and reschedule from the current watchlist + latest pipeline
 * snapshot, so newly-listed drugs in a watched area are picked up automatically.
 */
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { pipeline, estimatedDecisionDate } from './emaService';
import { storeGet, storeSet } from './storage';
import { syncWidgetSnapshot } from './widget';

const SCHEDULED_IDS_KEY = 'dr_scheduled_ids';
const REMINDER_HOUR = 9; // local time on the reminder day
const LEAD_DAYS = 3; // remind this many days before the estimated decision
const MAX_NOTIFS = 30; // stay well under the iOS 64-pending-notification limit

/** Local notifications are only scheduled on the native (iOS) build. */
export const notificationsSupported = (): boolean => Capacitor.isNativePlatform();

export type PermState = 'granted' | 'denied' | 'prompt';

export const getPermission = async (): Promise<PermState> => {
  if (!notificationsSupported()) return 'denied';
  try {
    const r = await LocalNotifications.checkPermissions();
    return (r.display as PermState) ?? 'prompt';
  } catch {
    return 'denied';
  }
};

export const requestPermission = async (): Promise<boolean> => {
  if (!notificationsSupported()) return false;
  try {
    const r = await LocalNotifications.requestPermissions();
    return r.display === 'granted';
  } catch {
    return false;
  }
};

export interface UpcomingDecision {
  drug: string;
  inn: string;
  term: string; // the watched indication that matched
  decisionISO: string; // estimated EC decision date (YYYY-MM-DD)
  notifyAt: Date; // when the reminder fires
}

const fmtDate = (iso: string): string => {
  const d = new Date(iso.length === 7 ? `${iso}-01` : iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' });
};

// Stable 31-bit positive id from a string, so re-syncing the same drug/term/date
// reuses the same notification id (iOS ids must be 32-bit signed ints).
const hashId = (s: string): number => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 2_147_483_647;
};

/**
 * The reminders that *would* be scheduled for the given indications — future
 * ones only, soonest first, capped. Pure/synchronous, so the UI can preview it.
 */
export const computeUpcoming = (terms: string[]): UpcomingDecision[] => {
  const now = Date.now();
  const seen = new Set<string>();
  const out: UpcomingDecision[] = [];

  for (const term of terms) {
    for (const m of pipeline(term, 'all')) {
      const decisionISO = estimatedDecisionDate(m.op);
      if (!decisionISO) continue;

      const notifyAt = new Date(`${decisionISO}T00:00:00`);
      if (isNaN(notifyAt.getTime())) continue;
      notifyAt.setDate(notifyAt.getDate() - LEAD_DAYS);
      notifyAt.setHours(REMINDER_HOUR, 0, 0, 0);
      if (notifyAt.getTime() <= now) continue; // can't schedule in the past

      const key = `${term.toLowerCase()}::${m.n}`;
      if (seen.has(key)) continue;
      seen.add(key);

      out.push({ drug: m.n, inn: m.inn || m.sub || '', term, decisionISO, notifyAt });
    }
  }

  out.sort((a, b) => a.notifyAt.getTime() - b.notifyAt.getTime());
  return out.slice(0, MAX_NOTIFS);
};

/**
 * Reconcile scheduled notifications with the current watchlist. Cancels the
 * previously-scheduled set, then schedules fresh reminders. Returns the number
 * scheduled. No-op (returns 0) on the web build. Never throws.
 */
export const syncIndicationAlerts = async (terms: string[]): Promise<number> => {
  if (!notificationsSupported()) return 0;
  // Keep the home-screen widget's snapshot in step with the watchlist —
  // independent of notification permission, which may be denied.
  void syncWidgetSnapshot(terms);
  try {
    // Cancel what we scheduled last time so counts/dates stay in sync.
    const prevRaw = await storeGet(SCHEDULED_IDS_KEY);
    const prevIds: number[] = prevRaw ? JSON.parse(prevRaw) : [];
    if (Array.isArray(prevIds) && prevIds.length) {
      await LocalNotifications.cancel({ notifications: prevIds.map((id) => ({ id })) });
    }

    const upcoming = computeUpcoming(terms);
    const notifications = upcoming.map((u) => ({
      id: hashId(`${u.term.toLowerCase()}::${u.drug}::${u.decisionISO}`),
      title: 'EU decision expected',
      body: `${u.drug}${u.inn ? ` (${u.inn})` : ''} — EU decision on ${u.term} expected around ${fmtDate(
        u.decisionISO
      )}.`,
      schedule: { at: u.notifyAt, allowWhileIdle: true },
    }));

    if (notifications.length) {
      await LocalNotifications.schedule({ notifications });
    }
    await storeSet(SCHEDULED_IDS_KEY, JSON.stringify(notifications.map((n) => n.id)));
    return notifications.length;
  } catch {
    return 0;
  }
};
