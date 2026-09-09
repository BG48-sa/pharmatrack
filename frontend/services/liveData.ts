/**
 * Runtime data source.
 *
 * The Europe / Novel / Critical / PDUFA tabs and the EMA-enrichment of the FDA
 * tab are driven by JSON snapshots that ship WITH the build as static files in
 * public/data/ (emitted by the `copy-data` build step) — they are no longer
 * inlined into the JS bundle, which keeps the first script payload small.
 *
 * Two tiers, applied in order:
 *   1. primeBundledData() — fetch the local shipped copies (same-origin /data/,
 *      part of dist/ and of the native app bundle), so the app always has data,
 *      even offline on first launch.
 *   2. refreshLiveData() — fetch the freshest published copies from the live
 *      site and swap them in. In the native (App Store) app the shipped files
 *      are frozen until a new build is reviewed, so this is what keeps native
 *      users current. Only DATA (JSON) is fetched here — never code — which
 *      keeps it within Apple's App Store guidelines.
 *
 * The published copies live at <REMOTE_BASE>/<file>, deployed with the PWA and
 * refreshed weekly by refresh-data.sh.
 */
import { __setEmaData } from './emaService';
import { __setNovelData } from './novelApprovals';
import { __setCriticalData } from './criticalMedicines';
import { __setPdufaData } from './pdufa';
import { __setFdaEmaData, __setCgtData } from './fdaService';
import { __setDiseaseData } from './diseaseEntities';
import { __setBiomarkerData } from './biomarkers';
import { __setCdxData } from './companionDx';
import { __setAnnouncementsData } from './announcements';
import { storeGet, storeSet } from './storage';

// Absolute URL so the native app (a different origin) reaches the live data.
// GitHub Pages serves these with `Access-Control-Allow-Origin: *`.
const REMOTE_BASE = 'https://bg48-sa.github.io/pharmatrack/data/';
// Shipped copies: same-origin static files (dist/data/, in the native bundle).
const LOCAL_BASE = `${import.meta.env.BASE_URL}data/`;
const TIMEOUT_MS = 5000;

const localJson = async (file: string): Promise<any | null> => {
  try {
    const res = await fetch(LOCAL_BASE + file);
    if (res.ok) return await res.json();
  } catch {
    /* shipped snapshot missing — services keep their empty initial state */
  }
  return null;
};

// Number of snapshots that came from the network (not a cache) in the current
// refresh — only those may move the 'last refresh' timestamp.
let freshHits = 0;

// --- Data freshness status (for the Alerts panel's offline indicator) ---
const LAST_REFRESH_KEY = 'dr_last_refresh';
let lastRefreshISO: string | null = null;

/** ISO timestamp of the last refresh that updated at least one snapshot. */
export const getLastRefresh = (): string | null => lastRefreshISO;

// Load any persisted timestamp up front so the UI can show it before/without a
// fresh refresh (e.g. when launched offline).
storeGet(LAST_REFRESH_KEY).then((v) => {
  if (v && !lastRefreshISO) lastRefreshISO = v;
});

let done = false;
/** True once a refresh attempt has completed (whether or not anything updated). */
export const liveDataAttempted = (): boolean => done;

// One entry per snapshot: file name + the setter(s) that apply it.
const SNAPSHOTS: Array<[string, (d: any) => void]> = [
  ['ema-medicines.json', (d) => { __setEmaData(d); __setFdaEmaData(d); }],
  ['novel-approvals.json', __setNovelData],
  ['critical-medicines.json', __setCriticalData],
  ['pdufa.json', __setPdufaData],
  ['cgt-products.json', __setCgtData],
  ['disease-entities.json', __setDiseaseData],
  ['biomarkers.json', __setBiomarkerData],
  ['fda-cdx.json', __setCdxData],
  ['announcements.json', __setAnnouncementsData],
];

