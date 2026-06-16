import React from 'react';
import { PdufaEntry } from '../types';
import { daysUntil } from '../services/pdufa';
import { CalendarClock, Building2, Activity, Info, ExternalLink } from 'lucide-react';

interface PdufaListProps {
  entries: PdufaEntry[];
}

const formatPretty = (iso: string): string => {
  const d = new Date(iso.length === 7 ? `${iso}-01` : iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
};

const PdufaList: React.FC<PdufaListProps> = ({ entries }) => {
  if (entries.length === 0) return null;

  return (
    <div className="px-4 mb-6">
      <h2 className="text-xl font-bold text-slate-800 flex items-center mb-1">
        <CalendarClock size={20} className="mr-2 text-indigo-600" />
        Coming Up
      </h2>
      <div className="flex items-start text-[11px] text-slate-500 leading-relaxed mb-3 bg-amber-50 border border-amber-200 rounded-lg p-2">
        <Info size={13} className="mr-1.5 mt-0.5 text-amber-500 shrink-0" />
        <span>Sponsor/analyst-disclosed FDA target action (PDUFA) dates — not an official FDA feed. Verify before relying on them.</span>
      </div>

      <div className="space-y-3">
        {entries.map((e) => {
          const days = daysUntil(e.pdufaDate);
          return (
            <div key={`${e.brandName}-${e.pdufaDate}`} className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="p-4 flex justify-between items-start gap-3">
                <div className="min-w-0">
                  <div className="flex items-center flex-wrap gap-2">
                    <h3 className="font-bold text-slate-900 text-base leading-tight">{e.brandName}</h3>
                    {e.type && (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 text-[10px] font-bold uppercase tracking-wider">
                        {e.type}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-slate-500 font-medium mt-0.5 truncate">{e.genericName}</p>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-bold text-indigo-700 leading-none">{formatPretty(e.pdufaDate)}</div>
                  {days != null && days >= 0 && (
                    <div className="text-[11px] text-slate-400 font-semibold mt-1">in {days} day{days === 1 ? '' : 's'}</div>
                  )}
                </div>
              </div>
              <div className="px-4 pb-4 space-y-2 text-sm text-slate-700">
                <div className="flex items-start">
                  <Activity size={16} className="mr-2 mt-0.5 text-slate-400 shrink-0" />
                  <span className="leading-snug">{e.indication}</span>
                </div>
                <div className="flex items-start">
                  <Building2 size={16} className="mr-2 mt-0.5 text-slate-400 shrink-0" />
                  <span className="leading-snug">{e.company}</span>
                </div>
                {e.source && (
                  <a
                    href={e.source}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center text-xs font-semibold text-indigo-600 active:text-indigo-800 pt-1"
                  >
                    Source <ExternalLink size={12} className="ml-1" />
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default PdufaList;
