import React, { useEffect } from 'react';
import { DrugDetailData } from '../types';
import { parseIndication } from '../services/indicationParser';
import { drugKey } from '../services/notes';
import { GitCompare, X } from 'lucide-react';

/**
 * Side-by-side comparison of two drugs. Reads the same normalised DrugDetailData
 * the detail sheet uses, so any two cards from any tab can be compared on
 * regulatory status, dates, indication facets and company.
 */
interface Props {
  items: DrugDetailData[];
  onClose: () => void;
  onRemove: (key: string) => void;
}

const fmt = (val?: string): string => {
  if (!val) return '—';
  if (!/^\d{4}-\d{2}/.test(val)) return val;
  const d = new Date(val.length === 7 ? `${val}-01` : val);
  return isNaN(d.getTime()) ? val : d.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' });
};

const euStatus = (d: DrugDetailData): string => {
  if (d.expectedDecision) return `Decision expected ~${fmt(d.expectedDecision)}`;
  if (d.emaApprovalDate && /^\d/.test(d.emaApprovalDate)) return `Authorised ${fmt(d.emaApprovalDate)}`;
  if (d.emaApprovalDate === 'Not in EMA') return 'Not centrally authorised';
  return '—';
};

const usStatus = (d: DrugDetailData): string =>
  d.approvalDate && /^\d/.test(d.approvalDate) ? `Approved ${fmt(d.approvalDate)}` : 'Not shown here';

const flagLabels = (d: DrugDetailData): string => {
  const f = d.emaFlags;
  if (!f) return '—';
  const on: string[] = [];
  if (f.atmp) on.push('ATMP');
  if (f.orphan) on.push('Orphan');
  if (f.prime) on.push('PRIME');
  if (f.acc) on.push('Accelerated');
  if (f.cond) on.push('Conditional');
  if (f.exc) on.push('Except. circ.');
  if (f.bio) on.push('Biosimilar');
  if (f.gen) on.push('Generic');
  return on.length ? on.join(', ') : '—';
};

const facetLabels = (d: DrugDetailData): string[] =>
  parseIndication(d.indication).map((x) => x.label);

// One attribute row: label on the left, a cell per drug. Render prop lets a row
// show chips (facets) instead of plain text.
const CompareRow: React.FC<{
  label: string;
  items: DrugDetailData[];
  render: (d: DrugDetailData) => React.ReactNode;
}> = ({ label, items, render }) => (
  <div className="grid grid-cols-[5.5rem_1fr_1fr] gap-2 py-2.5 border-t border-slate-100">
    <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold pt-0.5">{label}</div>
    {items.map((d) => (
      <div key={drugKey(d)} className="text-[13px] text-slate-700 leading-snug min-w-0">
        {render(d)}
      </div>
    ))}
  </div>
);

const ComparePanel: React.FC<Props> = ({ items, onClose, onRemove }) => {
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

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-900/40 backdrop-blur-sm sm:items-center p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-t-3xl sm:rounded-3xl w-full sm:max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl relative animate-in slide-in-from-bottom-4 duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white/90 backdrop-blur-xl px-5 pt-6 pb-3 border-b border-slate-100 z-10">
          <button
            onClick={onClose}
            className="absolute top-5 right-4 p-2 text-slate-400 hover:text-slate-600 bg-slate-50 rounded-full"
            aria-label="Close"
          >
            <X size={18} />
          </button>
          <div className="flex items-center space-x-3 pr-8">
            <div className="p-2.5 bg-emerald-50 rounded-xl text-emerald-600 shrink-0">
              <GitCompare size={22} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900 leading-tight">Compare</h2>
              <p className="text-sm text-slate-500 mt-0.5">Side-by-side regulatory snapshot</p>
            </div>
          </div>
        </div>

        <div className="px-5 py-4 pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
          {/* Drug name header cells */}
          <div className="grid grid-cols-[5.5rem_1fr_1fr] gap-2">
            <div />
            {items.map((d) => (
              <div key={drugKey(d)} className="bg-slate-50 border border-slate-200 rounded-xl p-2.5 relative">
                <button
                  onClick={() => onRemove(drugKey(d))}
                  className="absolute top-1.5 right-1.5 p-1 text-slate-300 hover:text-red-500"
                  aria-label={`Remove ${d.brandName}`}
                >
                  <X size={13} />
                </button>
                <div className="font-bold text-slate-900 text-sm leading-tight pr-4">{d.brandName}</div>
                <div className="text-[11px] text-slate-500 font-medium truncate">{d.genericName}</div>
              </div>
            ))}
          </div>

          <div className="mt-1">
            <CompareRow label="EU (EMA)" items={items} render={(d) => euStatus(d)} />
            <CompareRow label="US (FDA)" items={items} render={(d) => usStatus(d)} />
            <CompareRow label="Company" items={items} render={(d) => d.company || '—'} />
            <CompareRow
              label="Area"
              items={items}
              render={(d) =>
                d.therapeuticArea
                  ? d.therapeuticArea.split(';').map((a) => a.trim()).filter(Boolean).join(' · ')
                  : '—'
              }
            />
            <CompareRow label="Flags" items={items} render={(d) => flagLabels(d)} />
            <CompareRow
              label="At a glance"
              items={items}
              render={(d) => {
                const f = facetLabels(d);
                return f.length ? (
                  <div className="flex flex-wrap gap-1">
                    {f.map((l) => (
                      <span
                        key={l}
                        className="inline-flex items-center px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 border border-violet-200 text-[10px] font-semibold"
                      >
                        {l}
                      </span>
                    ))}
                  </div>
                ) : (
                  '—'
                );
              }}
            />
            <CompareRow label="Indication" items={items} render={(d) => d.indication || '—'} />
          </div>

          <p className="text-[10px] text-slate-400 mt-4 leading-snug">
            For informational purposes only — not medical advice and not a basis for treatment
            decisions. “At a glance” facets are auto-parsed from the approved indication and may be
            incomplete or wrong — verify every entry against the SmPC / EPAR or FDA label.
            EU authorisation does not imply national reimbursement or availability.
          </p>
        </div>
      </div>
    </div>
  );
};

export default ComparePanel;
