import { Trial } from '../types';

/**
 * Pipeline view backed by the public ClinicalTrials.gov v2 API (no key, CORS
 * enabled). This is a proxy for "what's progressing toward approval" — it
 * surfaces late-stage interventional drug trials, not PDUFA dates.
 */
const API = 'https://clinicaltrials.gov/api/v2/studies';

const prettyPhase = (phases?: string[]): string => {
  if (!phases || phases.length === 0) return 'N/A';
  return phases
    .map((p) => p.replace('PHASE', 'Phase ').replace('EARLY_', 'Early '))
    .join('/');
};

const prettyStatus = (s?: string): string =>
  (s || '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());

// Region filtering for the pipeline. ClinicalTrials.gov is a global registry,
// so we constrain by the trial's location country via an Essie AREA query on
// the LocationCountry field. 'EU' is the EU/EEA set plus the UK and
// Switzerland — the practical "Europe" footprint for drug pipelines.
export type TrialRegion = 'US' | 'EU';

const EU_COUNTRIES = [
  'Austria', 'Belgium', 'Bulgaria', 'Croatia', 'Cyprus', 'Czechia',
  'Denmark', 'Estonia', 'Finland', 'France', 'Germany', 'Greece',
  'Hungary', 'Iceland', 'Ireland', 'Italy', 'Latvia', 'Liechtenstein',
  'Lithuania', 'Luxembourg', 'Malta', 'Netherlands', 'Norway', 'Poland',
  'Portugal', 'Romania', 'Slovakia', 'Slovenia', 'Spain', 'Sweden',
  'Switzerland', 'United Kingdom',
];

const locationFilter = (region: TrialRegion): string =>
  region === 'US'
    ? 'AREA[LocationCountry]United States'
    : `AREA[LocationCountry](${EU_COUNTRIES.join(' OR ')})`;

// ClinicalTrials.gov v2 only applies the relevance threshold to `query.*` terms
// when results are ranked by relevance. The moment you ask for a date sort (or
// an aggFilter), it drops that threshold and returns loosely-matched studies
// ordered by date — which is why a "Parkinson" search used to surface the most
// recently-updated breast-cancer trials instead. So we sort by @relevance on
// the wire (keeping the term filter strict) and re-order by recency in JS.

// `allPhases` drops the Phase-3 filter so a disease/drug with no active
// late-stage trial still surfaces its earlier-phase studies, rather than a
// dead-end empty screen. The default stays Phase 3 (the "pipeline" signal).
export const searchTrials = async (
  query: string,
  allPhases = false,
  region: TrialRegion = 'US',
): Promise<Trial[]> => {
  const q = query.trim();
  if (!q) return [];

  // Phase + location go into the structured `filter.advanced` (Essie AREA
  // expressions), NOT `query.locn`/`aggFilters` — those weakened term matching.
  const advanced = [locationFilter(region)];
  if (!allPhases) advanced.unshift('AREA[Phase]PHASE3'); // late-stage only

  const params = new URLSearchParams({
    'query.term': q,
    'filter.advanced': advanced.join(' AND '),
    'filter.overallStatus': 'RECRUITING,ACTIVE_NOT_RECRUITING,ENROLLING_BY_INVITATION',
    'sort': '@relevance', // keep the term filter strict; re-sort by date below
    'pageSize': '25',
  });

  const res = await fetch(`${API}?${params.toString()}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`ClinicalTrials.gov request failed (${res.status}).`);

  const json = await res.json();
  const studies: any[] = json.studies || [];

  const trials = studies.map((s): Trial => {
    const ps = s.protocolSection || {};
    const id = ps.identificationModule || {};
    const status = ps.statusModule || {};
    const design = ps.designModule || {};
    const cond = ps.conditionsModule || {};
    const sponsor = ps.sponsorCollaboratorsModule || {};
    const nctId = id.nctId || '';
    return {
      nctId,
      title: id.briefTitle || id.officialTitle || 'Untitled study',
      status: prettyStatus(status.overallStatus),
      phase: prettyPhase(design.phases),
      conditions: cond.conditions || [],
      sponsor: sponsor.leadSponsor?.name || '—',
      startDate: status.startDateStruct?.date,
      completionDate: status.primaryCompletionDateStruct?.date,
      url: nctId ? `https://clinicaltrials.gov/study/${nctId}` : 'https://clinicaltrials.gov',
    };
  });

  // Keep the server's @relevance order: it puts the genuine matches first.
  // Re-sorting by date here would pull weakly-matched, recently-updated trials
  // (e.g. an unrelated oncology study) back to the top — the original bug.
  return trials;
};
