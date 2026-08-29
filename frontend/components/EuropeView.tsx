import React, { useMemo, useState } from 'react';
import {
  recentApprovals,
  pipeline,
  emaGeneratedDate,
  estimatedDecisionDate,
  approvalToDetail,
  pipelineToDetail,
  splitAreas,
  EmaFilter,
} from '../services/emaService';
import { EmaMedicine, EmaPipelineItem, DrugDetailData } from '../types';
import EmaBadges from './EmaBadges';
import { findDiseases, DiseaseEntity } from '../services/diseaseEntities';
import {
  CalendarClock, CheckCircle2, Hourglass, Building2, Sparkles, Info, Star, FlaskConical, BellRing, Pill, ExternalLink, GitCompare,
} from 'lucide-react';

interface Props {
  query: string;
  onSelect: (d: DrugDetailData) => void;
  /** ISO timestamp of the user's previous visit, for "NEW since you last looked". */
  lastVisitISO: string | null;
  /** Jump to the Trials tab pre-searched for the given disease/drug. */
  onSearchTrials: (query: string) => void;
  /** Indications the user already follows for decision alerts. */
  watchedTerms?: string[];
  /** Follow the current indication query for on-device decision reminders. */
  onWatchIndication?: (term: string) => void;
  /** Open the side-by-side comparison for a curated disease drug class. */
  onCompareDisease?: (e: DiseaseEntity) => void;
}

type SubView = 'approved' | 'expected';

const FILTERS: Array<{ key: EmaFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'atmp', label: 'Advanced therapy' },
  { key: 'orphan', label: 'Orphan' },
  { key: 'prime', label: 'PRIME' },
  { key: 'gen', label: 'Generic' },
];

// Official generic-medicine registers (cited when the Generic filter is active).
const GENERIC_REGISTERS = [
  { label: 'EU Community Register', uri: 'https://ec.europa.eu/health/documents/community-register/html/index_en.htm' },
  { label: 'FDA First Generic Approvals', uri: 'https://www.fda.gov/drugs/drug-and-biologic-approval-and-ind-activity-reports/first-generic-drug-approvals' },
];

const fmt = (iso?: string): string => {
  if (!iso) return '—';
  const d = new Date(iso.length === 7 ? `${iso}-01` : iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' });
};

const daysFromToday = (iso: string): number => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return NaN;
  const today = new Date(new Date().toISOString().slice(0, 10));
  return Math.round((d.getTime() - today.getTime()) / 86_400_000);
};

const AreaTags: React.FC<{ area: string }> = ({ area }) => {
  const tags = splitAreas(area).slice(0, 3);
  if (tags.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-2">
      {tags.map((t) => (
        <span key={t} className="inline-flex items-center px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 text-[11px] font-medium">
          {t}
        </span>
      ))}
    </div>
  );
};

const ApprovedCard: React.FC<{ m: EmaMedicine; isNew: boolean; onClick: () => void }> = ({ m, isNew, onClick }) => (
  <button onClick={onClick} className="w-full text-left bg-white rounded-2xl shadow-sm border border-slate-200 p-4 active:bg-slate-50 transition-colors">
    <div className="flex justify-between items-start gap-3">
      <div className="min-w-0">
        <div className="flex items-center flex-wrap gap-2">
          <h3 className="font-bold text-slate-900 text-base leading-tight">{m.n}</h3>
          {isNew && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-green-100 text-green-800 border border-green-200 text-[10px] font-bold uppercase tracking-wider">
              New
            </span>
          )}
        </div>
        <p className="text-sm text-slate-500 font-medium mt-0.5 truncate">{m.inn || m.sub}</p>
      </div>
      <div className="text-right shrink-0">
        <div className="text-sm font-bold text-blue-700 leading-none">{fmt(m.d)}</div>
        <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider mt-1">EU MA</div>
      </div>
    </div>
    <AreaTags area={m.area} />
    <EmaBadges flags={m} className="mt-2" />
  </button>
);

