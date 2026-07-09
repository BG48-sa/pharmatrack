import React, { useState, useEffect, useMemo } from 'react';
import { fetchRecentDrugApprovals, searchDrugDatabase } from './services/fdaService';
import { getUpcomingPdufa } from './services/pdufa';
import { refreshLiveData } from './services/liveData';
import { searchTrials, TrialRegion } from './services/clinicalTrials';
import { DrugDataResponse, Trial, DrugDetailData } from './types';
import DrugList from './components/DrugList';
import PdufaList from './components/PdufaList';
import TrialList from './components/TrialList';
import NovelList from './components/NovelList';
import EuropeView from './components/EuropeView';
import CriticalList from './components/CriticalList';
import DrugDetail, { DrugDetailContent } from './components/DrugDetail';
import AlertsPanel from './components/AlertsPanel';
import GlossaryModal from './components/GlossaryModal';
import LabelComparePanel, { LabelColumn } from './components/LabelComparePanel';
import DisclaimerGate from './components/DisclaimerGate';
import WelcomeGuide from './components/WelcomeGuide';
import ComparePanel from './components/ComparePanel';
import Loader from './components/Loader';
import SourceList from './components/SourceList';
import SearchBar from './components/SearchBar';
import InstallButton from './components/InstallButton';
import { getWatched, setWatched as persistWatched } from './services/watchlist';
import { syncIndicationAlerts } from './services/notifications';
import { consumeSpotlightOpen } from './services/spotlight';
import { recentApprovals, approvalToDetail } from './services/emaService';
import { drugKey } from './services/notes';
import { storeGet, storeSet } from './services/storage';
import { useMediaQuery } from './services/useMediaQuery';
import { Stethoscope, AlertCircle, RefreshCw, Database, FlaskConical, Sparkles, Globe2, ShieldPlus, Bell, BookOpen, GitCompare, Pill, X, FileText, ExternalLink, HelpCircle, ArrowLeft } from 'lucide-react';

// EMA product slug behind a compared drug (only EU-tab medicines carry emaUrl).
const smpcSlug = (d: DrugDetailData): string => (d.emaUrl || '').split('/EPAR/')[1]?.trim() || '';

type View = 'europe' | 'novel' | 'approvals' | 'pipeline' | 'critical';

const LAST_VISIT_KEY = 'pt_last_visit';

// Bump GUIDE_VERSION to re-show the feature guide after a major release.
const GUIDE_KEY = 'dr_welcome_seen';
const GUIDE_VERSION = '2026-07-09';

