import React, { useMemo, useState } from 'react';
import {
  filterCritical,
  groupByCategory,
  criticalCategories,
  criticalVersion,
  criticalGeneratedDate,
  criticalCount,
  catCode,
  catLabel,
} from '../services/criticalMedicines';
import { ShieldPlus, Syringe, CalendarClock } from 'lucide-react';

interface Props {
  query: string;
  /** Jump to the Trials tab, pre-searched for a substance. */
  onSearchTrials: (query: string) => void;
}

const fmt = (iso: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { year: 'numeric', month: 'short' });
};

// Distinct accent colour per ATC main group, so the long list stays scannable.
const CAT_COLORS: Record<string, string> = {
  A: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  B: 'bg-rose-50 text-rose-700 border-rose-200',
  C: 'bg-red-50 text-red-700 border-red-200',
  G: 'bg-pink-50 text-pink-700 border-pink-200',
  H: 'bg-amber-50 text-amber-700 border-amber-200',
  J: 'bg-blue-50 text-blue-700 border-blue-200',
  L: 'bg-purple-50 text-purple-700 border-purple-200',
  M: 'bg-orange-50 text-orange-700 border-orange-200',
  N: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  P: 'bg-lime-50 text-lime-700 border-lime-200',
  R: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  S: 'bg-teal-50 text-teal-700 border-teal-200',
  V: 'bg-slate-100 text-slate-600 border-slate-200',
};
const catColor = (cat: string): string => CAT_COLORS[catCode(cat)] || CAT_COLORS.V;

const MedCard: React.FC<{
  atc5: string;
  n: string;
  route: string;
  d: string | null;
  onSearchTrials: () => void;
}> = ({ atc5, n, route, d, onSearchTrials }) => (
  <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4">
    <div className="flex justify-between items-start gap-3">
      <div className="min-w-0">
        <h3 className="font-bold text-slate-900 text-base leading-tight">{n}</h3>
        <span className="inline-block mt-1 font-mono text-[11px] text-slate-500 bg-slate-100 rounded px-1.5 py-0.5">
          {atc5}
        </span>
      </div>
      <div className="text-right shrink-0">
        <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Listed</div>
        <div className="text-sm font-bold text-blue-700 leading-none mt-0.5">{fmt(d)}</div>
      </div>
    </div>
    {route && (
      <div className="flex items-start text-[12px] text-slate-600 mt-2">
        <Syringe size={13} className="mr-1.5 mt-0.5 text-slate-400 shrink-0" />
        <span className="capitalize">{route}</span>
      </div>
    )}
    <button
      onClick={onSearchTrials}
      className="mt-2.5 text-[12px] font-semibold text-indigo-600 active:text-indigo-800"
    >
      Find clinical trials →
    </button>
  </div>
);

const CriticalList: React.FC<Props> = ({ query, onSearchTrials }) => {
  const [category, setCategory] = useState<string | 'all'>('all');
  const cats = useMemo(() => criticalCategories(), []);

  const results = useMemo(() => filterCritical(query, category), [query, category]);
  const grouped = useMemo(() => groupByCategory(results), [results]);
  // If the active category filter hides every match, offer to clear it.
  const totalForQuery = useMemo(() => filterCritical(query, 'all').length, [query]);

  const chip = (active: boolean) =>
    `flex-shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
      active ? 'bg-blue-600 text-white border-blue-600' : 'bg-slate-100 text-slate-700 border-slate-200 active:bg-slate-200'
    }`;

  return (
    <div className="px-4">
      <div className="flex items-start text-[11px] text-slate-500 leading-relaxed mb-3">
        <ShieldPlus size={13} className="mr-1.5 mt-0.5 text-blue-600 shrink-0" />
        <span>
          The EMA <strong>Union list of critical medicines</strong> — {criticalCount()} active
          substances whose continued supply is essential for EU health systems. Version{' '}
          {criticalVersion()}, {fmt(criticalGeneratedDate())}.
        </span>
      </div>

      {/* ATC main-group filter chips */}
      <div className="flex gap-2 overflow-x-auto pb-1 mb-3 hide-scrollbar" style={{ scrollbarWidth: 'none' }}>
        <button onClick={() => setCategory('all')} className={chip(category === 'all')}>
          All
        </button>
        {cats.map((c) => (
          <button key={c} onClick={() => setCategory(c)} className={chip(category === c)} title={catLabel(c)}>
            {catCode(c)} · {catLabel(c)}
          </button>
        ))}
      </div>

      {results.length === 0 ? (
        <div className="text-center py-10 px-6">
          <div className="bg-slate-100 w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3">
            <CalendarClock className="text-slate-400 w-7 h-7" />
          </div>
          <p className="text-slate-700 text-sm font-semibold">
            {query.trim() ? `No critical medicine matches “${query.trim()}”.` : 'No medicines in this group.'}
          </p>
          {category !== 'all' && totalForQuery > 0 && (
            <button
              onClick={() => setCategory('all')}
              className="mt-4 w-full max-w-xs mx-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-amber-100 text-amber-800 active:bg-amber-200"
            >
              Clear filter — {totalForQuery} match{totalForQuery === 1 ? '' : 'es'} in other groups
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500">
          {grouped.map(({ cat, items }) => (
            <div key={cat}>
              <div className={`inline-flex items-center px-2.5 py-1 rounded-lg border text-[11px] font-bold uppercase tracking-wide mb-2 ${catColor(cat)}`}>
                {catCode(cat)} — {catLabel(cat)} · {items.length}
              </div>
              <div className="space-y-3">
                {items.map((m) => (
                  <MedCard
                    key={m.atc5}
                    atc5={m.atc5}
                    n={m.n}
                    route={m.route}
                    d={m.d}
                    onSearchTrials={() => onSearchTrials(m.n)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default CriticalList;