const ExpectedCard: React.FC<{ m: EmaPipelineItem; onClick: () => void }> = ({ m, onClick }) => {
  const decision = estimatedDecisionDate(m.op);
  const days = daysFromToday(decision);
  return (
    <button onClick={onClick} className="w-full text-left bg-white rounded-2xl shadow-sm border border-slate-200 p-4 active:bg-slate-50 transition-colors">
      <div className="flex justify-between items-start gap-3">
        <div className="min-w-0">
          <div className="flex items-center flex-wrap gap-2">
            <h3 className="font-bold text-slate-900 text-base leading-tight">{m.n}</h3>
            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 text-[10px] font-bold uppercase tracking-wider">
              {m.reexam ? 'Re-exam' : 'EC pending'}
            </span>
          </div>
          <p className="text-sm text-slate-500 font-medium mt-0.5 truncate">{m.inn || m.sub}</p>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Est. EC decision</div>
          <div className="text-sm font-bold text-indigo-700 leading-none mt-0.5">{fmt(decision)}</div>
          {Number.isFinite(days) && (
            <div className="text-[11px] text-slate-400 font-semibold mt-1">
              {days >= 0 ? `~${days} day${days === 1 ? '' : 's'}` : 'imminent'}
            </div>
          )}
        </div>
      </div>
      <AreaTags area={m.area} />
      <div className="flex items-center justify-between mt-2">
        <EmaBadges flags={m} />
        <span className="text-[11px] text-slate-400 shrink-0 ml-2">opinion {fmt(m.op)}</span>
      </div>
    </button>
  );
};