export default function App() {
  const [view, setView] = useState<View>('europe');

  // --- Europe (EMA) state (client-side filter over the bundled EMA snapshot) ---
  const [europeQuery, setEuropeQuery] = useState<string>('');
  // Timestamp of the user's previous visit, captured once before we overwrite it,
  // so the Europe tab can flag medicines authorised since they last looked.
  const [lastVisit] = useState<string | null>(() => {
    try {
      const prev = localStorage.getItem(LAST_VISIT_KEY);
      localStorage.setItem(LAST_VISIT_KEY, new Date().toISOString());
      return prev;
    } catch {
      return null;
    }
  });

  // --- Novel approvals state (client-side filter over a bundled FDA snapshot) ---
  const [novelQuery, setNovelQuery] = useState<string>('');

  // --- Critical medicines state (client-side filter over bundled EMA snapshot) ---
  const [criticalQuery, setCriticalQuery] = useState<string>('');

  // --- Drug detail sheet (opened from any Novel/Approvals card) ---
  const [detail, setDetail] = useState<DrugDetailData | null>(null);

  // --- Decision alerts: watched indications drive on-device reminders ---
  const [alertsOpen, setAlertsOpen] = useState<boolean>(false);

  // Feature guide: auto-shown on first install and again after each version
  // bump (it renders below the disclaimer gate, so accepting the disclaimer
  // reveals it), and reopenable any time from the header help button.
  const [guideOpen, setGuideOpen] = useState<boolean>(false);
  useEffect(() => {
    storeGet(GUIDE_KEY).then((v) => {
      if (v !== GUIDE_VERSION) setGuideOpen(true);
    });
  }, []);
  const closeGuide = () => {
    storeSet(GUIDE_KEY, GUIDE_VERSION);
    setGuideOpen(false);
  };
  const [watched, setWatched] = useState<string[]>([]);

  // --- Glossary (opened from the header or from a tapped badge) ---
  const [glossaryId, setGlossaryId] = useState<string | undefined>(undefined);
  const [glossaryOpen, setGlossaryOpen] = useState<boolean>(false);
  const openGlossary = (id?: string) => {
    setGlossaryId(id);
    setGlossaryOpen(true);
  };

  // --- Compare tray: up to two drugs, side-by-side ---
  const [compare, setCompare] = useState<DrugDetailData[]>([]);
  const [compareOpen, setCompareOpen] = useState<boolean>(false);

  // --- Full-text label comparison (SmPC / USPI) ---
  const [smpcOpen, setSmpcOpen] = useState<boolean>(false);
  // Manifests of medicines with extracted EU SmPC / US label data (slug -> present).
  const [smpcIndex, setSmpcIndex] = useState<Record<string, unknown>>({});
  const [uspiIndex, setUspiIndex] = useState<Record<string, unknown>>({});
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/smpc-index.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((idx) => idx?.drugs && setSmpcIndex(idx.drugs))
      .catch(() => {});
    fetch(`${import.meta.env.BASE_URL}data/uspi-index.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((idx) => idx?.drugs && setUspiIndex(idx.drugs))
      .catch(() => {});
  }, []);
  const hasEuLabel = (s: string) => !!(s && smpcIndex[s]);
  const hasUsLabel = (s: string) => !!(s && uspiIndex[s]);
  const labelAvailable = (s: string, src: 'eu' | 'us') => (src === 'eu' ? hasEuLabel(s) : hasUsLabel(s));
  // Reverse index: active substance (INN) -> a bundled label slug, preferring a
  // slug that has BOTH an EU SmPC and a US label (so the EU/US toggle works).
  // Lets any drug be matched to its label by substance, regardless of which tab
  // it came from (US/Novel-tab drugs carry no EPAR URL to derive a slug from).
  const innToSlug = useMemo(() => {
    const idx: Record<string, string> = {};
    const consider = (slug: string, inn: unknown, both: boolean) => {
      const key = String(inn || '').toLowerCase().trim();
      if (key && (!idx[key] || both)) idx[key] = slug;
    };
    for (const [slug, info] of Object.entries(smpcIndex)) consider(slug, (info as { inn?: string }).inn, !!uspiIndex[slug]);
    for (const [slug, info] of Object.entries(uspiIndex)) if (!smpcIndex[slug]) consider(slug, (info as { inn?: string }).inn, false);
    return idx;
  }, [smpcIndex, uspiIndex]);
  // Best label slug for a drug: the EPAR-derived slug if it maps to a bundled
  // label, else matched by active substance (handles salts, e.g. "ponatinib
  // hydrochloride" → ponatinib).
  const labelSlug = (d: DrugDetailData): string => {
    const s = smpcSlug(d);
    if (s && (smpcIndex[s] || uspiIndex[s])) return s;
    const gn = (d.genericName || '').toLowerCase().trim();
    return innToSlug[gn] || innToSlug[gn.split(/[\s,]/)[0]] || '';
  };
  // Full-label comparison of the two tray drugs — available once both resolve to
  // a bundled label in at least one jurisdiction (each column can then toggle EU/US).
  const compareSlugs = compare.map(labelSlug);
  const labelReady = compare.length === 2 && compareSlugs.every((s) => hasEuLabel(s) || hasUsLabel(s));
  const trayColumns: LabelColumn[] = compareSlugs.map((s) => ({ slug: s, source: hasEuLabel(s) ? 'eu' : 'us' }));
  // Same-molecule EU-vs-US comparison, opened from a medicine's detail.
  const [euUsSlug, setEuUsSlug] = useState<string | null>(null);
  const euUsAvailable = (d: DrugDetailData) => {
    const s = labelSlug(d);
    return !!(s && smpcIndex[s] && uspiIndex[s]);
  };
  const inCompare = (d: DrugDetailData) => compare.some((x) => drugKey(x) === drugKey(d));
  const toggleCompare = (d: DrugDetailData) => {
    const k = drugKey(d);
    setCompare((prev) => {
      if (prev.some((x) => drugKey(x) === k)) return prev.filter((x) => drugKey(x) !== k);
      if (prev.length >= 2) return [prev[1], d]; // keep the most recent, drop the oldest
      return [...prev, d];
    });
  };
  const removeFromCompare = (k: string) =>
    setCompare((prev) => prev.filter((x) => drugKey(x) !== k));

  // iPad / wide-screen: show the detail in a persistent right pane instead of a
  // modal. 800px matches the `pad:` Tailwind breakpoint (iPad portrait = 820pt).
  const isWide = useMediaQuery('(min-width: 800px)');

  // Load the saved watchlist once, then schedule its reminders.
  useEffect(() => {
    getWatched().then((w) => {
      setWatched(w);
      syncIndicationAlerts(w);
    });
  }, []);

  // Spotlight deep link: the native side leaves the tapped drug's name in a
  // Preferences key (see services/spotlight.ts). Check it on mount (cold
  // launch) and whenever the app returns to the foreground (warm resume),
  // and open the matching EU medicine's detail sheet.
  useEffect(() => {
    const check = () =>
      consumeSpotlightOpen().then((name) => {
        if (!name) return;
        const hits = recentApprovals(name, 'all', 5);
        const m =
          hits.find((x) => x.n.toLowerCase() === name.toLowerCase()) || hits[0];
        if (m) setDetail(approvalToDetail(m));
      });
    check();
    const onVisible = () => document.visibilityState === 'visible' && check();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  // Persist + reschedule whenever the user edits the watchlist.
  const updateWatched = (next: string[]) => {
    persistWatched(next).then((clean) => {
      setWatched(clean);
      syncIndicationAlerts(clean);
    });
  };

  // --- Approvals state ---
  const [defaultData, setDefaultData] = useState<DrugDataResponse | null>(null);
  const [searchData, setSearchData] = useState<DrugDataResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchLoading, setSearchLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isSearchMode, setIsSearchMode] = useState<boolean>(false);
  const [currentQuery, setCurrentQuery] = useState<string>('');

  // --- Pipeline state ---
  const [trials, setTrials] = useState<Trial[]>([]);
  const [trialLoading, setTrialLoading] = useState<boolean>(false);
  const [trialError, setTrialError] = useState<string | null>(null);
  const [trialQuery, setTrialQuery] = useState<string>('');
  const [trialSearched, setTrialSearched] = useState<boolean>(false);
  const [trialAllPhases, setTrialAllPhases] = useState<boolean>(false);
  const [trialRegion, setTrialRegion] = useState<TrialRegion>('US');
  // When we jump into the Trials tab from a drug's detail sheet, remember that
  // drug so we can offer a one-tap way back instead of stranding the user.
  const [trialOrigin, setTrialOrigin] = useState<DrugDetailData | null>(null);

  // Bumped once the runtime data refresh lands, so views recompute over the
  // fresher snapshots (bundled data renders first; this swaps in live data).
  const [dataVersion, setDataVersion] = useState(0);

  const pdufa = useMemo(() => getUpcomingPdufa(), [dataVersion]);

  // Switching top-level tabs should always land you at the top of the new view.
  // Without this, jumping from a drug (scrolled far down a list) into the Trials
  // tab left the page stranded mid-scroll with no obvious way back up.
  useEffect(() => {
    window.scrollTo(0, 0);
    // Drop the "back to drug" breadcrumb once we leave the Trials tab.
    if (view !== 'pipeline') setTrialOrigin(null);
  }, [view]);

  // When fresher EMA data lands, reschedule reminders — the pipeline may now
  // include new drugs in a watched indication.
  useEffect(() => {
    if (dataVersion > 0 && watched.length) syncIndicationAlerts(watched);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataVersion]);

  const loadDefaultData = async () => {
    setLoading(true);
    setError(null);
    try {
      setDefaultData(await fetchRecentDrugApprovals());
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDefaultData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pull the freshest published snapshots once at startup. Bundled data shows
  // immediately; if live data arrives, bump dataVersion so every tab recomputes
  // and re-enrich the FDA approvals with the fresher EMA dates.
  useEffect(() => {
    let cancelled = false;
    refreshLiveData().then((updated) => {
      if (cancelled || updated === 0) return;
      setDataVersion((v) => v + 1);
      if (!isSearchMode) loadDefaultData();
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDrugSearch = async (query: string) => {
    setSearchLoading(true);
    setIsSearchMode(true);
    setCurrentQuery(query);
    setError(null);
    try {
      setSearchData(await searchDrugDatabase(query));
    } catch (err: any) {
      setError(err.message || 'Search failed.');
      setSearchData(null);
    } finally {
      setSearchLoading(false);
    }
  };

  const handleTrialSearch = async (query: string, allPhases = false, region: TrialRegion = trialRegion) => {
    setTrialLoading(true);
    setTrialSearched(true);
    setTrialQuery(query);
    setTrialAllPhases(allPhases);
    setTrialRegion(region);
    setTrialError(null);
    try {
      setTrials(await searchTrials(query, allPhases, region));
    } catch (err: any) {
      setTrialError(err.message || 'Search failed.');
      setTrials([]);
    } finally {
      setTrialLoading(false);
    }
  };

  // Switching region re-runs the current query against the other geography.
  const handleRegionChange = (region: TrialRegion) => {
    if (region === trialRegion) return;
    if (trialSearched && trialQuery) handleTrialSearch(trialQuery, trialAllPhases, region);
    else setTrialRegion(region);
  };

  // Cross-link from a drug detail sheet into the Pipeline tab, pre-searched.
  const handleViewTrials = (query: string) => {
    setTrialOrigin(detail);
    setDetail(null);
    setView('pipeline');
    handleTrialSearch(query);
  };

  const handleSearch = (query: string) => {
    if (!query) return;
    if (view === 'europe') setEuropeQuery(query);
    else if (view === 'novel') setNovelQuery(query);
    else if (view === 'critical') setCriticalQuery(query);
    else if (view === 'pipeline') handleTrialSearch(query);
    else handleDrugSearch(query);
  };

  const handleClearSearch = () => {
    if (view === 'europe') {
      setEuropeQuery('');
    } else if (view === 'novel') {
      setNovelQuery('');
    } else if (view === 'critical') {
      setCriticalQuery('');
    } else if (view === 'pipeline') {
      setTrialSearched(false);
      setTrials([]);
      setTrialQuery('');
      setTrialError(null);
      setTrialAllPhases(false);
    } else {
      setIsSearchMode(false);
      setSearchData(null);
      setCurrentQuery('');
      setError(null);
    }
  };

  const activeData = isSearchMode ? searchData : defaultData;
  const approvalsLoading = loading || searchLoading;

  const tabClass = (active: boolean) =>
    `flex-1 flex items-center justify-center gap-1 py-1.5 px-0.5 text-xs font-semibold rounded-lg transition-colors ${
      active ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'
    }`;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans flex flex-col pb-[env(safe-area-inset-bottom)]">
      <DisclaimerGate />
      <header className="bg-white/80 backdrop-blur-xl border-b border-slate-200 sticky top-0 z-20 pt-[env(safe-area-inset-top)]">
        <div className="mx-auto w-full max-w-5xl">
        <div className="px-4 h-14 flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="bg-blue-600 p-1.5 rounded-lg text-white shadow-sm">
              <Stethoscope size={20} />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900 leading-none tracking-tight">DrugRadar</h1>
              <div className="flex items-center mt-0.5">
                <Database size={10} className="text-slate-400 mr-1" />
                <p className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">FDA + EMA Data</p>
              </div>
            </div>
          </div>
          <div className="flex items-center space-x-1">
            <button
              onClick={() => setGuideOpen(true)}
              className="p-2 text-slate-500 hover:text-blue-600 active:bg-slate-100 rounded-full transition-colors"
              aria-label="What you can do here"
            >
              <HelpCircle size={20} />
            </button>
            <button
              onClick={() => openGlossary()}
              className="p-2 text-slate-500 hover:text-blue-600 active:bg-slate-100 rounded-full transition-colors"
              aria-label="Glossary of regulatory terms"
            >
              <BookOpen size={20} />
            </button>
            <button
              onClick={() => setAlertsOpen(true)}
              className="relative p-2 text-slate-500 hover:text-indigo-600 active:bg-slate-100 rounded-full transition-colors"
              aria-label="Decision alerts"
            >
              <Bell size={20} />
              {watched.length > 0 && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-indigo-600 rounded-full ring-2 ring-white" />
              )}
            </button>
            <InstallButton />
            {view === 'approvals' && !approvalsLoading && !error && !isSearchMode && (
              <button
                onClick={loadDefaultData}
                className="p-2 text-slate-500 hover:text-blue-600 active:bg-slate-100 rounded-full transition-colors"
                aria-label="Refresh Data"
              >
                <RefreshCw size={20} />
              </button>
            )}
          </div>
        </div>

        {/* Segmented control: Europe | Novel | Approvals | Pipeline */}
        <div className="px-4 pt-1">
          <div className="flex bg-slate-100 rounded-xl p-1">
            <button className={tabClass(view === 'europe')} onClick={() => setView('europe')}>
              <Globe2 size={14} /> Europe
            </button>
            <button className={tabClass(view === 'novel')} onClick={() => setView('novel')}>
              <Sparkles size={14} /> Novel
            </button>
            <button className={tabClass(view === 'approvals')} onClick={() => setView('approvals')}>
              <Database size={14} /> US
            </button>
            <button className={tabClass(view === 'pipeline')} onClick={() => setView('pipeline')}>
              <FlaskConical size={14} /> Trials
            </button>
            <button className={tabClass(view === 'critical')} onClick={() => setView('critical')}>
              <ShieldPlus size={14} /> Critical
            </button>
          </div>
        </div>

        <div className="px-4 pb-2 pt-2">
          <SearchBar
            key={view}
            mode={view}
            onSearch={handleSearch}
            onClear={handleClearSearch}
            isLoading={view === 'pipeline' ? trialLoading : view === 'approvals' ? searchLoading : false}
          />
        </div>
        </div>
      </header>

      <main className="flex-grow w-full">
        <div className="mx-auto w-full max-w-5xl pad:px-4 pad:pt-4 pad:flex pad:gap-6 pad:items-start">
          <div className="w-full max-w-md mx-auto sm:max-w-xl pad:max-w-none pad:mx-0 pad:flex-1 pad:min-w-0 pt-4 pad:pt-0">
        {view === 'europe' ? (
          <EuropeView
            key={`eu-${dataVersion}`}
            query={europeQuery}
            onSelect={setDetail}
            lastVisitISO={lastVisit}
            onSearchTrials={handleViewTrials}
            watchedTerms={watched}
            onWatchIndication={(t) => updateWatched([...watched, t])}
          />
        ) : view === 'critical' ? (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <CriticalList key={`crit-${dataVersion}`} query={criticalQuery} onSearchTrials={handleViewTrials} />
          </div>
        ) : view === 'novel' ? (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <NovelList key={`novel-${dataVersion}`} query={novelQuery} onSelect={setDetail} />
          </div>
        ) : view === 'approvals' ? (
          approvalsLoading ? (
            <div className="mt-20">
              <Loader message={searchLoading ? `Searching FDA database for "${currentQuery}"...` : 'Loading recent FDA approvals...'} />
            </div>
          ) : error ? (
            <ErrorBox message={error} onRetry={isSearchMode ? () => handleDrugSearch(currentQuery) : loadDefaultData} />
          ) : activeData ? (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              {!isSearchMode && pdufa.length > 0 && <PdufaList entries={pdufa} />}
              <div className="px-4 mb-4">
                <h2 className="text-xl font-bold text-slate-800">{isSearchMode ? 'Search Results' : 'Recent Approvals'}</h2>
                <p className="text-slate-500 text-xs mt-1 leading-relaxed">
                  {isSearchMode
                    ? `Found ${activeData.drugs.length} approved drug(s) matching "${currentQuery}".`
                    : 'Recent FDA approvals with a classified drug class, live from openFDA with EMA authorisation dates. The very latest approvals can take weeks to appear here — see the Novel tab for the complete new-drug list. Search by drug, ingredient, company, disease/indication, or class — or tap 351(k) Biosimilars.'}
                </p>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-[11px] text-slate-500">
                  <span className="font-semibold text-slate-600">Official generics registers:</span>
                  <a href="https://www.fda.gov/drugs/drug-and-biologic-approval-and-ind-activity-reports/first-generic-drug-approvals" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-blue-600 active:text-blue-800 font-medium">
                    FDA First Generic Approvals <ExternalLink size={11} className="shrink-0" />
                  </a>
                  <a href="https://ec.europa.eu/health/documents/community-register/html/index_en.htm" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-blue-600 active:text-blue-800 font-medium">
                    EU Community Register <ExternalLink size={11} className="shrink-0" />
                  </a>
                </div>
              </div>
              <DrugList drugs={activeData.drugs} onSelect={setDetail} />
              {activeData.drugs.length > 0 && <SourceList sources={activeData.sources} />}
            </div>
          ) : null
        ) : (
          /* Pipeline view */
          <div>
            {trialOrigin && (
              <button
                onClick={() => setDetail(trialOrigin)}
                className="mx-4 mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-blue-600 active:text-blue-800"
              >
                <ArrowLeft size={16} /> Back to {trialOrigin.brandName}
              </button>
            )}
            <RegionToggle region={trialRegion} onChange={handleRegionChange} />
            {trialLoading ? (
            <div className="mt-20">
              <Loader message={`Searching ${trialRegion === 'US' ? 'U.S.' : 'European'} late-stage trials for "${trialQuery}"...`} />
            </div>
          ) : trialError ? (
            <ErrorBox message={trialError} onRetry={() => handleTrialSearch(trialQuery)} />
          ) : !trialSearched ? (
            <div className="text-center py-16 px-6">
              <div className="bg-indigo-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                <FlaskConical className="text-indigo-500 w-8 h-8" />
              </div>
              <h3 className="text-lg font-semibold text-slate-700 mb-1">Drug pipeline</h3>
              <p className="text-slate-500 text-sm leading-relaxed">
                Search a drug or disease to see active <span className="font-semibold">Phase 3</span> trials from ClinicalTrials.gov — a signal of what's progressing toward approval.
              </p>
            </div>
          ) : trials.length === 0 ? (
            <TrialEmpty
              query={trialQuery}
              allPhases={trialAllPhases}
              onShowAllPhases={() => handleTrialSearch(trialQuery, true)}
            />
          ) : (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="px-4 mb-4">
                <h2 className="text-xl font-bold text-slate-800">
                  Pipeline — {trialAllPhases ? 'All phases' : 'Phase 3'}
                </h2>
                <p className="text-slate-500 text-xs mt-1 leading-relaxed">
                  Found {trials.length} active {trialAllPhases ? '' : 'late-stage '}trial(s) in {trialRegion === 'US' ? 'the USA' : 'Europe'} for "{trialQuery}". Source: ClinicalTrials.gov.
                </p>
              </div>
              <TrialList trials={trials} />
            </div>
          )}
          </div>
        )}
          </div>

          {/* Wide screens (iPad landscape / desktop): persistent detail pane. */}
          {isWide && (
            <aside className="hidden pad:block w-[360px] xl:w-[380px] shrink-0 sticky top-[11.5rem] max-h-[calc(100vh-12.5rem)] overflow-y-auto pb-6">
              {detail ? (
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 relative">
                  <button
                    onClick={() => setDetail(null)}
                    className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 bg-slate-50 rounded-full z-10"
                    aria-label="Close detail"
                  >
                    <X size={18} />
                  </button>
                  <DrugDetailContent
                    data={detail}
                    onViewTrials={handleViewTrials}
                    onOpenGlossary={openGlossary}
                    onToggleCompare={toggleCompare}
                    inCompare={inCompare(detail)}
                    onCompareEuUs={euUsAvailable(detail) ? () => setEuUsSlug(labelSlug(detail)) : undefined}
                  />
                </div>
              ) : (
                <DetailPlaceholder />
              )}
            </aside>
          )}
        </div>
      </main>

      <footer className="w-full max-w-md mx-auto sm:max-w-xl pad:max-w-5xl px-4 pt-5 pb-8 mt-2 border-t border-slate-200">
        <p className="text-[11px] leading-relaxed text-slate-400">
          <span className="font-semibold text-slate-500">For informational purposes only — not medical advice.</span>{' '}
          DrugRadar is an independent project and is <span className="font-medium text-slate-500">not affiliated with, endorsed by, or verified by</span> the
          FDA, the EMA, or the U.S. National Library of Medicine. It aggregates public
          regulatory data (FDA, EMA, ClinicalTrials.gov) that may be incomplete, delayed,
          or inaccurate; estimated decision dates, auto-parsed indication details,
          on-device reminders, and exported calendar events are approximate — a calendar
          entry created from the app carries an estimated date that may change or never
          occur. Glossary entries, comparison views, and
          shared summaries are simplified, machine-generated aids. Full-text label sections
          are automatically extracted, abbreviated snapshots that may be truncated, contain
          extraction errors, or be out of date — the live linked EMA SmPC / FDA label is the
          only authoritative version. The EU SmPC and the US Prescribing Information are
          distinct legal documents that apply only in their own jurisdiction and are
          <span className="font-medium text-slate-500"> not interchangeable</span>.
          DrugRadar is <span className="font-medium text-slate-500">not a clinical decision-support tool</span> and
          is not a substitute for professional medical judgment or the official product
          information. Do not use it to diagnose, treat, prescribe, or make any dosing or
          clinical decision; always verify against the current official label first.
          Authorisation does not imply availability or reimbursement. Provided
          <span className="font-medium text-slate-500"> “as is”, without warranty of any kind</span>; to the maximum
          extent permitted by law the developer accepts no liability for any loss, injury,
          or damage arising from its use. You use it entirely at your own risk and remain
          solely responsible for all clinical decisions.
        </p>
        <a
          href="privacy.html"
          className="inline-block mt-2 text-[11px] font-medium text-slate-400 underline decoration-slate-300 underline-offset-2"
        >
          Privacy &amp; full disclaimer
        </a>
      </footer>

      {/* Compare tray — appears once at least one drug is selected for comparison. */}
      {compare.length > 0 && (
        <div className="fixed bottom-0 inset-x-0 z-40 px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 bg-gradient-to-t from-slate-900/10 to-transparent pointer-events-none">
          <div className="mx-auto w-full max-w-xl bg-white border border-slate-200 shadow-lg rounded-2xl p-2.5 flex items-center gap-2 pointer-events-auto">
            <GitCompare size={18} className="text-emerald-600 shrink-0 ml-1" />
            <div className="flex-1 min-w-0 flex gap-1.5">
              {compare.map((d) => (
                <span
                  key={drugKey(d)}
                  className="inline-flex items-center gap-1 bg-slate-100 rounded-lg px-2 py-1 text-xs font-semibold text-slate-700 min-w-0"
                >
                  <span className="truncate max-w-[7rem]">{d.brandName}</span>
                  <button onClick={() => removeFromCompare(drugKey(d))} aria-label={`Remove ${d.brandName}`}>
                    <X size={12} className="text-slate-400 hover:text-red-500" />
                  </button>
                </span>
              ))}
              {compare.length === 1 && (
                <span className="inline-flex items-center text-xs text-slate-400 px-1">Pick one more…</span>
              )}
            </div>
            {labelReady ? (
              <>
                {/* Regulatory snapshot is now secondary; the full-label
                    comparison is the prominent primary action. */}
                <button
                  onClick={() => setCompareOpen(true)}
                  className="shrink-0 px-3 py-2 rounded-xl text-sm font-semibold bg-white text-slate-600 border border-slate-200 active:bg-slate-50 transition-colors"
                  aria-label="Regulatory overview"
                >
                  Overview
                </button>
                <button
                  onClick={() => setSmpcOpen(true)}
                  className="shrink-0 inline-flex items-center gap-1 px-3.5 py-2 rounded-xl text-sm font-semibold bg-emerald-600 text-white active:bg-emerald-700 transition-colors"
                  aria-label="Compare full labels"
                >
                  <FileText size={15} /> Compare labels
                </button>
              </>
            ) : (
              <button
                onClick={() => setCompareOpen(true)}
                disabled={compare.length < 2}
                className="shrink-0 px-3.5 py-2 rounded-xl text-sm font-semibold bg-emerald-600 text-white active:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400 transition-colors"
              >
                Compare
              </button>
            )}
          </div>
        </div>
      )}

      {detail && (
        <DrugDetail
          data={detail}
          onClose={() => setDetail(null)}
          onViewTrials={handleViewTrials}
          onOpenGlossary={openGlossary}
          onToggleCompare={toggleCompare}
          inCompare={inCompare(detail)}
          onCompareEuUs={euUsAvailable(detail) ? () => setEuUsSlug(labelSlug(detail)) : undefined}
        />
      )}

      {alertsOpen && (
        <AlertsPanel
          watched={watched}
          onChange={updateWatched}
          onSelect={setDetail}
          onClose={() => setAlertsOpen(false)}
        />
      )}

      {glossaryOpen && (
        <GlossaryModal initialId={glossaryId} onClose={() => setGlossaryOpen(false)} />
      )}

      {guideOpen && (
        <WelcomeGuide
          onClose={closeGuide}
          onOpenAlerts={() => {
            closeGuide();
            setAlertsOpen(true);
          }}
          onOpenGlossary={() => {
            closeGuide();
            setGlossaryOpen(true);
          }}
        />
      )}
      {smpcOpen && labelReady && (
        <LabelComparePanel
          columns={trayColumns}
          available={labelAvailable}
          onClose={() => setSmpcOpen(false)}
        />
      )}
      {euUsSlug && (
        <LabelComparePanel
          columns={[
            { slug: euUsSlug, source: 'eu' },
            { slug: euUsSlug, source: 'us' },
          ] as LabelColumn[]}
          available={labelAvailable}
          onClose={() => setEuUsSlug(null)}
        />
      )}

      {compareOpen && compare.length >= 2 && (
        <ComparePanel items={compare} onClose={() => setCompareOpen(false)} onRemove={removeFromCompare} />
      )}
    </div>
  );
}

// USA vs Europe segmented control for the pipeline. ClinicalTrials.gov is a
// global registry; this scopes results to trials with a site in the chosen
// geography. Switching re-runs the active query (handled by the parent).
const RegionToggle: React.FC<{
  region: TrialRegion;
  onChange: (r: TrialRegion) => void;
}> = ({ region, onChange }) => {
  const opt = (active: boolean) =>
    `flex-1 flex items-center justify-center gap-1.5 py-1.5 text-sm font-semibold rounded-lg transition-colors ${
      active ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500'
    }`;
  return (
    <div className="px-4 pt-1 pb-3">
      <div className="flex bg-slate-100 rounded-xl p-1">
        <button className={opt(region === 'US')} onClick={() => onChange('US')}>
          🇺🇸 USA
        </button>
        <button className={opt(region === 'EU')} onClick={() => onChange('EU')}>
          🇪🇺 Europe
        </button>
      </div>
    </div>
  );
};

// An empty Phase-3 result is a signal, not a dead-end: many diseases/drugs have
// only earlier-phase active trials. Offer to broaden the search to all phases,
// plus a direct ClinicalTrials.gov link — mirroring the Europe tab's SmartEmpty.
const TrialEmpty: React.FC<{
  query: string;
  allPhases: boolean;
  onShowAllPhases: () => void;
}> = ({ query, allPhases, onShowAllPhases }) => {
  const q = query.trim();
  const btn =
    'w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors';
  return (
    <div className="text-center py-12 px-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="bg-slate-100 w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3">
        <FlaskConical className="text-slate-400 w-7 h-7" />
      </div>
      <p className="text-slate-700 text-sm font-semibold">
        {allPhases
          ? `No active trials match "${q}".`
          : `No active Phase 3 trials match "${q}".`}
      </p>
      <p className="text-slate-500 text-xs mt-1.5 leading-relaxed max-w-xs mx-auto">
        {allPhases
          ? 'This searches recruiting and active studies on ClinicalTrials.gov across all phases.'
          : 'There may be earlier-phase studies that haven’t reached Phase 3 yet.'}
      </p>
      <div className="mt-5 space-y-2 max-w-xs mx-auto">
        {!allPhases && (
          <button onClick={onShowAllPhases} className={`${btn} bg-indigo-600 text-white active:bg-indigo-700`}>
            <FlaskConical size={15} /> Search all phases for "{q}"
          </button>
        )}
        {q && (
          <a
            href={`https://clinicaltrials.gov/search?term=${encodeURIComponent(q)}`}
            target="_blank"
            rel="noopener noreferrer"
            className={`${btn} bg-slate-100 text-slate-700 active:bg-slate-200`}
          >
            Open on ClinicalTrials.gov →
          </a>
        )}
      </div>
    </div>
  );
};

