import React, { useMemo, useState } from 'react';
import { NovelApproval, DrugDetailData } from '../types';
import { getNovelYears, getNovelApprovals, filterNovel, novelSourceUrl } from '../services/novelApprovals';
import { Sparkles, Activity, ExternalLink, Info, Search, ChevronRight } from 'lucide-react';

interface NovelListProps {
  query: string;
  onSelect: (data: DrugDetailData) => void;
}

const formatPretty = (iso: string): string => {
  const d = new Date(iso.length === 7 ? `${iso}-01` : iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
};

const NovelList: React.FC<NovelListProps> = ({ query, onSelect }) => {
  const years = useMemo(() => getNovelYears(), []);
  const [year, setYear] = useState<string>(years[0] || '');

  const all = useMemo(() => getNovelApprovals(year), [year]);
  const entries = useMemo(() => filterNovel(all, query), [all, query]);

  const yearTabClass = (active: boolean) =>
    `flex-1 py-1.5 text-sm font-semibold rounded-lg transition-colors ${
      active ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'
    }`;

  return (
    <div className="px-4">
      <div className="mb-3">
        <h2 className="text-xl font-bold text-slate-800 flex items-center">
          <Sparkles size={20} className="mr-2 text-blue-600" />
          Novel Approvals
        </h2>
        <p className="text-slate-500 text-xs mt-1 leading-relaxed">
          CDER's official list of new drugs never before approved in the U.S. — the headline new-drug
          roster, straight from the FDA. Search filters this year's list.
        </p>
      </div>

      {/* Year selector */}
      {years.length > 1 && (
        <div className="flex bg-slate-100 rounded-xl p-1 mb-3">
          {years.map((y) => (
            <button key={y} className={yearTabClass(y === year)} onClick={() => setYear(y)}>
              {y}
              <span className="ml-1.5 text-[11px] font-bold opacity-60">{getNovelApprovals(y).length}</span>
            </button>
          ))}
        </div>
      )}

      <div className="flex items-start text-[11px] text-slate-500 leading-relaxed mb-3 bg-blue-50 border border-blue-200 rounded-lg p-2">
        <Info size={13} className="mr-1.5 mt-0.5 text-blue-500 shrink-0" />
        <span>
          Source: FDA CDER “Novel Drug Therapy Approvals for {year}.” Indications reflect the
          FDA-approved use on the approval date.
        </span>
      </div>

      {entries.length === 0 ? (
        <div className="text-center py-12 px-6">
          <div className="bg-slate-100 w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3">
            <Search className="text-slate-400 w-7 h-7" />
          </div>
          <p className="text-slate-500 text-sm">
            No {year} novel approvals match “{query}”.
          </p>
        </div>
      ) : (
        <>
          <p className="text-slate-400 text-xs font-semibold mb-3">
            {entries.length} drug{entries.length === 1 ? '' : 's'}
            {query ? ` matching “${query}”` : ` approved in ${year}`}
            {!query && all.length > 0 && ` · latest ${formatPretty(all[0].approvalDate)}`}
          </p>
          <div className="space-y-3">
            {entries.map((e: NovelApproval) => (
              <button
                key={e.no}
                type="button"
                onClick={() =>
                  onSelect({
                    brandName: e.brandName,
                    genericName: e.genericName,
                    approvalDate: e.approvalDate,
                    indication: e.indication,
                    badge: `Novel ${year}`,
                  })
                }
                className="w-full text-left bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden active:scale-[0.98] transition-transform duration-200"
              >
                <div className="p-4 flex justify-between items-start gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center flex-wrap gap-2">
                      <span className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded bg-slate-100 text-slate-500 border border-slate-200 text-[11px] font-bold">
                        {e.no}
                      </span>
                      <h3 className="font-bold text-slate-900 text-base leading-tight">{e.brandName}</h3>
                    </div>
                    <p className="text-sm text-slate-500 font-medium mt-0.5 truncate">{e.genericName}</p>
                  </div>
                  <div className="text-right shrink-0 flex items-start gap-1">
                    <div>
                      <div className="text-sm font-bold text-blue-700 leading-none">{formatPretty(e.approvalDate)}</div>
                      <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider mt-1">FDA approval</div>
                    </div>
                    <ChevronRight size={16} className="text-slate-300 mt-0.5 shrink-0" />
                  </div>
                </div>
                {e.indication && (
                  <div className="px-4 pb-4 text-sm text-slate-700">
                    <div className="flex items-start">
                      <Activity size={16} className="mr-2 mt-0.5 text-slate-400 shrink-0" />
                      <span className="leading-snug">{e.indication}</span>
                    </div>
                  </div>
                )}
              </button>
            ))}
          </div>

          <a
            href={novelSourceUrl(year)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center text-xs font-semibold text-blue-600 active:text-blue-800 mt-4"
          >
            FDA Novel Drug Approvals for {year} <ExternalLink size={12} className="ml-1" />
          </a>
        </>
      )}
    </div>
  );
};

export default NovelList;
