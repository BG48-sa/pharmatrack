/**
 * Ask for an App Store rating at a good moment — after the reader has compared
 * labels a few times, never on first launch. iOS shows the system dialog at most
 * three times a year per app and decides itself whether to show it at all; the
 * app only signals a good moment. Web / PWA: no-op.
 */
import { Capacitor } from '@capacitor/core';

const KEY = 'appReview.v1';
const COMPARES_BEFORE_ASK = 3;
const RE_ASK_AFTER_MS = 120 * 24 * 3600 * 1000;

interface ReviewState { compares: number; askedAt: number }

const load = (): ReviewState => {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) { const s = JSON.parse(raw); return { compares: +s.compares || 0, askedAt: +s.askedAt || 0 }; }
  } catch { /* storage unavailable */ }
  return { compares: 0, askedAt: 0 };
};

/** Call once per successful two-label comparison. */
export const noteLabelCompare = async (): Promise<void> => {
  if (!Capacitor.isNativePlatform()) return;
  const st = load();
  st.compares += 1;
  const now = Date.now();
  const due = st.compares >= COMPARES_BEFORE_ASK && now - st.askedAt > RE_ASK_AFTER_MS;
  if (due) st.askedAt = now;
  try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* ignore */ }
  if (!due) return;
  try {
    const { InAppReview } = await import('@capacitor-community/in-app-review');
    await InAppReview.requestReview();
  } catch { /* never let a rating prompt break the app */ }
};