// Empty state for the wide-screen detail pane before a drug is chosen.
const DetailPlaceholder: React.FC = () => (
  <div className="bg-white/60 rounded-2xl border border-dashed border-slate-200 p-8 text-center">
    <div className="bg-slate-100 w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3">
      <Pill className="text-slate-300 w-7 h-7" />
    </div>
    <p className="text-sm font-semibold text-slate-500">Select a medicine</p>
    <p className="text-xs text-slate-400 mt-1 leading-relaxed">
      Tap any entry to see its regulatory status, indication facts, your notes, and comparison options here.
    </p>
  </div>
);

const ErrorBox: React.FC<{ message: string; onRetry: () => void }> = ({ message, onRetry }) => (
  <div className="mx-4 mt-8 bg-red-50 border border-red-200 rounded-2xl p-6 flex flex-col items-center justify-center text-center space-y-4">
    <AlertCircle className="w-12 h-12 text-red-500" />
    <div>
      <h3 className="text-lg font-semibold text-red-800">Connection Error</h3>
      <p className="text-red-600 text-sm mt-1">{message}</p>
    </div>
    <button
      onClick={onRetry}
      className="mt-4 px-6 py-2.5 bg-red-600 active:bg-red-700 text-white rounded-xl font-medium transition-colors flex items-center space-x-2 shadow-sm"
    >
      <RefreshCw size={16} />
      <span>Try Again</span>
    </button>
  </div>
);
