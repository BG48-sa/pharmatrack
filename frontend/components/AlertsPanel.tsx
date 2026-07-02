import React, { useEffect, useMemo, useState } from 'react';
import { pipeline, estimatedDecisionDate, pipelineToDetail } from '../services/emaService';
import { EmaPipelineItem, DrugDetailData } from '../types';
import {
  getPermission,
  requestPermission,
  notificationsSupported,
  PermState,
} from '../services/notifications';
import { getLastRefresh } from '../services/liveData';
import {
  BellRing, X, Plus, Trash2, CalendarClock, WifiOff, Info, Check, Search,
} from 'lucide-react';

interface Props {
  watched: string[];
  onChange: (next: string[]) => void;
  onSelect: (d: DrugDetailData) => void;
  onClose: () => void;
}

// Starting points geared to the user's oncology / advanced-therapy focus.
const SUGGESTIONS = [
  'Multiple myeloma',
  'Multiple sclerosis',
  'Non-small cell lung cancer',
  'Breast cancer',
  "Alzheimer's disease",
  'Haemophilia',
  'Sickle cell disease',
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

const AlertsPanel: React.FC<Props> = ({ watched, onChange, onSelect, onClose }) => {
  const [input, setInput] = useState('');
  const [perm, setPerm] = useState<PermState>('prompt');
  const native = notificationsSupported();

  useEffect(() => {
    getPermission().then(setPerm);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const add = (term: string) => {
    const t = term.trim();
    if (!t) return;
    if (watched.some((w) => w.toLowerCase() === t.toLowerCase())) {
      setInput('');
      return;
    }
    onChange([...watched, t]);
    setInput('');
  };

  const remove = (term: string) => onChange(watched.filter((w) => w !== term));

  const enable = async () => {
    const ok = await requestPermission();
    setPerm(ok ? 'granted' : 'denied');
    if (ok) onChange([...watched]); // re-schedule now that we're allowed
  };

  // Pending EU decisions across all watched indications, de-duped, soonest first.
  const rows = useMemo(() => {
    const seen = new Set<string>();
    const out: EmaPipelineItem[] = [];
    for (const term of watched) {
      for (const m of pipeline(term, 'all')) {
        if (seen.has(m.n)) continue;
        seen.add(m.n);
        out.push(m);
      }
    }
    return out.sort((a, b) =>
      estimatedDecisionDate(a.op) < estimatedDecisionDate(b.op) ? -1 : 1
    );
  }, [watched]);

  const countFor = (term: string): number => pipeline(term, 'all').length;

  const lastRefresh = getLastRefresh();
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 backdrop-blur-sm sm:items-center p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-t-3xl sm:rounded-3xl w-full sm:max-w-md max-h-[90vh] overflow-y-auto shadow-2xl relative animate-in slide-in-from-bottom-4 duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white/90 backdrop-blur-xl px-6 pt-6 pb-3 border-b border-slate-100 z-10">
          <button
            onClick={onClose}
            className="absolute top-5 right-4 p-2 text-slate-400 hover:text-slate-600 bg-slate-50 rounded-full"
            aria-label="Close"
          >
            <X size={18} />
          </button>
          <div className="flex items-center space-x-3 pr-8">
            <div className="p-2.5 bg-indigo-50 rounded-xl text-indigo-600 shrink-0">
              <BellRing size={22} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900 leading-tight">Decision alerts</h2>
              <p className="text-sm text-slate-500 mt-0.5">Reminders for the conditions you follow</p>
            </div>
          </div>
        </div>

        <div className="px-6 py-4 space-y-5 pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
          <p className="text-sm text-slate-600 leading-relaxed">
            Follow a medical indication — e.g. <span className="font-semibold">multiple myeloma</span> —
            and get an on-device reminder a few days before the EU is expected to decide on any
            drug for it (based on the CHMP opinion → EC decision timeline).
          </p>

          {/* Notification permission (native only) */}
          {native ? (
            perm === 'granted' ? (
              <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-xl px-3 py-2">
                <Check size={16} className="shrink-0" /> Notifications are on.
              </div>
            ) : (
              <button
                onClick={enable}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-indigo-600 text-white active:bg-indigo-700 transition-colors"
              >
                <BellRing size={16} /> Enable notifications
              </button>
            )
          ) : (
            <div className="flex items-start gap-2 text-[13px] text-slate-600 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
              <Info size={15} className="shrink-0 mt-0.5 text-slate-400" />
              <span>Your followed conditions are saved here. Reminders are delivered in the DrugRadar iOS app.</span>
            </div>
          )}

          {/* Add an indication */}
          <div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                add(input);
              }}
              className="relative"
            >
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search className="h-5 w-5 text-slate-400" />
              </div>
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Add an indication to follow…"
                className="block w-full pl-10 pr-12 py-2.5 bg-slate-100 border-transparent rounded-xl text-slate-900 placeholder-slate-500 focus:outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500 sm:text-sm"
                autoCorrect="off"
                autoCapitalize="off"
              />
              <button
                type="submit"
                disabled={!input.trim()}
                className="absolute inset-y-0 right-0 pr-2 flex items-center text-indigo-600 disabled:text-slate-300"
                aria-label="Add indication"
              >
                <Plus size={22} />
              </button>
            </form>

            {/* Quick suggestions */}
            <div className="flex flex-wrap gap-2 mt-3">
              {SUGGESTIONS.filter(
                (s) => !watched.some((w) => w.toLowerCase() === s.toLowerCase())
              ).map((s) => (
                <button
                  key={s}
                  onClick={() => add(s)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200 active:bg-slate-200"
                >
                  <Plus size={12} /> {s}
                </button>
              ))}
            </div>
          </div>

          {/* Watched indications */}
          {watched.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                Following ({watched.length})
              </h3>
              <div className="space-y-2">
                {watched.map((term) => {
                  const n = countFor(term);
                  return (
                    <div
                      key={term}
                      className="flex items-center justify-between gap-2 bg-white border border-slate-200 rounded-xl px-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-800 text-sm truncate">{term}</div>
                        <div className="text-[11px] text-slate-400">
                          {n > 0 ? `${n} pending EU decision${n === 1 ? '' : 's'}` : 'no pending EU decisions'}
                        </div>
                      </div>
                      <button
                        onClick={() => remove(term)}
                        className="p-2 text-slate-400 hover:text-red-600 active:bg-slate-100 rounded-full shrink-0"
                        aria-label={`Stop following ${term}`}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Upcoming decisions across watched indications */}
          {rows.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                Upcoming EU decisions
              </h3>
              <div className="space-y-2">
                {rows.map((m) => {
                  const decision = estimatedDecisionDate(m.op);
                  const days = daysFromToday(decision);
                  return (
                    <button
                      key={`${m.n}-${m.op}`}
                      onClick={() => {
                        onSelect(pipelineToDetail(m));
                        onClose();
                      }}
                      className="w-full text-left flex justify-between items-center gap-3 bg-white border border-slate-200 rounded-xl px-3 py-2.5 active:bg-slate-50"
                    >
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-800 text-sm truncate">{m.n}</div>
                        <div className="text-[11px] text-slate-400 truncate">{m.inn || m.sub}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Est. decision</div>
                        <div className="text-sm font-bold text-indigo-700 leading-none mt-0.5">{fmt(decision)}</div>
                        {Number.isFinite(days) && (
                          <div className="text-[11px] text-slate-400 font-semibold mt-1">
                            {days >= 0 ? `~${days} day${days === 1 ? '' : 's'}` : 'imminent'}
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {watched.length === 0 && (
            <div className="text-center py-6 text-sm text-slate-400">
              <CalendarClock className="w-8 h-8 mx-auto mb-2 text-slate-300" />
              Add a condition above to start following EU decisions.
            </div>
          )}

          {/* The reminder pipeline is estimate-based end-to-end — say so here,
              where the user turns it on, not only in the buried footer. */}
          <p className="text-[10px] text-slate-400 leading-snug">
            Decision dates are estimates (≈67 days after the CHMP opinion) and may change or
            not occur; reminders are best-effort, may be delayed or missed, and are not
            official notifications from any authority. Not medical advice.
          </p>

          {/* Data freshness / offline status */}
          <div className="flex items-center gap-1.5 text-[11px] text-slate-400 pt-1">
            {offline ? (
              <>
                <WifiOff size={12} /> Offline — showing saved data
                {lastRefresh ? ` (updated ${fmt(lastRefresh.slice(0, 10))})` : ''}
              </>
            ) : lastRefresh ? (
              <>Data updated {fmt(lastRefresh.slice(0, 10))}</>
            ) : (
              <>Using bundled data</>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AlertsPanel;