// Fetch all snapshots in parallel via `get` and apply each one that succeeds.
const applySnapshots = async (get: (file: string) => Promise<any | null>): Promise<number> => {
  const results = await Promise.all(SNAPSHOTS.map(([file]) => get(file)));
  let updated = 0;
  results.forEach((d, i) => { if (d) { SNAPSHOTS[i][1](d); updated++; } });
  return updated;
};

let primed: Promise<number> | null = null;

/**
 * Load the snapshots shipped with the build (public/data/) into the services.
 * Single-flight: safe to call from several places; the work runs once. Resolves
 * to the number of snapshots applied. Never throws.
 */
export const primeBundledData = (): Promise<number> => (primed ??= applySnapshots(localJson));

/**
 * Fetch all snapshots in parallel from the live site and apply each one that
 * succeeds. Resolves to the number of snapshots that were refreshed (0 =
 * everything kept the shipped copy). Never throws.
 */
export const sha256 = async (text: string): Promise<string> => {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

// The last COMPLETE, hash-verified release is kept in its own cache so that a
// failed or partial download never degrades the app to a mixed set: the app
// either moves to the new release as a whole or stays on the last verified one.
const RELEASE_CACHE = 'dr-verified-release';
const RELEASE_KEY = 'dr_release';
let releaseInfo: { id: string; generated: string } | null = null;
/** Identity of the data release currently applied (id + ISO timestamp), if known. */
export const getReleaseInfo = (): { id: string; generated: string } | null => releaseInfo;
storeGet(RELEASE_KEY).then((v) => { if (v && !releaseInfo) { try { releaseInfo = JSON.parse(v); } catch { /* ignore */ } } });

// The full manifest of that release (it also names the hash of each label
// index, which in turn names the hash of every label file — see loadLabelIndex).
const MANIFEST_KEY = 'dr_release_manifest';
let releaseManifest: any | null = null;
export const getReleaseManifest = (): any | null => releaseManifest;
storeGet(MANIFEST_KEY).then((v) => { if (v && !releaseManifest) { try { releaseManifest = JSON.parse(v); } catch { /* ignore */ } } });

export interface LabelIndex {
  drugs: Record<string, { brand?: string; inn?: string; sha?: string; match?: 'brand' | 'substance'; usGeneric?: string | null }>;
  generated?: string;
  /** Id of the data release that published this index. */
  release?: string;
  /** true = hash matches the applied release's manifest; false = it does not (a different deploy); null = no manifest to check against. */
  verified: boolean | null;
}

/**
 * Load a label index (which medicines have an extracted SmPC / US label, with
 * the SHA-256 of each file) and bind it to the applied data release: when the
 * release manifest names the index hash, a copy that does not match is fetched
 * once more straight from the live site for that release id. Verification never
 * hides labels — a mismatch is reported, not fatal.
 */
export const loadLabelIndex = async (corpus: 'smpc' | 'uspi'): Promise<LabelIndex | null> => {
  const file = `${corpus}-index.json`;
  const expected: string | undefined = releaseManifest?.labels?.[corpus]?.sha256;
  const get = async (url: string): Promise<string | null> => {
    try { const r = await fetch(url, { cache: 'no-cache' }); return r.ok ? await r.text() : null; } catch { return null; }
  };
  let text = await get(`${import.meta.env.BASE_URL}data/${file}`);
  let verified: boolean | null = null;
  if (expected) {
    verified = !!text && (await sha256(text)) === expected;
    if (!verified) {
      const again = await get(`${REMOTE_BASE}${file}?r=${encodeURIComponent(releaseManifest?.id || '')}`);
      if (again && (await sha256(again)) === expected) { text = again; verified = true; }
    }
  }
  if (!text) return null;
  try {
    const idx = JSON.parse(text);
    if (!idx?.drugs) return null;
    return { drugs: idx.drugs, generated: idx.generated, release: idx.release, verified };
  } catch { return null; }
};

const fetchText = async (file: string): Promise<string | null> => {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const res = await fetch(REMOTE_BASE + file, { signal: ctrl.signal, cache: 'no-cache' });
    clearTimeout(timer);
    if (!res.ok) return null;
    const text = await res.text();
    freshHits++;
    return text;
  } catch { return null; }
};

