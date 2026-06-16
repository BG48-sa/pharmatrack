import React from 'react';
import { Trial } from '../types';
import { FlaskConical, Building2, Activity, ExternalLink, CircleDot } from 'lucide-react';

interface TrialListProps {
  trials: Trial[];
}

const statusColor = (status: string): string => {
  const s = status.toLowerCase();
  if (s.includes('recruiting') && !s.includes('not')) return 'text-emerald-700 bg-emerald-50 border-emerald-200';
  if (s.includes('active')) return 'text-blue-700 bg-blue-50 border-blue-200';
  return 'text-slate-600 bg-slate-50 border-slate-200';
};

const TrialList: React.FC<TrialListProps> = ({ trials }) => {
  if (trials.length === 0) {
    return (
      <div className="text-center py-16 px-4">
        <div className="bg-slate-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
          <FlaskConical className="text-slate-400 w-8 h-8" />
        </div>
        <h3 className="text-lg font-semibold text-slate-700 mb-1">No late-stage trials found</h3>
        <p className="text-slate-500 text-sm">Try a drug name or a disease (e.g. "psoriasis").</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 px-4 pb-6">
      {trials.map((t) => (
        <a
          key={t.nctId}
          href={t.url}
          target="_blank"
          rel="noopener noreferrer"
          className="block bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden active:scale-[0.98] transition-transform duration-200"
        >
          <div className="p-4 border-b border-slate-100">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-200 text-[10px] font-bold uppercase tracking-wider">
                {t.phase}
              </span>
              <span className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[10px] font-bold uppercase tracking-wider ${statusColor(t.status)}`}>
                <CircleDot size={10} className="mr-1" />
                {t.status}
              </span>
            </div>
            <h3 className="font-semibold text-slate-900 text-sm leading-snug">{t.title}</h3>
          </div>
          <div className="p-4 space-y-2 text-sm text-slate-700 bg-slate-50/30">
            {t.conditions.length > 0 && (
              <div className="flex items-start">
                <Activity size={16} className="mr-2 mt-0.5 text-slate-400 shrink-0" />
                <span className="leading-snug">{t.conditions.slice(0, 3).join(', ')}</span>
              </div>
            )}
            <div className="flex items-start">
              <Building2 size={16} className="mr-2 mt-0.5 text-slate-400 shrink-0" />
              <span className="leading-snug">{t.sponsor}</span>
            </div>
          </div>
          <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 bg-white">
            <span>
              {t.completionDate ? `Est. completion ${t.completionDate}` : t.nctId}
            </span>
            <span className="inline-flex items-center font-semibold text-indigo-600">
              {t.nctId} <ExternalLink size={12} className="ml-1" />
            </span>
          </div>
        </a>
      ))}
    </div>
  );
};

export default TrialList;
