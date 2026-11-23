// Rate-limit handling for EMA's PDF server (www.ema.europa.eu, CloudFront).
//
// EMA answers "429 Too Many Requests" once a client has used its allowance.
// On 16. and 23.11.2026 the weekly label refresh spent that allowance on
// optional cross-check HEADs, waited fixed 5-minute pauses that did not help,
// and stopped before it had fetched the labels EMA itself had marked as
// changed. These helpers are the pacing rules extract-all.mjs follows instead:
//   * when EMA names a waiting time (Retry-After) it is respected,
//   * otherwise each refusal in a row doubles the wait (with jitter, so that
//     retries never fall into a fixed rhythm),
//   * and the gap between ordinary requests widens after a refusal and narrows
//     again slowly once EMA answers.
// Pure functions, no network — covered by tests/smpc-refresh.test.mjs.

/** Codes that mean "EMA is refusing us for now" (not: the document is missing or broken). */
export const isBlock = (code) => ['429', '403', '503'].includes(String(code));

/**
 * Waiting time EMA asked for, in ms, from a raw HTTP header block (several
 * responses when curl followed redirects — the last one counts). Retry-After
 * is either a number of seconds or an HTTP date. null when absent/unreadable.
 */
export function parseRetryAfter(headers, now = Date.now()) {
  const all = [...String(headers || '').matchAll(/^retry-after:[ \t]*(.+?)[ \t]*\r?$/gim)];
  if (!all.length) return null;
  const v = all[all.length - 1][1];
  if (/^\d+$/.test(v)) return parseInt(v, 10) * 1000;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : Math.max(0, t - now);
}

/**
 * Exponential backoff with jitter: refusal 1 waits about `base`, each further
 * refusal in a row doubles it up to `cap`; the result is spread ±25 % around
 * that value.
 */
export function backoffMs(streak, { base = 30000, cap = 10 * 60000, rand = Math.random } = {}) {
  const centre = Math.min(cap, base * 2 ** Math.max(0, streak - 1));
  return Math.round(centre * (0.75 + 0.5 * rand()));
}

/**
 * How long to wait after a refusal: EMA's own Retry-After when it sent one
 * (never longer than `retryAfterCap`, plus a little jitter), else backoffMs().
 */
export function waitMs(retryAfter, streak, { retryAfterCap = 15 * 60000, rand = Math.random, ...backoff } = {}) {
  if (retryAfter != null) return Math.round(Math.min(retryAfterCap, retryAfter) + 1000 * rand());
  return backoffMs(streak, { ...backoff, rand });
}

/**
 * Gap between two ordinary requests. Starts at `min`; a refusal doubles it (up
 * to `max`), every answered request brings it 20 % back towards `min`.
 */
export function createPacer({ min = 800, max = 15000, rand = Math.random } = {}) {
  let gap = min;
  return {
    next: (factor = 1) => Math.round(factor * gap * (1 + 0.4 * rand())),
    blocked: () => { gap = Math.min(max, gap * 2); },
    ok: () => { gap = Math.max(min, gap * 0.8); },
    get gap() { return gap; },
  };
}
