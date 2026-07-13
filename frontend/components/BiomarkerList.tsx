import React, { useMemo, useState } from 'react';
import {
  allBiomarkers,
  findBiomarkers,
  buildBiomarkerComparison,
  BIOMARKER_GROUPS,
  Biomarker,
  BiomarkerGroup,
} from '../services/biomarkers';
import { Dna, FlaskConical, GitCompare, Search as SearchIcon } from 'lucide-react';

interface Props {
  query: string;
  /** Open the shared side-by-side compare for this biomarker's EU drugs. */
  onCompare: (m: Biomarker) => void;
}

// Distinct accent per alteration type, so the list stays scannable at a glance.
const TYPE_COLORS: Record<string, string> = {
  mutation: 'bg-purple-50 text-purple-700 border-purple-200',
  fusion: 'bg-blue-50 text-blue-700 border-blue-200',
  expression: 'bg-amber-50 text-amber-700 border-amber-200',
  signature: 'bg-teal-50 text-teal-700 border-teal-200',
  hla: 'bg-rose-50 text-rose-700 border-rose-200',
  enzyme: 'bg-rose-50 text-rose-700 border-rose-200',
};
const typeColor = (t: string): string => TYPE_COLORS[t] || 'bg-slate-100 text-slate-600 border-slate-200';

const BiomarkerCard: React.FC<{ m: Biomarker; onCompare: () => void }> = ({ m, onCompare }) => {
  // Only member drugs authorised in the EU can be compared (built from EMA data).
  const euCount = useMemo(() => buildBiomarkerComparison(m).length, [m]);
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4">
      <div className="flex items-start gap-3">
        <div className="p-2 bg-violet-100 rounded-xl text-violet-700 shrink-0">
          <Dna size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-bold text-slate-900 leading-tight">{m.name}</h3>
            <span className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-lg border text-[10px] font-bold uppercase tracking-wide ${typeColor(m.type)}`}>
              {m.type}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1">
            <span className="font-mono text-[11px] text-slate-600 bg-slate-100 rounded px-1.5 py-0.5">{m.gene}</span>
            <span className="text-[12px] text-slate-500">{m.alt}</span>
          </div>
          <p className="text-[12px] text-slate-600 mt-1.5">{m.context}</p>

          {/* EU test framing: method first (per SmPC), example CE-IVD assays after. */}
          <div className="mt-2.5 rounded-xl bg-violet-50/70 border border-violet-100 p-2.5">
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-violet-800 uppercase tracking-wide">
              <FlaskConical size={12} /> Validated test (per SmPC)
            </div>
            <p className="text-[13px] font-semibold text-slate-800 mt-1">{m.method}</p>
            <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">
              e.g. {m.assays.join(' · ')}
            </p>
          </div>

          {/* Drugs the biomarker result unlocks (EU brand names). */}
          <div className="mt-2.5">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
              Unlocks ({m.drugs.length})
            </div>
            <div className="flex flex-wrap gap-1.5">
              {m.drugs.map((d) => (
                <span
                  key={d.b}
                  title={d.g}
                  className="inline-flex items-center px-2 py-0.5 rounded-lg bg-white border border-violet-200 text-[11px] font-semibold text-slate-700"
                >
                  {d.b}
                </span>
              ))}
            </div>
          </div>

          {euCount >= 2 && (
            <button
              onClick={onCompare}
              className="mt-3 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-semibold bg-violet-600 text-white active:bg-violet-700 transition-colors"
            >
              <GitCompare size={15} /> Compare all {euCount} side by side
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

const BiomarkerList: React.FC<Props> = ({ query, onCompare }) => {
  const [group, setGroup] = useState<BiomarkerGroup | 'all'>('all');

  const q = query.trim();
  // A query searches the whole catalog; the group chips filter the browse view.
  const results = useMemo(() => {
    const base = q ? findBiomarkers(q) : allBiomarkers();
    return group === 'all' ? base : base.filter((m) => m.group === group);
  }, [q, group]);

  const grouped = useMemo(
    () =>
      BIOMARKER_GROUPS.map((g) => ({
        ...g,
        items: results.filter((m) => m.group === g.key),
      })).filter((g) => g.items.length > 0),
    [results],
  );

  const totalForQuery = useMemo(() => (q ? findBiomarkers(q).length : allBiomarkers().length), [q]);

  const chip = (active: boolean) =>
    `flex-shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
      active ? 'bg-violet-600 text-white border-violet-600' : 'bg-slate-100 text-slate-700 border-slate-200 active:bg-slate-200'
    }`;

  return (
    <div className="px-4">
      <div className="mb-3">
        <h2 className="text-xl font-bold text-slate-800">Biomarkers &amp; Companion Diagnostics</h2>
        <p className="text-[11px] text-slate-500 leading-relaxed mt-1">
          Actionable biomarkers and the EU-authorised medicines their result unlocks. In the EU, companion
          diagnostics are governed by the <strong>IVD Regulation</strong> (in force since May 2022): the SmPC
          requires a <strong>validated test</strong> for the biomarker — the assays shown are common CE-IVD
          examples, not the sole requirement. {allBiomarkers().length} biomarkers · EU brand names.
        </p>
      </div>

      {/* Group filter chips */}
      <div className="flex gap-2 overflow-x-auto pb-1 mb-3 hide-scrollbar" style={{ scrollbarWidth: 'none' }}>
        <button onClick={() => setGroup('all')} className={chip(group === 'all')}>
          All
        </button>
        {BIOMARKER_GROUPS.map((g) => (
          <button key={g.key} onClick={() => setGroup(g.key)} className={chip(group === g.key)}>
            {g.label}
          </button>
        ))}
      </div>

      {results.length === 0 ? (
        <div className="text-center py-10 px-6">
          <div className="bg-slate-100 w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3">
            <SearchIcon className="text-slate-400 w-7 h-7" />
          </div>
          <p className="text-slate-700 text-sm font-semibold">
            {q ? `No biomarker matches “${q}”.` : 'No biomarkers in this group.'}
          </p>
          {group !== 'all' && totalForQuery > 0 && (
            <button
              onClick={() => setGroup('all')}
              className="mt-4 w-full max-w-xs mx-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-violet-100 text-violet-800 active:bg-violet-200"
            >
              Clear filter — {totalForQuery} match{totalForQuery === 1 ? '' : 'es'} in other groups
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500">
          {grouped.map(({ key, label, items }) => (
            <div key={key}>
              <div className="inline-flex items-center px-2.5 py-1 rounded-lg border border-violet-200 bg-violet-50 text-violet-700 text-[11px] font-bold uppercase tracking-wide mb-2">
                {label} · {items.length}
              </div>
              <div className="space-y-3">
                {items.map((m) => (
                  <BiomarkerCard key={m.id} m={m} onCompare={() => onCompare(m)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default BiomarkerList;
