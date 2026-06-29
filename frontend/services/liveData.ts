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

// Absolute URL so the native app (a different origin) reaches the live data.
// GitHub Pages serves these with `Access-Control-Allow-Origin: *`.
const REMOTE_BASE = 'https://bg48-sa.github.io/pharmatrack/data/';
const TIMEOUT_MS = 5000;

const fetchJson = async (file: string): Promise<any | null> => {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const res = await fetch(REMOTE_BASE + file, { signal: ctrl.signal, cache: 'no-store' });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null; // offline / blocked / timeout -> keep the bundled fallback
  }
};

let done = false;
/** True once a refresh attempt has completed (whether or not anything updated). */
export const liveDataAttempted = (): boolean => done;

/**
 * Fetch all snapshots in parallel and apply each one that succeeds. Resolves to
 * the number of snapshots that were refreshed (0 = everything fell back to the
 * bundled copy). Never throws.
 */
export const refreshLiveData = async (): Promise<number> => {
  const [ema, novel, critical, pdufa, cgt] = await Promise.all([
    fetchJson('ema-medicines.json'),
    fetchJson('novel-approvals.json'),
    fetchJson('critical-medicines.json'),
    fetchJson('pdufa.json'),
    fetchJson('cgt-products.json'),
  ]);

  let updated = 0;
  if (ema) { __setEmaData(ema); __setFdaEmaData(ema); updated++; }
  if (novel) { __setNovelData(novel); updated++; }
  if (critical) { __setCriticalData(critical); updated++; }
  if (pdufa) { __setPdufaData(pdufa); updated++; }
  if (cgt) { __setCgtData(cgt); updated++; }

  done = true;
  if (import.meta.env.DEV) {
    console.log(`[liveData] refreshed ${updated}/5 snapshots from ${REMOTE_BASE}`);
  }
  return updated;
};
