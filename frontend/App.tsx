import React, { useState, useEffect, useMemo } from 'react';
import { fetchRecentDrugApprovals, searchDrugDatabase } from './services/fdaService';
import { getUpcomingPdufa } from './services/pdufa';
import { searchTrials, TrialRegion } from './services/clinicalTrials';
import { DrugDataResponse, Trial, DrugDetailData } from './types';
import DrugList from './components/DrugList';
import PdufaList from './components/PdufaList';
import TrialList from './components/TrialList';
import NovelList from './components/NovelList';
import EuropeView from './components/EuropeView';
import CriticalList from './components/CriticalList';
import DrugDetail from './components/DrugDetail';
import Loader from './components/Loader';
import SourceList from './components/SourceList';
import SearchBar from './components/SearchBar';
import InstallButton from './components/InstallButton';
import { Stethoscope, AlertCircle, RefreshCw, Database, FlaskConical, Sparkles, Globe2, ShieldPlus } from 'lucide-react';

type View = 'europe' | 'novel' | 'approvals' | 'pipeline' | 'critical';

const LAST_VISIT_KEY = 'pt_last_visit';

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

  const pdufa = useMemo(() => getUpcomingPdufa(), []);

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
      <header className="bg-white/80 backdrop-blur-xl border-b border-slate-200 sticky top-0 z-20 pt-[env(safe-area-inset-top)]">
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
            <button className={tabClass(view === 'critical')} onClick={() => setView('critical')}>
              <ShieldPlus size={14} /> Critical
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
      </header>

      <main className="flex-grow w-full max-w-md mx-auto sm:max-w-xl pt-4">
        {view === 'europe' ? (
          <EuropeView query={europeQuery} onSelect={setDetail} lastVisitISO={lastVisit} onSearchTrials={handleViewTrials} />
        ) : view === 'critical' ? (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <CriticalList query={criticalQuery} onSearchTrials={handleViewTrials} />
          </div>
        ) : view === 'novel' ? (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <NovelList query={novelQuery} onSelect={setDetail} />
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
              </div>
              <DrugList drugs={activeData.drugs} onSelect={setDetail} />
              {activeData.drugs.length > 0 && <SourceList sources={activeData.sources} />}
            </div>
          ) : null
        ) : (
          /* Pipeline view */
          <div>
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
      </main>

      <footer className="w-full max-w-md mx-auto sm:max-w-xl px-4 pt-5 pb-8 mt-2 border-t border-slate-200">
        <p className="text-[11px] leading-relaxed text-slate-400">
          <span className="font-semibold text-slate-500">For informational purposes only.</span>{' '}
          DrugRadar aggregates public FDA, EMA, and ClinicalTrials.gov data, which may be
          incomplete or delayed. It is not medical advice and is not a substitute for
          professional medical judgment or official regulatory sources. Verify against the
          primary source before relying on any entry.
        </p>
        <a
          href="privacy.html"
          className="inline-block mt-2 text-[11px] font-medium text-slate-400 underline decoration-slate-300 underline-offset-2"
        >
          Privacy &amp; full disclaimer
        </a>
      </footer>

      {detail && (
        <DrugDetail data={detail} onClose={() => setDetail(null)} onViewTrials={handleViewTrials} />
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
