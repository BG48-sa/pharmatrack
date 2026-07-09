import React, { useEffect, useState } from 'react';
import { ShieldAlert, ExternalLink } from 'lucide-react';
import { storeGet, storeSet } from '../services/storage';

// Blocking disclaimer the user must accept before using the app. Acceptance
// expires: it is re-required every 30 days, and immediately whenever VERSION
// changes (bump it when the disclaimer text materially changes). Stored as
// "<version>|<ISO timestamp>".
const KEY = 'dr_disclaimer_accepted';
const VERSION = '2026-07-04';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const isFresh = (stored: string | null): boolean => {
  if (!stored) return false;
  const [version, ts] = stored.split('|');
  if (version !== VERSION || !ts) return false;
  const age = Date.now() - new Date(ts).getTime();
  return Number.isFinite(age) && age >= 0 && age < MAX_AGE_MS;
};

const DisclaimerGate: React.FC = () => {
  // null = still checking; true = accepted recently; false = must accept.
  const [accepted, setAccepted] = useState<boolean | null>(null);

  useEffect(() => {
    storeGet(KEY).then((v) => setAccepted(isFresh(v))).catch(() => setAccepted(false));
  }, []);

  useEffect(() => {
    if (accepted === true) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [accepted]);

  // Show the gate whenever it is not confirmed-accepted (covers the app during
  // the brief async check so first-run users never reach the app first).
  if (accepted === true) return null;

  const accept = () => {
    storeSet(KEY, `${VERSION}|${new Date().toISOString()}`);
    setAccepted(true);
  };

  const Bullet: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <li className="flex gap-2">
      <span className="text-amber-500 shrink-0 mt-px">•</span>
      <span>{children}</span>
    </li>
  );

  return (
    <div className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white rounded-t-3xl sm:rounded-3xl w-full sm:max-w-lg max-h-[92vh] overflow-y-auto shadow-2xl flex flex-col">
        <div className="px-6 pt-7 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-amber-50 rounded-xl text-amber-600 shrink-0"><ShieldAlert size={22} /></div>
            <div>
              <h2 className="text-xl font-bold text-slate-900 leading-tight">Before you continue</h2>
              <p className="text-sm text-slate-500 mt-0.5">Please read and accept</p>
            </div>
          </div>

          <div className="mt-4 space-y-3 text-[13px] leading-relaxed text-slate-600">
            <p>
              <strong className="text-slate-800">DrugRadar is for information only — it is not medical
              advice.</strong> It is a reference aid for healthcare professionals and others following
              drug-regulatory developments.
            </p>
            <ul className="space-y-2 list-none">
              <Bullet>
                It is <strong className="text-slate-700">not a clinical decision-support tool</strong> and
                not a substitute for professional judgment or the official product information. Do not use
                it to diagnose, treat, prescribe, or make any dosing decision.
              </Bullet>
              <Bullet>
                Data and extracted label text may be <strong className="text-slate-700">incomplete, out of
                date, or wrong</strong>. Always verify against the current official EMA SmPC or FDA label.
              </Bullet>
              <Bullet>
                The EU SmPC and the US label are <strong className="text-slate-700">distinct documents</strong>,
                each valid only in its own jurisdiction — they are not interchangeable.
              </Bullet>
              <Bullet>
                Not for use in a medical emergency. Any clinical decision is the
                <strong className="text-slate-700"> sole responsibility of the treating professional</strong>.
              </Bullet>
              <Bullet>
                Independent project — <strong className="text-slate-700">not affiliated with the FDA, EMA,
                or U.S. National Library of Medicine</strong>. Provided “as is”, without warranty of any
                kind; used entirely at your own risk.
              </Bullet>
            </ul>
            <a
              href="privacy.html"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-blue-600 font-medium active:text-blue-800"
            >
              Read the full disclaimer &amp; privacy policy <ExternalLink size={12} className="shrink-0" />
            </a>
          </div>
        </div>

        <div className="sticky bottom-0 bg-white/95 backdrop-blur px-6 py-4 border-t border-slate-100 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
          <button
            onClick={accept}
            className="w-full py-3.5 bg-blue-600 text-white font-semibold rounded-xl active:bg-blue-700 transition-colors"
          >
            I understand and accept
          </button>
        </div>
      </div>
    </div>
  );
};

export default DisclaimerGate;
