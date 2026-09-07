import React from 'react';
import { parseIndicationGroups, Facet, FacetGroup } from '../services/indicationParser';
import { Dna, Layers, Target, Combine, Users } from 'lucide-react';

// Visual style + display order per facet group. Biomarker leads — it's usually
// the field that decides whether a given patient is even eligible.
const GROUP: Record<FacetGroup, { order: number; cls: string; icon: React.ReactNode }> = {
  Biomarker: { order: 0, cls: 'bg-violet-50 text-violet-700 border-violet-200', icon: <Dna size={11} /> },
  Line: { order: 1, cls: 'bg-amber-50 text-amber-800 border-amber-200', icon: <Layers size={11} /> },
  Setting: { order: 2, cls: 'bg-blue-50 text-blue-700 border-blue-200', icon: <Target size={11} /> },
  Regimen: { order: 3, cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: <Combine size={11} /> },
  Population: { order: 4, cls: 'bg-slate-100 text-slate-600 border-slate-200', icon: <Users size={11} /> },
};

const Pills: React.FC<{ facets: Facet[] }> = ({ facets }) => {
  const sorted = [...facets].sort((a, b) => GROUP[a.group].order - GROUP[b.group].order);
  return (
    <div className="flex flex-wrap gap-1.5">
      {sorted.map((f) => (
        <span key={`${f.group}-${f.label}`} className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[11px] font-semibold ${GROUP[f.group].cls}`}>
          {GROUP[f.group].icon}
          {f.label}
        </span>
      ))}
    </div>
  );
};

// One facet group per indication clause, so the population, setting, biomarker
// and regimen of one indication are never mixed with those of another.
const IndicationFacets: React.FC<{ indication?: string }> = ({ indication }) => {
  const groups = parseIndicationGroups(indication);
  if (groups.length === 0) return null;
  const multi = groups.length > 1;

  return (
    <div className="mb-4 bg-slate-50 rounded-2xl p-3.5 border border-slate-100">
      <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-2">
        At a glance{multi ? ` — ${groups.length} indications, kept separate` : ''}
      </p>
      <div className="space-y-2.5">
        {groups.map((g, i) => (
          <div key={i}>
            {multi && (
              <p className="text-[11px] text-slate-500 leading-snug mb-1">
                <span className="font-semibold text-slate-600">{i + 1}.</span>{' '}
                {g.clause.length > 110 ? g.clause.slice(0, 107).replace(/\s+\S*$/, '') + '…' : g.clause}
              </p>
            )}
            <Pills facets={g.facets} />
          </div>
        ))}
      </div>
      <p className="text-[10px] text-slate-400 mt-2 leading-snug">
        Keywords found in the approved indication text, shown per indication. Negations and thresholds are kept
        as written; anything not listed here may still restrict eligibility — read the full indication below.
      </p>
    </div>
  );
};

export default IndicationFacets;
