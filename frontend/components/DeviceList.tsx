import React, { useEffect, useState } from 'react';
import {
  pmaApprovals,
  clearances510k,
  deviceRecalls,
  DevicePma,
  Device510k,
  DeviceRecall,
} from '../services/deviceService';
import Loader from './Loader';
import {
  BadgeCheck, FileCheck2, AlertTriangle, ExternalLink, Info, Zap,
} from 'lucide-react';

interface Props {
  query: string;
}

type SubView = 'pma' | '510k' | 'recalls';

const fmt = (iso?: string): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' });
};

// Sentence-case the SHOUTING openFDA firm/product strings without touching
// acronyms that are 4 chars or shorter (LLC, GmbH stays as typed, UHD, AID…).
const unshout = (s: string): string =>
  s.replace(/\b[A-Z]{5,}(?:'S)?\b/g, (w) => w.charAt(0) + w.slice(1).toLowerCase());

const cardCls = 'w-full text-left bg-white rounded-2xl shadow-sm border border-slate-200 p-4';
const pillCls = 'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border';

const PmaCard: React.FC<{ d: DevicePma }> = ({ d }) => (
  <a href={d.url} target="_blank" rel="noopener noreferrer" className={`${cardCls} block active:bg-slate-50 transition-colors`}>
    <div className="flex justify-between items-start gap-3">
      <div className="min-w-0">
        <div className="flex items-center flex-wrap gap-2">
          <h3 className="font-bold text-slate-900 text-base leading-tight">{unshout(d.tradeName)}</h3>
          {d.expedited && (
            <span className={`${pillCls} bg-rose-100 text-rose-800 border-rose-200`}>
              <Zap size={10} className="mr-0.5" /> Expedited
            </span>
          )}
        </div>
        {d.genericName && (
          <p className="text-sm text-slate-500 font-medium mt-0.5">{unshout(d.genericName)}</p>
        )}
      </div>
      <div className="text-right shrink-0">
        <div className="text-sm font-bold text-blue-700 leading-none">{fmt(d.decisionDate)}</div>
        <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider mt-1">PMA approval</div>
      </div>
    </div>
    {d.aoStatement && (
      <p className="text-[13px] text-slate-600 mt-2 leading-relaxed line-clamp-3">{d.aoStatement}</p>
    )}
    <div className="flex items-center justify-between mt-2 text-[11px] text-slate-400">
      <span className="truncate">{unshout(d.applicant)}{d.committee ? ` · ${d.committee}` : ''}</span>
      <span className="inline-flex items-center gap-1 shrink-0 ml-2 font-semibold text-blue-600">
        {d.pmaNumber} <ExternalLink size={11} />
      </span>
    </div>
  </a>
);

const K510Card: React.FC<{ d: Device510k }> = ({ d }) => (
  <a href={d.url} target="_blank" rel="noopener noreferrer" className={`${cardCls} block active:bg-slate-50 transition-colors`}>
    <div className="flex justify-between items-start gap-3">
      <div className="min-w-0">
        <div className="flex items-center flex-wrap gap-2">
          <h3 className="font-bold text-slate-900 text-[15px] leading-tight">{unshout(d.deviceName)}</h3>
          {d.deNovo && (
            <span className={`${pillCls} bg-violet-100 text-violet-800 border-violet-200`}>De Novo</span>
          )}
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className="text-sm font-bold text-blue-700 leading-none">{fmt(d.decisionDate)}</div>
        <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider mt-1">
          {d.deNovo ? 'De Novo grant' : '510(k) cleared'}
        </div>
      </div>
    </div>
    <div className="flex items-center justify-between mt-2 text-[11px] text-slate-400">
      <span className="truncate">{unshout(d.applicant)}{d.committee && d.committee !== 'Unknown' ? ` · ${d.committee}` : ''}</span>
      <span className="inline-flex items-center gap-1 shrink-0 ml-2 font-semibold text-blue-600">
        {d.kNumber} <ExternalLink size={11} />
      </span>
    </div>
  </a>
);

const RecallCard: React.FC<{ d: DeviceRecall }> = ({ d }) => {
  const body = (
    <>
      <div className="flex justify-between items-start gap-3">
        <h3 className="font-bold text-slate-900 text-[15px] leading-tight min-w-0">{unshout(d.firm)}</h3>
        <div className="text-right shrink-0">
          <div className="text-sm font-bold text-amber-700 leading-none">{fmt(d.date)}</div>
          <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider mt-1">Recall initiated</div>
        </div>
      </div>
      <p className="text-[13px] text-slate-600 mt-1.5 leading-relaxed line-clamp-3">{unshout(d.product)}</p>
      {(d.rootCause || d.reason) && (
        <p className="text-[12px] text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1 mt-2 line-clamp-2">
          {d.rootCause || d.reason}
        </p>
      )}
    </>
  );
  return d.url ? (
    <a href={d.url} target="_blank" rel="noopener noreferrer" className={`${cardCls} block active:bg-slate-50 transition-colors`}>{body}</a>
  ) : (
    <div className={cardCls}>{body}</div>
  );
};

const SUBS: Array<{ key: SubView; label: string; icon: React.ReactNode }> = [
  { key: 'pma', label: 'PMA', icon: <BadgeCheck size={15} /> },
  { key: '510k', label: '510(k)', icon: <FileCheck2 size={15} /> },
  { key: 'recalls', label: 'Recalls', icon: <AlertTriangle size={15} /> },
];

const BANNERS: Record<SubView, React.ReactNode> = {
  pma: (
    <>
      <strong>Original PMA approvals</strong> — Class III (high-risk) devices such as heart
      valves and implants. The closest device equivalent of a new-drug approval; supplements
      to existing PMAs are excluded. Last 24 months.
    </>
  ),
  '510k': (
    <>
      <strong>510(k) clearances &amp; De Novo grants</strong> — moderate-risk devices cleared
      as substantially equivalent to an existing device, plus De Novo grants for novel
      lower-risk devices. Last 3 months (12 months when searching).
    </>
  ),
  recalls: (
    <>
      <strong>Device recalls</strong> — corrective actions initiated by manufacturers, newest
      first. Last 6 months (24 months when searching).
    </>
  ),
};

const DeviceList: React.FC<Props> = ({ query }) => {
  const [sub, setSub] = useState<SubView>('pma');
  const [pma, setPma] = useState<DevicePma[] | null>(null);
  const [k510, setK510] = useState<Device510k[] | null>(null);
  const [recalls, setRecalls] = useState<DeviceRecall[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const run = async () => {
      try {
        if (sub === 'pma') setPma(await pmaApprovals(query));
        else if (sub === '510k') setK510(await clearances510k(query));
        else setRecalls(await deviceRecalls(query));
      } catch (e: any) {
        if (!cancelled) setError(e.message || 'openFDA request failed.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [sub, query]);

  const items: Array<React.ReactNode> =
    sub === 'pma'
      ? (pma ?? []).map((d) => <PmaCard key={d.pmaNumber} d={d} />)
      : sub === '510k'
        ? (k510 ?? []).map((d) => <K510Card key={d.kNumber} d={d} />)
        : (recalls ?? []).map((d, i) => <RecallCard key={`${d.firm}-${d.date}-${i}`} d={d} />);

  return (
    <div className="px-4">
      {/* PMA | 510(k) | Recalls */}
      <div className="flex bg-slate-100 rounded-xl p-1 mb-3">
        {SUBS.map((s) => (
          <button
            key={s.key}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-semibold rounded-lg transition-colors ${
              sub === s.key ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'
            }`}
            onClick={() => setSub(s.key)}
          >
            {s.icon} {s.label}
          </button>
        ))}
      </div>

      <div className="flex items-start text-[11px] text-slate-600 leading-relaxed mb-3 bg-slate-100 border border-slate-200 rounded-lg p-2">
        <Info size={13} className="mr-1.5 mt-0.5 text-slate-500 shrink-0" />
        <span>{BANNERS[sub]}</span>
      </div>

      <p className="text-[11px] text-slate-400 leading-relaxed mb-3">
        US (FDA) data, live from openFDA. The EU has no queryable device-approval
        register yet — EUDAMED registration became mandatory in May 2026 and an EU
        feed will be added once public coverage matures. Drug–device combination
        medicines (implants, inhalers, pens) already appear on the Europe tab with
        a <span className="font-semibold text-cyan-700">Drug+Device</span> badge.
      </p>

      {loading ? (
        <div className="mt-16"><Loader message="Querying openFDA device databases…" /></div>
      ) : error ? (
        <div className="text-center py-10 px-6">
          <p className="text-slate-700 text-sm font-semibold">openFDA request failed.</p>
          <p className="text-slate-500 text-xs mt-1.5">{error}</p>
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-10 px-6">
          <p className="text-slate-700 text-sm font-semibold">
            {query ? `No ${sub === 'recalls' ? 'recalls' : sub === 'pma' ? 'PMA approvals' : 'clearances'} match “${query}”.` : 'Nothing in this window.'}
          </p>
          <p className="text-slate-500 text-xs mt-1.5 leading-relaxed max-w-xs mx-auto">
            Try the other feeds, a broader term (e.g. the manufacturer), or the specialty
            (“Cardiovascular”, “Orthopedic”, “Radiology”).
          </p>
        </div>
      ) : (
        <div className="space-y-3 animate-in fade-in slide-in-from-bottom-4 duration-500">
          {items}
        </div>
      )}
    </div>
  );
};

export default DeviceList;
