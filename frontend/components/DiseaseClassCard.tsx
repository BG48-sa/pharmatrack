import React from 'react';
import { GitCompare, Check } from 'lucide-react';
import { DiseaseMatch, DiseaseEntity } from '../services/diseaseEntities';

interface Props {
  match: DiseaseMatch;
  query: string;
  onCompare: (e: DiseaseEntity) => void;
}

// One curated disease class as a compare card. When the search named a
// molecular target, the drugs acting on it are highlighted and the others are
// dimmed and named as such, so a "PD-L1" search never presents VEGFR
// inhibitors as PD-L1 drugs. The primary button then compares only the
// acting drugs; the whole class stays one tap away.
const DiseaseClassCard: React.FC<Props> = ({ match, query, onCompare }) => {
  const { entity, target, acting, viaTargetOnly } = match;
  const targeted = !!target && !!acting;
  const actingDrugs = targeted ? entity.drugs.filter((d) => acting!.has(d.b)) : [];
  const others = targeted ? entity.drugs.filter((d) => !acting!.has(d.b)) : [];
  const primary = 'inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-semibold bg-emerald-600 text-white active:bg-emerald-700 transition-colors';
  const secondary = 'inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold text-emerald-700 bg-white border border-emerald-200 active:bg-emerald-50 transition-colors';
  const subset = targeted && actingDrugs.length >= 2;

  return (
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4">
      <div className="flex items-start gap-3">
        <div className="p-2 bg-emerald-100 rounded-xl text-emerald-700 shrink-0">
          <GitCompare size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-bold text-slate-900 leading-tight">{entity.name}</h3>
          <p className="text-[13px] text-slate-600 mt-0.5">{entity.cls}</p>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {(targeted ? [...actingDrugs, ...others] : entity.drugs).map((d) => {
              const on = targeted && acting!.has(d.b);
              const cls = !targeted
                ? 'bg-white border-emerald-200 text-slate-700'
                : on
                  ? 'bg-emerald-600 border-emerald-600 text-white'
                  : 'bg-white border-slate-200 text-slate-400';
              return (
                <span key={d.b} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border text-[11px] font-semibold ${cls}`}>
                  {on && <Check size={11} aria-hidden="true" />}
                  {d.b}
                </span>
              );
            })}
          </div>
          {targeted && (
            <p className="text-[11px] text-slate-600 mt-2 leading-snug">
              <span className="font-semibold text-emerald-800">Highlighted:</span>{' '}
              {actingDrugs.length === 1 ? 'acts' : 'act'} on {target!.label}.
              {others.length > 0 && (
                <> {others.map((d) => d.b).join(', ')} {others.length === 1 ? 'belongs' : 'belong'} to this disease class but {others.length === 1 ? 'acts' : 'act'} on other targets.</>
              )}
            </p>
          )}
          {!targeted && viaTargetOnly && (
            <p className="text-[11px] text-slate-600 mt-2 leading-snug">
              Matched because this class includes agents acting on “{query}” — not every drug listed acts on it.
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {subset && (
              <button onClick={() => onCompare({ ...entity, drugs: actingDrugs })} className={primary}>
                <GitCompare size={15} /> Compare the {actingDrugs.length} {target!.label} drugs
              </button>
            )}
            <button onClick={() => onCompare(entity)} className={subset ? secondary : primary}>
              <GitCompare size={15} /> Compare all {entity.drugs.length} {targeted ? 'in this class' : 'side by side'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DiseaseClassCard;