const EuropeView: React.FC<Props> = ({ query, onSelect, lastVisitISO, onSearchTrials, watchedTerms, onWatchIndication, onCompareDisease }) => {
  const [sub, setSub] = useState<SubView>('approved');
  const [filter, setFilter] = useState<EmaFilter>('all');

  const q = query.trim();
  const isWatched = !!q && !!watchedTerms?.some((w) => w.toLowerCase() === q.toLowerCase());
  // Curated disease-class matches for the compare card(s). A disease name yields
  // one; a molecular target (e.g. "PD-1", "CD20") can yield several classes.
  const diseases = onCompareDisease ? findDiseases(q) : [];

  const approved = useMemo(() => recentApprovals(query, filter), [query, filter]);
  const expected = useMemo(() => pipeline(query, filter), [query, filter]);
  // Cross-checks used to turn an empty result into guidance instead of a dead-end.
  const approvedUnfiltered = useMemo(() => recentApprovals(query, 'all'), [query]);
  const expectedUnfiltered = useMemo(() => pipeline(query, 'all'), [query]);

  const subTab = (active: boolean) =>
    `flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-semibold rounded-lg transition-colors ${
      active ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'
    }`;

  return (
    <div className="px-4">
      {/* Announce result counts to screen readers as the search/filter changes. */}
      <p className="sr-only" role="status" aria-live="polite">
        {sub === 'approved'
          ? `${approved.length} approved EU medicines shown`
          : `${expected.length} expected EU medicines shown`}
      </p>
      {/* Approved | Expected */}
      <div className="flex bg-slate-100 rounded-xl p-1 mb-3">
        <button className={subTab(sub === 'approved')} onClick={() => setSub('approved')}>
          <CheckCircle2 size={15} /> Approved
        </button>
        <button className={subTab(sub === 'expected')} onClick={() => setSub('expected')}>
          <Hourglass size={15} /> Expected ({pipeline('', 'all').length})
        </button>
      </div>

      {/* Filter chips — Advanced therapy is the CAT remit, surfaced first. */}
      <div className="flex gap-2 overflow-x-auto pb-1 mb-3 hide-scrollbar" style={{ scrollbarWidth: 'none' }}>
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`flex-shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
              filter === f.key
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-slate-100 text-slate-700 border-slate-200 active:bg-slate-200'
            }`}
          >
            {f.key === 'atmp' && <Sparkles size={12} />}
            {f.key === 'prime' && <Star size={12} />}
            {f.key === 'gen' && <Pill size={12} />}
            {f.label}
          </button>
        ))}
      </div>

      {/* Curated disease drug-class comparison(s). One card for a disease name
          (e.g. "CML" -> its six TKIs); several when a molecular target such as
          "PD-1" or "CD20" spans multiple classes. */}
      {diseases.length > 1 && (
        <p className="text-[13px] font-semibold text-emerald-800 mb-2">
          {diseases.length} drug classes match “{q}”
        </p>
      )}
      {onCompareDisease && diseases.map((disease) => (
        <div key={disease.id} className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 mb-3">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-emerald-100 rounded-xl text-emerald-700 shrink-0">
              <GitCompare size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-bold text-slate-900 leading-tight">{disease.name}</h3>
              <p className="text-[13px] text-slate-600 mt-0.5">{disease.cls}</p>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {disease.drugs.map((d) => (
                  <span
                    key={d.b}
                    className="inline-flex items-center px-2 py-0.5 rounded-lg bg-white border border-emerald-200 text-[11px] font-semibold text-slate-700"
                  >
                    {d.b}
                  </span>
                ))}
              </div>
              <button
                onClick={() => onCompareDisease(disease)}
                className="mt-3 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-semibold bg-emerald-600 text-white active:bg-emerald-700 transition-colors"
              >
                <GitCompare size={15} /> Compare all {disease.drugs.length} side by side
              </button>
            </div>
          </div>
        </div>
      ))}

      {/* When filtering to generics, cite the official generic-medicine registers. */}
      {filter === 'gen' && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-3 text-[11px] text-slate-500">
          <span className="font-semibold text-slate-600">Official generics registers:</span>
          {GENERIC_REGISTERS.map((r) => (
            <a
              key={r.uri}
              href={r.uri}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-blue-600 active:text-blue-800 font-medium"
            >
              {r.label} <ExternalLink size={11} className="shrink-0" />
            </a>
          ))}
        </div>
      )}

      {/* Follow this indication for on-device EU decision reminders. */}
      {q && onWatchIndication && (
        isWatched ? (
          <div className="flex items-center gap-1.5 text-xs font-semibold text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2 mb-3">
            <BellRing size={13} className="shrink-0" /> Following “{q}” — you’ll be reminded of EU decisions.
          </div>
        ) : (
          <button
            onClick={() => onWatchIndication(q)}
            className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 mb-3 rounded-lg text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200 active:bg-indigo-100 transition-colors"
          >
            <BellRing size={13} /> Follow “{q}” for EU decision alerts
          </button>
        )
      )}

      {sub === 'approved' ? (
        <>
          <div className="flex items-start text-[11px] text-slate-500 leading-relaxed mb-3">
            <CheckCircle2 size={13} className="mr-1.5 mt-0.5 text-green-600 shrink-0" />
            <span>
              Centrally authorised EU medicines, most recent first. Source: EMA
              medicine data, snapshot {fmt(emaGeneratedDate())}.
            </span>
          </div>
          {approved.length === 0 ? (
            <SmartEmpty
              query={query}
              kind="approved"
              other={expected}
              filterHidingCount={filter !== 'all' ? approvedUnfiltered.length : 0}
              onClearFilter={() => setFilter('all')}
              onShowOther={() => setSub('expected')}
              onSearchTrials={onSearchTrials}
              onSelect={onSelect}
            />
          ) : (
            <div className="space-y-3 animate-in fade-in slide-in-from-bottom-4 duration-500">
              {approved.map((m) => (
                <ApprovedCard
                  key={`${m.n}-${m.d}`}
                  m={m}
                  isNew={!!lastVisitISO && m.d > lastVisitISO.slice(0, 10)}
                  onClick={() => onSelect(approvalToDetail(m))}
                />
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="flex items-start text-[11px] text-slate-600 leading-relaxed mb-3 bg-indigo-50 border border-indigo-200 rounded-lg p-2">
            <Info size={13} className="mr-1.5 mt-0.5 text-indigo-500 shrink-0" />
            <span>
              Medicines <strong>awaiting the European Commission decision</strong> on
              marketing authorisation, which normally follows within ~67 days of the
              CHMP opinion — the estimated date is shown on each card.
            </span>
          </div>
          {expected.length === 0 ? (
            <SmartEmpty
              query={query}
              kind="expected"
              other={approved}
              filterHidingCount={filter !== 'all' ? expectedUnfiltered.length : 0}
              onClearFilter={() => setFilter('all')}
              onShowOther={() => setSub('approved')}
              onSearchTrials={onSearchTrials}
              onSelect={onSelect}
            />
          ) : (
            <div className="space-y-3 animate-in fade-in slide-in-from-bottom-4 duration-500">
              {expected.map((m) => (
                <ExpectedCard key={`${m.n}-${m.op}`} m={m} onClick={() => onSelect(pipelineToDetail(m))} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};

// An empty result is a signal, not a dead-end. When a disease has no EU match
// we say so plainly, then route the user to whatever *might* help: the other
// EMA list (pending opinions / authorised), a hidden filter, or clinical trials.
//
// The most common — and most misleading — case is searching the Approved list
// for a medicine that has just cleared CHMP: the press coverage says "EMA
// recommends approval", but the EU marketing authorisation only exists once the
// Commission decides. Rather than report a bare "no match" we name the medicine,
// give its opinion date and the estimated EC decision, and show the card itself.
const SmartEmpty: React.FC<{
  query: string;
  kind: 'approved' | 'expected';
  /** Matches for the same query in the OTHER list — the actual records, so we can name them. */
  other: Array<EmaMedicine | EmaPipelineItem>;
  filterHidingCount: number;
  onClearFilter: () => void;
  onShowOther: () => void;
  onSearchTrials: (q: string) => void;
  onSelect: (d: DrugDetailData) => void;
}> = ({ query, kind, other, filterHidingCount, onClearFilter, onShowOther, onSearchTrials, onSelect }) => {
  const q = query.trim();
  const otherCount = other.length;
  // Searching Approved, but the query DOES match one or more pending opinions.
  const pendingHit = kind === 'approved' && otherCount > 0;
  const pending = pendingHit ? (other as EmaPipelineItem[]) : [];
  const first = pending[0];

  const headline = !q
    ? kind === 'approved' ? 'No authorised medicines.' : 'No pending EU decisions.'
    : pendingHit
      ? `Not authorised in the EU yet — but a decision is pending.`
      : kind === 'approved'
        ? `No EU-authorised medicine matches “${q}”.`
        : `No pending EU decision matches “${q}”.`;

  const btn = 'w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors';

  // The named explanation for the "just got a CHMP opinion" case.
  const explain = pendingHit ? (
    pending.length === 1 ? (
      <>
        <strong>{first.n}</strong>
        {first.inn ? ` (${first.inn})` : ''} received a <strong>positive CHMP opinion</strong> on{' '}
        {fmt(first.op)}. That is a recommendation, not an authorisation — the European
        Commission decision that actually grants the EU marketing authorisation is
        expected around <strong>{fmt(estimatedDecisionDate(first.op))}</strong>.
      </>
    ) : (
      <>
        {pending.length} medicines matching “{q}” hold a <strong>positive CHMP opinion</strong> and
        are awaiting the European Commission decision that grants the EU marketing
        authorisation. A CHMP opinion is a recommendation, not an authorisation.
      </>
    )
  ) : q ? (
    <>
      This searches the official EMA catalogue — an empty result usually means no
      centrally authorised EU medicine carries this indication yet. Older medicines
      approved nationally (e.g. by AIFA in Italy or BfArM in Germany) are not in the
      EMA catalogue — check your national medicines register.
    </>
  ) : null;

  return (
    <div className={pendingHit ? 'py-4' : 'text-center py-10 px-6'}>
      <div className={pendingHit ? 'text-center' : ''}>
        <div
          className={`w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3 ${
            pendingHit ? 'bg-indigo-100' : 'bg-slate-100'
          }`}
        >
          {pendingHit ? (
            <Hourglass className="text-indigo-600 w-7 h-7" />
          ) : (
            <CalendarClock className="text-slate-400 w-7 h-7" />
          )}
        </div>
        <p className="text-slate-700 text-sm font-semibold">{headline}</p>
        {explain && (
          <p className={`text-slate-600 text-xs mt-1.5 leading-relaxed mx-auto ${pendingHit ? 'max-w-sm' : 'max-w-xs text-slate-500'}`}>
            {explain}
          </p>
        )}
      </div>

      {/* Show the pending medicine(s) themselves — tappable, same card as the
          Expected tab, so the answer is here rather than one navigation away. */}
      {pendingHit && (
        <div className="space-y-3 mt-4">
          {pending.slice(0, 3).map((m) => (
            <ExpectedCard key={`${m.n}-${m.op}`} m={m} onClick={() => onSelect(pipelineToDetail(m))} />
          ))}
        </div>
      )}

      <div className={`mt-5 space-y-2 mx-auto ${pendingHit ? 'max-w-sm' : 'max-w-xs'}`}>
        {filterHidingCount > 0 && (
          <button onClick={onClearFilter} className={`${btn} bg-amber-100 text-amber-800 active:bg-amber-200`}>
            Clear filter — {filterHidingCount} hidden match{filterHidingCount === 1 ? '' : 'es'}
          </button>
        )}
        {otherCount > (pendingHit ? 3 : 0) && (
          <button onClick={onShowOther} className={`${btn} bg-indigo-100 text-indigo-700 active:bg-indigo-200`}>
            {kind === 'approved'
              ? pendingHit
                ? `See all ${otherCount} pending EU decisions →`
                : `${otherCount} expected (EC decision pending) →`
              : `${otherCount} already authorised →`}
          </button>
        )}
        {q && (
          <button onClick={() => onSearchTrials(q)} className={`${btn} bg-blue-600 text-white active:bg-blue-700`}>
            <FlaskConical size={15} /> Search clinical trials for “{q}”
          </button>
        )}
      </div>
    </div>
  );
};

export default EuropeView;
