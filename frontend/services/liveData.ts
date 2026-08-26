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

const fetchJson = async (file: string): Promise<any | null> => {
  const url = REMOTE_BASE + file;
  // 1) Network first, but with a revalidating cache mode ('no-cache') so the
  //    response is written to the on-device HTTP cache for offline reuse below.
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-cache' });
    clearTimeout(timer);
    if (res.ok) return await res.json();
  } catch {
    /* offline / blocked / timeout -> try the cached copy below */
  }
  // 2) Offline: serve the last successfully-fetched copy from the HTTP cache,
  //    which is fresher than the build-time bundle. If nothing is cached the
  //    caller keeps the bundled snapshot, so the app always has data.
  try {
    const res = await fetch(url, { cache: 'force-cache' });
    if (res.ok) return await res.json();
  } catch {
    /* nothing cached -> bundled fallback */
  }
  return null;
};

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
export const refreshLiveData = async (): Promise<number> => {
  // The shipped copies must be in place first, so a slow local read can never
  // overwrite a fresher live snapshot afterwards.
  await primeBundledData();
  const updated = await applySnapshots(fetchJson);

  done = true;
  if (updated > 0) {
    lastRefreshISO = new Date().toISOString();
    storeSet(LAST_REFRESH_KEY, lastRefreshISO);
  }
  if (import.meta.env.DEV) {
    console.log(`[liveData] refreshed ${updated}/${SNAPSHOTS.length} snapshots from ${REMOTE_BASE}`);
  }
  return updated;
};
