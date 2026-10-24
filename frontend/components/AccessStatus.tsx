import React from 'react';
import { DrugDetailData } from '../types';
import { describeUsApproval, US_COVERAGE_NOTE } from '../services/usApproval';
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

const search = (q: string) => `https://www.google.com/search?q=${encodeURIComponent(q)}`;
const aifaUrl = (t: string) => search(`AIFA ${t}`);
const gbaUrl = (t: string) => search(`G-BA Nutzenbewertung ${t}`);
// EU HTA Regulation (EU) 2021/2282: joint clinical assessments (JCA) started on
// 12 January 2025 for oncology medicines and ATMPs — the EU-level dossier that
// national HTA bodies build on. Reports are published on the Commission's HTA
// pages; a web search by substance finds the JCA / its scoping.
const jcaUrl = (t: string) => search(`EU HTA joint clinical assessment JCA ${t}`);
const hasUrl = (t: string) => search(`HAS avis commission de la transparence ${t}`);
const aempsUrl = (t: string) => search(`AEMPS informe de posicionamiento terapéutico ${t}`);
const niceUrl = (t: string) => `https://www.nice.org.uk/search?q=${encodeURIComponent(t)}`;

const LINKS: { label: string; url: (t: string) => string; byBrand?: boolean; wide?: boolean }[] = [
  { label: '🇪🇺 EU HTA · joint clinical assessment', url: jcaUrl, wide: true },
  { label: '🇮🇹 Italy · AIFA', url: aifaUrl, byBrand: true },
  { label: '🇩🇪 Germany · G-BA', url: gbaUrl },
  { label: '🇫🇷 France · HAS', url: hasUrl },
  { label: '🇪🇸 Spain · AEMPS', url: aempsUrl },
  { label: '🇬🇧 UK · NICE', url: niceUrl, wide: true },
];

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
  else if (data.statusNote && !/^Conditional MA converted/.test(data.statusNote)) eu = { s: 'no', d: data.statusNote.replace(/ (\d{4}-\d{2}-\d{2})$/, (_, d) => ` ${fmt(d)}`) };
  else if (data.emaApprovalDate && /^Same substance/.test(data.emaApprovalDate)) eu = { s: 'no', d: `${data.emaApprovalDate} — not this product` };
  else if (fmt(data.emaApprovalDate)) eu = { s: 'yes', d: `Authorised ${fmt(data.emaApprovalDate)}` };
  else if (data.emaApprovalDate === 'Not in EMA') eu = { s: 'no', d: 'Not centrally authorised' };
  else eu = { s: 'no', d: '—' };

  // US (FDA) regulatory status. EU-sourced records carry the FDA side from the
  // offline US snapshots (services/usApproval.ts). A missing record is NOT
  // "not approved" — the note under the row says what the snapshots cover.
  const usInfo = describeUsApproval(data.approvalDate, fmt);
  const us: { s: State; d: string } = { s: usInfo.state === 'approved' ? 'yes' : 'no', d: usInfo.text };

  const gbaTerm = data.genericName && data.genericName !== '—' ? data.genericName : data.brandName;

  return (
    <div className="mt-4 pt-4 border-t border-slate-100">
      <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-2 flex items-center">
        <MapPin size={12} className="mr-1" /> Access status
      </p>

      <div className="bg-slate-50 rounded-2xl p-3 border border-slate-100">
        <Step s={eu.s} label="EU (EMA)" detail={eu.d} />
        <Step s={us.s} label="US (FDA)" detail={us.d} />
        {usInfo.state === 'none' && (
          <p className="text-[11px] text-slate-500 leading-snug pl-[26px] -mt-0.5 pb-1.5">{US_COVERAGE_NOTE}</p>
        )}
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

      {/* HTA / reimbursement deep-links: the EU joint clinical assessment first,
          then the national bodies (Italy, Germany, France, Spain, UK). */}
      <div className="grid grid-cols-2 gap-2 mt-2">
        {LINKS.map((l) => (
          <a
            key={l.label}
            href={l.url(l.byBrand ? data.brandName : gbaTerm)}
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-flex items-center justify-center text-xs font-semibold text-slate-700 bg-slate-50 active:bg-slate-100 rounded-lg py-2.5${l.wide ? ' col-span-2' : ''}`}
          >
            {l.label} <ExternalLink size={11} className="ml-1.5" />
          </a>
        ))}
      </div>
    </div>
  );
};

export default AccessStatus;
