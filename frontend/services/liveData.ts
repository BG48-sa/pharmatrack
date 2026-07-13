/**
 * Runtime data source.
 *
 * The Europe / Novel / Critical / PDUFA tabs and the EMA-enrichment of the FDA
 * tab are driven by JSON snapshots that are *bundled* into the build. In the
 * native (App Store) app those bundles are frozen until a new build is reviewed
 * and released, so the weekly data refresh never reaches native users.
 *
 * This module fixes that: at startup it fetches the freshest published copy of
 * each snapshot from the live site and swaps it into the services. If the fetch
 * fails (offline, first launch, site down) the bundled copy is kept, so the app
 * always works. Only DATA (JSON) is fetched here — never code — which keeps it
 * within Apple's App Store guidelines.
 *
 * The published copies live at <REMOTE_BASE>/<file>; they are emitted by the
 * `copy-data` build step (package.json) into public/data/ and deployed with the
 * PWA, and refreshed weekly by refresh-data.sh.
 */
import { __setEmaData } from './emaService';
import { __setNovelData } from './novelApprovals';
import { __setCriticalData } from './criticalMedicines';
import { __setPdufaData } from './pdufa';
import { __setFdaEmaData, __setCgtData } from './fdaService';
import { __setDiseaseData } from './diseaseEntities';
import { __setBiomarkerData } from './biomarkers';
import { storeGet, storeSet } from './storage';

// Absolute URL so the native app (a different origin) reaches the live data.
// GitHub Pages serves these with `Access-Control-Allow-Origin: *`.
const REMOTE_BASE = 'https://bg48-sa.github.io/pharmatrack/data/';
const TIMEOUT_MS = 5000;

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

/**
 * Fetch all snapshots in parallel and apply each one that succeeds. Resolves to
 * the number of snapshots that were refreshed (0 = everything fell back to the
 * bundled copy). Never throws.
 */
export const refreshLiveData = async (): Promise<number> => {
  const [ema, novel, critical, pdufa, cgt, disease, biomarker] = await Promise.all([
    fetchJson('ema-medicines.json'),
    fetchJson('novel-approvals.json'),
    fetchJson('critical-medicines.json'),
    fetchJson('pdufa.json'),
    fetchJson('cgt-products.json'),
    fetchJson('disease-entities.json'),
    fetchJson('biomarkers.json'),
  ]);

  let updated = 0;
  if (ema) { __setEmaData(ema); __setFdaEmaData(ema); updated++; }
  if (novel) { __setNovelData(novel); updated++; }
  if (critical) { __setCriticalData(critical); updated++; }
  if (pdufa) { __setPdufaData(pdufa); updated++; }
  if (cgt) { __setCgtData(cgt); updated++; }
  if (disease) { __setDiseaseData(disease); updated++; }
  if (biomarker) { __setBiomarkerData(biomarker); updated++; }

  done = true;
  if (updated > 0) {
    lastRefreshISO = new Date().toISOString();
    storeSet(LAST_REFRESH_KEY, lastRefreshISO);
  }
  if (import.meta.env.DEV) {
    console.log(`[liveData] refreshed ${updated}/7 snapshots from ${REMOTE_BASE}`);
  }
  return updated;
};