// Download manifest + every snapshot from the network and verify the set.
const fetchVerifiedRelease = async (): Promise<{ manifest: any; texts: Record<string, string> } | null> => {
  const manifestText = await fetchText('release.json');
  if (!manifestText) return null;
  let manifest: { id?: string; generated?: string; files?: Record<string, string> };
  try { manifest = JSON.parse(manifestText); } catch { return null; }
  const want = manifest.files || {};
  const list = await Promise.all(SNAPSHOTS.map(([file]) => fetchText(file)));
  const texts: Record<string, string> = {};
  for (let i = 0; i < SNAPSHOTS.length; i++) {
    const file = SNAPSHOTS[i][0];
    const text = list[i];
    if (!text || !want[file] || (await sha256(text)) !== want[file]) {
      if (import.meta.env.DEV) console.warn(`[liveData] release rejected: ${file} missing or hash mismatch`);
      return null;
    }
    texts[file] = text;
  }
  texts['release.json'] = manifestText;
  return { manifest, texts };
};

const storeVerifiedRelease = async (texts: Record<string, string>): Promise<void> => {
  try {
    const cache = await caches.open(RELEASE_CACHE);
    await Promise.all(Object.entries(texts).map(([file, text]) =>
      cache.put(REMOTE_BASE + file, new Response(text, { headers: { 'Content-Type': 'application/json' } }))));
  } catch { /* Cache Storage unavailable (private mode) — the release still applies for this session */ }
};

const loadStoredRelease = async (): Promise<Record<string, string> | null> => {
  try {
    const cache = await caches.open(RELEASE_CACHE);
    const texts: Record<string, string> = {};
    for (const [file] of SNAPSHOTS) {
      const res = await cache.match(REMOTE_BASE + file);
      if (!res) return null;
      texts[file] = await res.text();
    }
    return texts;
  } catch { return null; }
};

const applyTexts = (texts: Record<string, string>): number => {
  const parsed: Record<string, any> = {};
  for (const [file] of SNAPSHOTS) {
    try { parsed[file] = JSON.parse(texts[file]); } catch { return 0; } // never apply a half-parsed set
  }
  SNAPSHOTS.forEach(([file, apply]) => apply(parsed[file]));
  return SNAPSHOTS.length;
};

export const refreshLiveData = async (): Promise<number> => {
  // The shipped copies must be in place first, so a slow local read can never
  // overwrite a fresher live snapshot afterwards.
  await primeBundledData();
  freshHits = 0;
  let updated = 0;
  const release = await fetchVerifiedRelease();
  if (release) {
    updated = applyTexts(release.texts);
    if (updated) {
      releaseInfo = { id: String(release.manifest.id || ''), generated: String(release.manifest.generated || '') };
      storeSet(RELEASE_KEY, JSON.stringify(releaseInfo));
      releaseManifest = release.manifest;
      storeSet(MANIFEST_KEY, JSON.stringify(release.manifest));
      storeVerifiedRelease(release.texts);
    }
  } else {
    // Network unavailable or the published set failed verification: stay on the
    // last complete verified release (from the release cache), otherwise on the
    // shipped snapshots. No file is ever applied on its own.
    const stored = await loadStoredRelease();
    if (stored) applyTexts(stored);
    freshHits = 0;
  }
  done = true;
  // A force-cache fallback (offline) must not pose as a fresh sync.
  if (updated > 0 && freshHits > 0) {
    lastRefreshISO = new Date().toISOString();
    storeSet(LAST_REFRESH_KEY, lastRefreshISO);
  }
  if (import.meta.env.DEV) {
    console.log(`[liveData] refreshed ${updated}/${SNAPSHOTS.length} snapshots from ${REMOTE_BASE}`);
  }
  return updated;
};
