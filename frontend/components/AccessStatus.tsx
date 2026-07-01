import React from 'react';
import { DrugDetailData } from '../types';
import { CheckCircle2, Hourglass, MinusCircle, ExternalLink, MapPin } from 'lucide-react';

/**
 * Access-status ladder.
 *
 * The expert distinction that a plain "approved" flag hides: central regulatory
 * authorisation is NOT the same as national reimbursement or actual commercial
 * availability. A drug can be EMA-authorised yet unavailable/unfunded in Italy
 * or Germany until AIFA / G-BA decide. This block shows what the app KNOWS
 * (EMA + FDA regulatory status) and is explicit that reimbursement/availability
 * are national decisions it does NOT track — with deep-links to check them.
 */

type State = 'yes' | 'pending' | 'no';

const fmt = (val?: string): string => {
  if (!val || !/^\d{4}-\d{2}/.test(val)) return '';
  const d = new Date(val.length === 7 ? `${val}-01` : val);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' });
};

const aifaUrl = (t: string) => `https://www.google.com/search?q=${encodeURIComponent(`AIFA ${t}`)}`;
const gbaUrl = (t: string) => `https://www.google.com/search?q=${encodeURIComponent(`G-BA Nutzenbewertung ${t}`)}`;

const StepIcon: React.FC<{ s: State }> = ({ s }) =>
  s === 'yes' ? (
    <CheckCircle2 size={16} className="text-green-600" />
  ) : s === 'pending' ? (
    <Hourglass size={16} className="text-amber-500" />
  ) : (
    <MinusCircle size={16} className="text-slate-300" />
  );

const Step: React.FC<{ s: State; label: string; detail: string }> = ({ s, label, detail }) => (
  <div className="flex items-center gap-2.5 py-1.5">
    <StepIcon s={s} />
    <span className="text-sm text-slate-700 font-medium w-28 shrink-0">{label}</span>
    <span className={`text-sm ${s === 'no' ? 'text-slate-400' : 'text-slate-800 font-semibold'}`}>{detail}</span>
  </div>
);

const AccessStatus: React.FC<{ data: DrugDetailData }> = ({ data }) => {
  // EU regulatory status
  let eu: { s: State; d: string };
  if (data.expectedDecision) eu = { s: 'pending', d: `Decision expected ~${fmt(data.expectedDecision)}` };
  else if (fmt(data.emaApprovalDate)) eu = { s: 'yes', d: `Authorised ${fmt(data.emaApprovalDate)}` };
  else if (data.emaApprovalDate === 'Not in EMA') eu = { s: 'no', d: 'Not centrally authorised' };
  else eu = { s: 'no', d: '—' };

  // US (FDA) regulatory status
  const us: { s: State; d: string } = fmt(data.approvalDate)
    ? { s: 'yes', d: `Approved ${fmt(data.approvalDate)}` }
    : { s: 'no', d: 'Not shown here' };

  const gbaTerm = data.genericName && data.genericName !== '—' ? data.genericName : data.brandName;

  return (
    <div className="mt-4 pt-4 border-t border-slate-100">
      <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-2 flex items-center">
        <MapPin size={12} className="mr-1" /> Access status
      </p>

      <div className="bg-slate-50 rounded-2xl p-3 border border-slate-100">
        <Step s={eu.s} label="EU (EMA)" detail={eu.d} />
        <Step s={us.s} label="US (FDA)" detail={us.d} />
        {/* Reimbursement / availability are national and NOT tracked here. */}
        <div className="flex items-start gap-2.5 py-1.5 border-t border-slate-200/70 mt-1 pt-2.5">
          <MinusCircle size={16} className="text-slate-300 mt-0.5 shrink-0" />
          <div>
            <span className="text-sm text-slate-700 font-medium">Reimbursement & availability</span>
            <p className="text-[11px] text-slate-500 leading-snug mt-0.5">
              Decided nationally — not tracked in-app. EU authorisation does not
              guarantee a medicine is funded or on the market in your country.
            </p>
          </div>
        </div>
      </div>

      {/* National deep-links to check reimbursement/availability. */}
      <div className="grid grid-cols-2 gap-2 mt-2">
        <a
          href={aifaUrl(data.brandName)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center text-xs font-semibold text-slate-700 bg-slate-50 active:bg-slate-100 rounded-lg py-2.5"
        >
          🇮🇹 Italy · AIFA <ExternalLink size={11} className="ml-1.5" />
        </a>
        <a
          href={gbaUrl(gbaTerm)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center text-xs font-semibold text-slate-700 bg-slate-50 active:bg-slate-100 rounded-lg py-2.5"
        >
          🇩🇪 Germany · G-BA <ExternalLink size={11} className="ml-1.5" />
        </a>
      </div>
    </div>
  );
};

export default AccessStatus;
