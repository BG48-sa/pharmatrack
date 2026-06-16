import React, { useEffect } from 'react';
import { DrugDetailData } from '../types';
import EmaBadges from './EmaBadges';
import { X, Activity, Pill, Building2, Calendar, Globe, FlaskConical, ExternalLink, Sparkles, Hourglass, MapPin, Stethoscope } from 'lucide-react';

interface DrugDetailProps {
  data: DrugDetailData;
  onClose: () => void;
  onViewTrials: (query: string) => void;
}

const formatPretty = (val?: string): string => {
  if (!val) return '—';
  if (!/^\d{4}-\d{2}/.test(val)) return val; // 'N/A', 'Not in EMA', etc.
  const d = new Date(val.length === 7 ? `${val}-01` : val);
  if (isNaN(d.getTime())) return val;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
};

const drugsAtFdaUrl = (brand: string): string =>
  `https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=BasicSearch.process&searchTerm=${encodeURIComponent(brand)}`;

// National-access lookups for the user's countries — central EU MA does not by
// itself mean a medicine is reimbursed/available nationally (AIFA in Italy,
// G-BA/AMNOG in Germany decide that). These are pre-filled search links.
const aifaUrl = (term: string): string =>
  `https://www.google.com/search?q=${encodeURIComponent(`AIFA ${term}`)}`;
const gbaUrl = (term: string): string =>
  `https://www.google.com/search?q=${encodeURIComponent(`G-BA Nutzenbewertung ${term}`)}`;

const Row: React.FC<{ icon: React.ReactNode; label: string; children: React.ReactNode }> = ({ icon, label, children }) => (
  <div className="flex items-start text-sm text-slate-700">
    <span className="mr-2.5 mt-0.5 text-slate-400 shrink-0">{icon}</span>
    <div>
      <span className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-0.5">{label}</span>
      <span className="leading-snug">{children}</span>
    </div>
  </div>
);

const DrugDetail: React.FC<DrugDetailProps> = ({ data, onClose, onViewTrials }) => {
  // Close on Escape; lock background scroll while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const trialQuery = data.genericName && data.genericName !== '—' ? data.genericName : data.brandName;
  const hasEma = !!data.emaApprovalDate && /^\d/.test(data.emaApprovalDate);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 backdrop-blur-sm sm:items-center p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-t-3xl sm:rounded-3xl p-6 w-full sm:max-w-md max-h-[88vh] overflow-y-auto shadow-2xl relative animate-in slide-in-from-bottom-4 duration-300 pb-[calc(env(safe-area-inset-bottom)+1.5rem)]"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 bg-slate-50 rounded-full"
          aria-label="Close"
        >
          <X size={18} />
        </button>

        <div className="flex items-start space-x-3 mb-5 pr-8">
          <div className="p-2.5 bg-blue-50 rounded-xl text-blue-600 shrink-0">
            <Pill size={22} />
          </div>
          <div className="min-w-0">
            <h2 className="text-xl font-bold text-slate-900 leading-tight">{data.brandName}</h2>
            <p className="text-sm text-slate-500 font-medium mt-0.5">{data.genericName}</p>
            {data.badge && (
              <span className="inline-flex items-center mt-2 px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-200 text-[10px] font-bold uppercase tracking-wider">
                {data.badge.startsWith('Novel') && <Sparkles size={10} className="mr-1" />}
                {data.badge.startsWith('CHMP') && <Hourglass size={10} className="mr-1" />}
                {data.badge}
              </span>
            )}
            {data.emaFlags && <EmaBadges flags={data.emaFlags} className="mt-2" />}
          </div>
        </div>

        {/* Expected EU marketing authorisation (pending CHMP positive opinion). */}
        {data.expectedDecision && (
          <div className="mb-4 bg-indigo-50 border border-indigo-200 rounded-2xl p-4">
            <p className="text-[10px] uppercase tracking-wider text-indigo-500 font-semibold mb-1 flex items-center">
              <Hourglass size={12} className="mr-1" /> Marketing authorisation expected
            </p>
            <p className="text-lg font-bold text-indigo-800 leading-none">{formatPretty(data.expectedDecision)}</p>
            <p className="text-[11px] text-indigo-600 mt-1.5 leading-snug">
              Estimated European Commission decision, ≈67 days after the CHMP
              positive opinion{data.opinionDate ? ` of ${formatPretty(data.opinionDate)}` : ''}.
            </p>
          </div>
        )}

        <div className="space-y-3.5">
          {data.indication && <Row icon={<Activity size={18} />} label="Indication">{data.indication}</Row>}
          {data.therapeuticArea && (
            <Row icon={<Stethoscope size={18} />} label="Therapeutic Area">
              {data.therapeuticArea.split(';').map((a) => a.trim()).filter(Boolean).join(' · ')}
            </Row>
          )}
          {data.drugClass && <Row icon={<Pill size={18} />} label="Drug Class">{data.drugClass}</Row>}
          {data.company && <Row icon={<Building2 size={18} />} label="Company">{data.company}</Row>}
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div className="bg-slate-50 rounded-xl p-3">
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1 flex items-center">
                <Calendar size={12} className="mr-1" /> FDA Approval
              </p>
              <p className="text-sm font-bold text-slate-800">{formatPretty(data.approvalDate)}</p>
            </div>
            <div className="bg-slate-50 rounded-xl p-3">
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1 flex items-center">
                <Globe size={12} className="mr-1" /> EMA Approval
              </p>
              <p className={`text-sm font-bold ${hasEma ? 'text-slate-800' : 'text-slate-400'}`}>
                {hasEma ? formatPretty(data.emaApprovalDate) : data.emaApprovalDate || '—'}
              </p>
            </div>
          </div>
        </div>

        {/* Cross-link to the Pipeline tab — the key unifying action. */}
        <button
          onClick={() => onViewTrials(trialQuery)}
          className="w-full mt-6 py-3.5 bg-blue-600 text-white font-semibold rounded-xl active:bg-blue-700 transition-colors flex items-center justify-center gap-2"
        >
          <FlaskConical size={18} /> See Phase 3 trials
        </button>

        <div className="flex flex-col gap-2 mt-3">
          <a
            href={drugsAtFdaUrl(data.brandName)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center text-sm font-semibold text-blue-600 active:text-blue-800 py-2"
          >
            View on Drugs@FDA <ExternalLink size={13} className="ml-1.5" />
          </a>
          {data.emaUrl && (
            <a
              href={data.emaUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center text-sm font-semibold text-blue-600 active:text-blue-800 py-2"
            >
              View EMA medicine page <ExternalLink size={13} className="ml-1.5" />
            </a>
          )}
        </div>

        {/* National access — central EU authorisation ≠ national reimbursement. */}
        <div className="mt-4 pt-4 border-t border-slate-100">
          <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-2 flex items-center">
            <MapPin size={12} className="mr-1" /> National access
          </p>
          <div className="grid grid-cols-2 gap-2">
            <a
              href={aifaUrl(data.brandName)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center text-xs font-semibold text-slate-700 bg-slate-50 active:bg-slate-100 rounded-lg py-2.5"
            >
              🇮🇹 Italy · AIFA <ExternalLink size={11} className="ml-1.5" />
            </a>
            <a
              href={gbaUrl(data.genericName !== '—' ? data.genericName : data.brandName)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center text-xs font-semibold text-slate-700 bg-slate-50 active:bg-slate-100 rounded-lg py-2.5"
            >
              🇩🇪 Germany · G-BA <ExternalLink size={11} className="ml-1.5" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DrugDetail;
