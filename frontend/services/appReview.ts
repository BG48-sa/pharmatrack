/**
 * Ask for an App Store rating at a good moment — after the reader has really
 * used the app, at a natural pause, never on the first day. iOS shows the system
 * dialog at most three times a year per app and decides itself whether to show
 * it at all; the app only signals a good moment. Web / PWA: no-op.
 *
 * 2.0.7 counted label comparisons only (three, then every 120 days) — too rare
 * for a tool most people browse rather than compare (Grok review 9.11.2026: no
 * new rating since launch week). Now every real use scores: a label comparison
 * or a PDF export 3 points, a medicine's detail sheet read and closed 1 point.
 * The app asks once 9 points are reached (three comparisons as before, or nine
 * medicines looked up, or a mix), not on the first day of use, and not again
 * within 120 days.
 */
import { Capacitor } from '@capacitor/core';

const KEY = 'appReview.v1';
export type UseKind = 'compare' | 'pdf' | 'detail';
const WEIGHT: Record<UseKind, number> = { compare: 3, pdf: 3, detail: 1 };
export const POINTS_BEFORE_ASK = 9;
export const RE_ASK_AFTER_MS = 120 * 24 * 3600 * 1000;

export interface ReviewState { points: number; askedAt: number; firstDay: string }

const day = (t: number): string => new Date(t).toISOString().slice(0, 10);

/** Stored state → current shape (2.0.7 stored `{ compares, askedAt }`). */
export const migrate = (raw: unknown, now: number): ReviewState => {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const points = Number.isFinite(+(s.points as number)) ? +(s.points as number) : (+(s.compares as number) || 0) * WEIGHT.compare;
  return { points: Math.max(0, points), askedAt: +(s.askedAt as number) || 0, firstDay: typeof s.firstDay === 'string' && s.firstDay ? s.firstDay : day(now) };
};

/** Pure decision: the state after this use, and whether now is the moment to ask. */
export const decide = (state: ReviewState, kind: UseKind, now: number): { state: ReviewState; ask: boolean } => {
  const next = { ...state, points: state.points + WEIGHT[kind] };
  const ask = next.points >= POINTS_BEFORE_ASK && day(now) !== next.firstDay && now - next.askedAt > RE_ASK_AFTER_MS;
  if (ask) next.askedAt = now;
  return { state: next, ask };
};

const load = (now: number): ReviewState => {
  try { return migrate(JSON.parse(localStorage.getItem(KEY) || 'null'), now); } catch { return migrate(null, now); }
};

/**
 * Call at a natural pause after a real use: a two-label comparison has rendered,
 * a PDF was saved, a detail sheet was closed.
 */
export const noteUse = async (kind: UseKind): Promise<void> => {
  if (!Capacitor.isNativePlatform()) return;
  const now = Date.now();
  const { state, ask } = decide(load(now), kind, now);
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ }
  if (!ask) return;
  try {
    const { InAppReview } = await import('@capacitor-community/in-app-review');
    await InAppReview.requestReview();
  } catch { /* never let a rating prompt break the app */ }
};

/** Call once per successful two-label comparison. */
export const noteLabelCompare = (): Promise<void> => noteUse('compare');
