/**
 * Spotlight deep-link consumer.
 *
 * The native side indexes the EU catalogue into CoreSpotlight
 * (SpotlightIndexer.swift). When the user taps a result, AppDelegate writes
 * the drug name to the Preferences key `dr_spotlight_open`; the web app
 * consumes it here on mount and whenever it returns to the foreground, and
 * opens the matching drug's detail sheet. The payload carries a timestamp so
 * a stale leftover key is ignored.
 */
import { Capacitor } from '@capacitor/core';
import { storeGet, storeRemove } from './storage';

const KEY = 'dr_spotlight_open';
const MAX_AGE_MS = 5 * 60_000; // taps older than this are stale leftovers

/** The drug name from a pending Spotlight tap, or null. Consumes the key. */
export const consumeSpotlightOpen = async (): Promise<string | null> => {
  if (!Capacitor.isNativePlatform()) return null;
  const raw = await storeGet(KEY);
  if (!raw) return null;
  await storeRemove(KEY);
  try {
    const { name, ts } = JSON.parse(raw);
    if (typeof name !== 'string' || !name) return null;
    if (ts && Date.now() - new Date(ts).getTime() > MAX_AGE_MS) return null;
    return name;
  } catch {
    return null;
  }
};
