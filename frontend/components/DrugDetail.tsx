import React, { useEffect } from 'react';
import { DrugDetailData } from '../types';
import { drugKey } from '../services/notes';
import EmaBadges from './EmaBadges';
import IndicationFacets from './IndicationFacets';
import AccessStatus from './AccessStatus';
import DrugNotes from './DrugNotes';
import {
  X, Activity, Pill, Building2, Calendar, Globe, FlaskConical, ExternalLink,
  Sparkles, Hourglass, Stethoscope, GitCompare, Check, Share, FileText,
} from 'lucide-react';

interface DrugDetailProps {
  data: DrugDetailData;
  onClose: () => void;
  onViewTrials: (query: string) => void;
  onOpenGlossary: (glossaryId?: string) => void;
  onToggleCompare?: (data: DrugDetailData) => void;
  inCompare?: boolean;
  onCompareEuUs?: () => void;
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

// Map the free-text badge on the detail header to a glossary entry, so tapping
// the badge explains it — mirrors the tappable EMA flag pills.
const badgeGlossaryId = (badge?: string): string | undefined => {
  if (!badge) return undefined;
  if (badge.startsWith('Novel')) return 'novel';
  if (badge.startsWith('CHMP')) return 'chmp';
  if (badge.startsWith('351(k)')) return '351k';
  if (badge.startsWith('Advanced therapy')) return 'atmp';
  return undefined;
};

// Plain-text summary for the system share sheet (colleague-friendly, sourced).
const shareText = (d: DrugDetailData): string => {
  const lines = [
    `${d.brandName}${d.genericName && d.genericName !== '—' ? ` (${d.genericName})` : ''}`,
  ];
  if (d.expectedDecision) lines.push(`EU decision expected ~${d.expectedDecision} (European Commission decision pending)`);
  else if (d.emaApprovalDate && /^\d/.test(d.emaApprovalDate)) lines.push(`EU marketing authorisation: ${d.emaApprovalDate}`);
  if (d.approvalDate && /^\d/.test(d.approvalDate)) lines.push(`FDA approval: ${d.approvalDate}`);
  if (d.company) lines.push(`Company: ${d.company}`);
  if (d.indication) lines.push(`Indication: ${d.indication}`);
  if (d.emaUrl) lines.push(d.emaUrl);
  lines.push(
    '— via DrugRadar. Public EMA/FDA data; informational only, not medical advice. Dates may be estimates — verify against the SmPC / EPAR or FDA label.'
  );
  return lines.join('\n');
};

const Row: React.FC<{ icon: React.ReactNode; label: string; children: React.ReactNode }> = ({ icon, label, children }) => (
  <div className="flex items-start text-sm text-slate-700">
    <span className="mr-2.5 mt-0.5 text-slate-400 shrink-0">{icon}</span>
    <div>
      <span className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-0.5">{label}</span>
      <span className="leading-snug">{children}</span>
    </div>
  </div>
);

/**
 * The drug detail body — shared by the phone modal (below) and the iPad detail
 * pane (rendered directly in App). Contains no overlay/positioning of its own.
 */
export const DrugDetailContent: React.FC<{
  data: DrugDetailData;
  onViewTrials: (query: string) => void;
  onOpenGlossary: (glossaryId?: string) => void;
  onToggleCompare?: (data: DrugDetailData) => void;
  inCompare?: boolean;
  onCompareEuUs?: () => void;
}> = ({ data, onViewTrials, onOpenGlossary, onToggleCompare, inCompare, onCompareEuUs }) => {
  const trialQuery = data.genericName && data.genericName !== '—' ? data.genericName : data.brandName;
  const hasEma = !!data.emaApprovalDate && /^\d/.test(data.emaApprovalDate);
  const badgeId = badgeGlossaryId(data.badge);

  return (
    <>
      <div className="flex items-start space-x-3 mb-5 pr-8">
        <div className="p-2.5 bg-blue-50 rounded-xl text-blue-600 shrink-0">
          <Pill size={22} />
        </div>
        <div className="min-w-0">
          <h2 className="text-xl font-bold text-slate-900 leading-tight">{data.brandName}</h2>
          <p className="text-sm text-slate-500 font-medium mt-0.5">{data.genericName}</p>
          {data.badge &&
            (badgeId ? (
              <button
                type="button"
                onClick={() => onOpenGlossary(badgeId)}
                className="inline-flex items-center mt-2 px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-200 text-[10px] font-bold uppercase tracking-wider active:opacity-70"
                aria-label={`What is ${data.badge}?`}
              >
                {data.badge.startsWith('Novel') && <Sparkles size={10} className="mr-1" />}
                {data.badge.startsWith('CHMP') && <Hourglass size={10} className="mr-1" />}
                {data.badge}
              </button>
            ) : (
              <span className="inline-flex items-center mt-2 px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-200 text-[10px] font-bold uppercase tracking-wider">
                {data.badge}
              </span>
            ))}
          {data.emaFlags && <EmaBadges flags={data.emaFlags} className="mt-2" onSelect={onOpenGlossary} />}
        </div>
      </div>

      {/* Expected EU marketing authorisation (EC decision pending after CHMP opinion). */}
      {data.expectedDecision && (
        <div className="mb-4 bg-indigo-50 border border-indigo-200 rounded-2xl p-4">
          <p className="text-[10px] uppercase tracking-wider text-indigo-500 font-semibold mb-1 flex items-center">
            <Hourglass size={12} className="mr-1" /> Marketing authorisation expected
          </p>
          <p className="text-lg font-bold text-indigo-800 leading-none">{formatPretty(data.expectedDecision)}</p>
          <p className="text-[11px] text-indigo-600 mt-1.5 leading-snug">
            Estimated European Commission decision, ≈67 days after the CHMP
            opinion{data.opinionDate ? ` of ${formatPretty(data.opinionDate)}` : ''}. The
            decision has not been made yet — the date and outcome may change.
          </p>
        </div>
      )}

      {/* Structured facets parsed from the approved indication text. */}
      <IndicationFacets indication={data.indication} />

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

      {onCompareEuUs && (
        <button
          onClick={onCompareEuUs}
          className="w-full mt-3 py-3.5 bg-sky-50 text-sky-700 font-semibold rounded-xl border border-sky-200 active:bg-sky-100 transition-colors flex items-center justify-center gap-2"
        >
          <FileText size={18} /> Compare EU &amp; US label
        </button>
      )}

      <div className="flex gap-2 mt-3">
        {onToggleCompare && (
          <button
            onClick={() => onToggleCompare(data)}
            className={`flex-1 py-3 font-semibold rounded-xl transition-colors flex items-center justify-center gap-2 border ${
              inCompare
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200 active:bg-emerald-100'
                : 'bg-white text-slate-700 border-slate-200 active:bg-slate-50'
            }`}
          >
            {inCompare ? <Check size={18} /> : <GitCompare size={18} />}
            {inCompare ? 'In comparison' : 'Compare'}
          </button>
        )}
        {/* System share sheet (iOS/WKWebView + modern browsers only). */}
        {typeof navigator !== 'undefined' && typeof navigator.share === 'function' && (
          <button
            onClick={() => {
              navigator.share({ title: data.brandName, text: shareText(data) }).catch(() => {
                /* user cancelled the sheet — nothing to do */
              });
            }}
            className="flex-1 py-3 font-semibold rounded-xl transition-colors flex items-center justify-center gap-2 border bg-white text-slate-700 border-slate-200 active:bg-slate-50"
          >
            <Share size={18} /> Share
          </button>
        )}
      </div>

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

      {/* Access-status ladder: regulatory ≠ reimbursed ≠ available. */}
      <AccessStatus data={data} />

      {/* Private on-device note for this drug. */}
      <DrugNotes noteKey={drugKey(data)} />
    </>
  );
};

/** Phone/compact modal wrapper around the shared content. */
const DrugDetail: React.FC<DrugDetailProps> = ({ data, onClose, onViewTrials, onOpenGlossary, onToggleCompare, inCompare, onCompareEuUs }) => {
  // Close on Escape; lock background scroll while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    // Position-fix scroll lock. On iOS (WKWebView) `overflow:hidden` on <body>
    // does NOT stop the page scrolling behind the sheet — the background drifts
    // and the page can jump when the sheet closes. Pinning the body at its
    // current offset and restoring scroll on close eliminates that jank.
    const body = document.body;
    const scrollY = window.scrollY;
    const prev = {
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
    };
    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.width = '100%';
    return () => {
      document.removeEventListener('keydown', onKey);
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.width = prev.width;
      window.scrollTo(0, scrollY);
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 backdrop-blur-sm sm:items-center p-0 sm:p-4 pad:hidden"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-t-3xl sm:rounded-3xl p-6 w-full sm:max-w-md max-h-[88vh] overflow-y-auto overscroll-contain shadow-2xl relative animate-in slide-in-from-bottom-4 duration-300 pb-[calc(env(safe-area-inset-bottom)+1.5rem)]"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 bg-slate-50 rounded-full z-10"
          aria-label="Close"
        >
          <X size={18} />
        </button>
        <DrugDetailContent
          data={data}
          onViewTrials={onViewTrials}
          onOpenGlossary={onOpenGlossary}
          onToggleCompare={onToggleCompare}
          inCompare={inCompare}
          onCompareEuUs={onCompareEuUs}
        />
      </div>
    </div>
  );
};

export default DrugDetail;
