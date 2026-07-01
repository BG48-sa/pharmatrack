/**
 * Small on-device key/value store.
 *
 * Uses Capacitor Preferences (native UserDefaults on iOS, localStorage on the
 * web build) with a localStorage fallback so a plugin error never loses data.
 * Everything is stringified by the caller. All calls are best-effort and never
 * throw — callers treat a miss the same as "nothing stored yet".
 */
import { Preferences } from '@capacitor/preferences';

export const storeGet = async (key: string): Promise<string | null> => {
  try {
    const { value } = await Preferences.get({ key });
    if (value != null) return value;
  } catch {
    /* fall through to localStorage */
  }
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

export const storeSet = async (key: string, value: string): Promise<void> => {
  try {
    await Preferences.set({ key, value });
  } catch {
    /* ignore — try localStorage too */
  }
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
};

export const storeRemove = async (key: string): Promise<void> => {
  try {
    await Preferences.remove({ key });
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
};
