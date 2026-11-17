import { useEffect } from 'react';

/**
 * ONE scroll lock for the whole app, counted.
 *
 * Every sheet and panel (disclaimer, welcome tour, medicine detail, compare,
 * label compare, glossary, alerts) must stop the page behind it from scrolling.
 * Until 17.11.2026 each of them did that on its own: remember the body's style,
 * change it, put the remembered value back on close. Two of them open at once
 * and closed in the other order left the page locked for good — the disclaimer
 * (shown again with every new version) and the welcome tour did exactly that:
 * the tour remembered "locked" from the disclaimer and restored it after the
 * disclaimer had already unlocked. The page could then not be scrolled at all.
 *
 * Here the first holder pins the page and the LAST one to let go releases it,
 * in whatever order they close. The page is pinned with position:fixed at its
 * current offset — on iOS (WKWebView) `overflow:hidden` on <body> does not stop
 * the page drifting behind a sheet — and the scroll position is put back on release.
 */
let holders = 0;
let saved: { y: number; position: string; top: string; width: string } | null = null;

export function lockScroll(): () => void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return () => {};
  const body = document.body;
  if (holders === 0) {
    saved = { y: window.scrollY, position: body.style.position, top: body.style.top, width: body.style.width };
    body.style.position = 'fixed';
    body.style.top = `-${saved.y}px`;
    body.style.width = '100%';
  }
  holders += 1;
  let released = false;
  return () => {
    if (released) return; // a holder can let go only once
    released = true;
    holders -= 1;
    if (holders > 0 || !saved) return;
    body.style.position = saved.position;
    body.style.top = saved.top;
    body.style.width = saved.width;
    window.scrollTo(0, saved.y);
    saved = null;
  };
}

/** Is the page currently pinned by at least one sheet or panel? */
export const scrollLocked = (): boolean => holders > 0;

/** Pin the page while the calling component is mounted (and `active`). */
export function useScrollLock(active: boolean = true): void {
  useEffect(() => (active ? lockScroll() : undefined), [active]);
}
