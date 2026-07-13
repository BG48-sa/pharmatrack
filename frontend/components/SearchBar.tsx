import React, { useEffect, useState } from 'react';
import { Search, X, Loader2, FileText, Activity, Pill, Bookmark } from 'lucide-react';
import {
  SavedSearch,
  getSavedSearches,
  addSavedSearch,
  removeSavedSearch,
} from '../services/savedSearches';

interface SearchBarProps {
  onSearch: (val: string) => void;
  onClear: () => void;
  isLoading: boolean;
  mode: 'europe' | 'novel' | 'approvals' | 'pipeline' | 'critical' | 'biomarker';
}

interface Chip {
  label: string;
  query: string;
  primary?: boolean;
}

const CHIPS: Record<SearchBarProps['mode'], Chip[]> = {
  europe: [
    { label: 'Cancer', query: 'cancer', primary: true },
    { label: 'Hematology', query: 'hematology' },
    { label: 'Cardiovascular', query: 'cardiovascular' },
    { label: 'Respiratory', query: 'respiratory' },
    { label: 'Metabolic', query: 'metabolic' },
    { label: 'Infectious', query: 'infectious' },
    { label: 'Autoimmune', query: 'autoimmune' },
    { label: 'Degenerative', query: 'degenerative' },
    { label: 'Ophthalmology', query: 'ophthalmology' },
    { label: 'Genetic', query: 'genetic' },
  ],
  novel: [
    { label: 'Oncology', query: 'cancer', primary: true },
    { label: 'Lung Cancer', query: 'lung' },
    { label: 'Angioedema', query: 'angioedema' },
    { label: 'Dry Eye', query: 'dry eye' },
  ],
  approvals: [
    { label: '351(k) Biosimilars', query: 'biosimilar', primary: true },
    { label: 'Generic', query: 'generic' },
    { label: 'Oncology', query: 'Antineoplastic' },
    { label: 'Antibodies', query: 'Monoclonal Antibody' },
    { label: 'Semaglutide', query: 'Semaglutide' },
  ],
  pipeline: [
    { label: 'Obesity', query: 'obesity', primary: true },
    { label: "Alzheimer's", query: "Alzheimer disease" },
    { label: 'Oncology', query: 'cancer' },
    { label: 'NASH', query: 'nonalcoholic steatohepatitis' },
  ],
  critical: [
    { label: 'Antibiotics', query: 'J - Antiinfectives', primary: true },
    { label: 'Oncology', query: 'L - Antineoplastic' },
    { label: 'Adrenaline', query: 'epinephrine' },
    { label: 'Insulin', query: 'insulin' },
    { label: 'Injectable', query: 'intravenous' },
  ],
  biomarker: [
    { label: 'EGFR', query: 'EGFR', primary: true },
    { label: 'PD-L1', query: 'PD-L1' },
    { label: 'HER2', query: 'HER2' },
    { label: 'BRCA', query: 'BRCA' },
    { label: 'BRAF', query: 'BRAF' },
    { label: 'ALK', query: 'ALK' },
  ],
};

