import { useEffect, useState } from 'react';

/**
 * Subscribe to a CSS media query. Used to switch between the phone modal detail
 * and the iPad two-pane layout at run time (not just via CSS), so scroll-locking
 * and pane rendering can differ by form factor.
 */
export const useMediaQuery = (query: string): boolean => {
  const get = () =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false;

  const [matches, setMatches] = useState<boolean>(get);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
};
