// Label files (data/smpc|uspi/<slug>.json) bound to the applied data release.
// Kept free of app-service imports: services/usLabels.ts (used by fdaService)
// loads label files, and liveData.ts imports fdaService — importing liveData
// from there would close an import cycle.

const REMOTE_BASE = 'https://bg48-sa.github.io/pharmatrack/data/';

export const sha256 = async (text: string): Promise<string> => {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

/**
 * Load one extracted label file and check it against the hash the applied
 * release's index records for it. A copy that does not match (a different
 * deploy, a stale cache — e.g. the label set bundled with an older app build) is
 * retried straight from the live site for that release; if that still differs,
 * the label is returned anyway, marked unverified — verification never hides a
 * label. Shared by the label compare panel and the US cards.
 */
export const loadLabelFile = async <T extends object>(corpus: 'smpc' | 'uspi', slug: string, expectedSha?: string, releaseId?: string): Promise<(T & { verified?: boolean }) | null> => {
  const path = `${corpus}/${slug}.json`;
  const urls = [`${import.meta.env.BASE_URL}data/${path}`, `${REMOTE_BASE}${path}${expectedSha ? `?r=${encodeURIComponent(releaseId || '')}` : ''}`];
  let fallback: (T & { verified?: boolean }) | null = null;
  for (const url of urls) {
    try {
      const r = await fetch(url, expectedSha ? { cache: 'no-cache' } : undefined);
      if (!r.ok) continue;
      const text = await r.text();
      const doc = JSON.parse(text) as T;
      if (!expectedSha) return doc;
      if ((await sha256(text)) === expectedSha) return { ...doc, verified: true };
      fallback = fallback || { ...doc, verified: false };
    } catch { /* next */ }
  }
  return fallback;
};