const SearchBar: React.FC<SearchBarProps> = ({ onSearch, onClear, isLoading, mode }) => {
  const [localValue, setLocalValue] = useState('');
  const [saved, setSaved] = useState<SavedSearch[]>([]);

  useEffect(() => {
    getSavedSearches().then(setSaved);
  }, []);

  const savedHere = saved.filter((s) => s.tab === mode);
  const isSaved = (q: string) =>
    savedHere.some((s) => s.q.toLowerCase() === q.trim().toLowerCase());

  const toggleSave = () => {
    const q = localValue.trim();
    if (!q) return;
    const entry = { q, tab: mode };
    (isSaved(q) ? removeSavedSearch(entry) : addSavedSearch(entry)).then(setSaved);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (localValue.trim()) onSearch(localValue.trim());
  };

  const handleClear = () => {
    setLocalValue('');
    onClear();
  };

  const handleQuickSearch = (query: string) => {
    setLocalValue(query);
    onSearch(query);
  };

  const placeholder =
    mode === 'europe'
      ? 'Search EU medicines — disease, drug, INN…'
      : mode === 'pipeline'
      ? 'Search a drug or disease for trials…'
      : mode === 'novel'
      ? 'Filter novel approvals — drug, ingredient, use…'
      : mode === 'critical'
      ? 'Search critical medicines — substance, ATC, route…'
      : mode === 'biomarker'
      ? 'Search biomarker, gene, or drug — EGFR, PD-L1, olaparib…'
      : 'Search drug, ingredient, company, class…';

  return (
    <div className="w-full flex flex-col space-y-3">
      <form onSubmit={handleSubmit} action="." className="relative w-full">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          <Search className="h-5 w-5 text-slate-400" />
        </div>
        <input
          type="search"
          inputMode="search"
          enterKeyHint="search"
          className="block w-full pl-10 pr-10 py-2.5 bg-slate-100 border-transparent rounded-xl leading-5 text-slate-900 placeholder-slate-500 focus:outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent sm:text-sm transition-all"
          placeholder={placeholder}
          value={localValue}
          onChange={(e) => setLocalValue(e.target.value)}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck="false"
        />
        <div className="absolute inset-y-0 right-0 pr-2 flex items-center">
          {isLoading ? (
            <Loader2 className="h-5 w-5 text-blue-500 animate-spin mr-1" />
          ) : localValue ? (
            <>
              <button
                type="button"
                onClick={toggleSave}
                className={`p-1 ${isSaved(localValue) ? 'text-indigo-600' : 'text-slate-400 hover:text-indigo-600'}`}
                aria-label={isSaved(localValue) ? 'Remove saved search' : 'Save search'}
                title={isSaved(localValue) ? 'Remove saved search' : 'Save search'}
              >
                <Bookmark className="h-5 w-5" fill={isSaved(localValue) ? 'currentColor' : 'none'} />
              </button>
              <button type="button" onClick={handleClear} className="p-1 text-slate-400 hover:text-slate-600" aria-label="Clear search">
                <X className="h-5 w-5 bg-slate-200 rounded-full p-0.5 text-slate-500" />
              </button>
            </>
          ) : null}
        </div>
      </form>

      {/* Saved searches for this tab */}
      {savedHere.length > 0 && (
        <div className="flex space-x-2 overflow-x-auto pb-1 hide-scrollbar" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
          {savedHere.map((s) => (
            <div
              key={s.q}
              role="button"
              tabIndex={0}
              onClick={() => handleQuickSearch(s.q)}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && handleQuickSearch(s.q)}
              className="flex-shrink-0 inline-flex items-center pl-3 pr-1.5 py-1 rounded-lg text-xs font-semibold border bg-white text-indigo-700 border-indigo-200 active:bg-indigo-50 cursor-pointer"
            >
              <Bookmark size={12} className="mr-1.5" fill="currentColor" />
              <span className="max-w-[10rem] truncate">{s.q}</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  removeSavedSearch(s).then(setSaved);
                }}
                className="ml-1 p-0.5 text-indigo-300 hover:text-indigo-600"
                aria-label={`Delete saved search ${s.q}`}
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Quick Filters / Chips */}
      <div className="flex space-x-2 overflow-x-auto pb-1 hide-scrollbar" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
        {CHIPS[mode].map((chip) => (
          <button
            key={chip.label}
            type="button"
            onClick={() => handleQuickSearch(chip.query)}
            className={`flex-shrink-0 inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
              chip.primary
                ? 'bg-indigo-50 text-indigo-700 border-indigo-200 active:bg-indigo-100'
                : 'bg-slate-100 text-slate-700 border-slate-200 active:bg-slate-200'
            }`}
          >
            {chip.primary ? <FileText size={12} className="mr-1.5" /> : mode === 'pipeline' ? <Activity size={12} className="mr-1.5" /> : <Pill size={12} className="mr-1.5" />}
            {chip.label}
          </button>
        ))}
      </div>
    </div>
  );
};

export default SearchBar;
