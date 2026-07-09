import React, { useEffect } from 'react';
import {
  X, Search, Bell, Pill, GitCompare, BookOpen, WifiOff, Compass,
  Bookmark, CalendarPlus, StickyNote, Share2, LayoutGrid,
} from 'lucide-react';

// First-run feature guide. Auto-shown once (key dr_welcome_seen in App.tsx),
// reopenable any time from the header help button. Sits BELOW the disclaimer
// gate (z-100), so on a fresh install accepting the disclaimer reveals it.

interface Props {
  onClose: () => void;
  onOpenAlerts: () => void;
  onOpenGlossary: () => void;
}

const Section: React.FC<{
  icon: React.ReactNode;
  tint: string;
  title: string;
  children: React.ReactNode;
}> = ({ icon, tint, title, children }) => (
  <div className="flex gap-3">
    <div className={`p-2 rounded-xl shrink-0 self-start ${tint}`}>{icon}</div>
    <div className="min-w-0">
      <h3 className="text-sm font-bold text-slate-800">{title}</h3>
      <div className="text-[13px] leading-relaxed text-slate-600 mt-0.5">{children}</div>
    </div>
  </div>
);

const Inline: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="inline-flex items-baseline align-baseline mx-0.5 text-slate-700">{children}</span>
);

const WelcomeGuide: React.FC<Props> = ({ onClose, onOpenAlerts, onOpenGlossary }) => {
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
      className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-900/40 backdrop-blur-sm sm:items-center p-0 sm:p-4"
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
            <div className="p-2.5 bg-blue-50 rounded-xl text-blue-600 shrink-0">
              <Compass size={22} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900 leading-tight">What you can do here</h2>
              <p className="text-sm text-slate-500 mt-0.5">A quick tour of DrugRadar</p>
            </div>
          </div>
        </div>

        <div className="px-6 py-5 space-y-5 pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
          <Section
            icon={<Search size={18} />}
            tint="bg-blue-50 text-blue-600"
            title="Browse & search five registers"
          >
            <strong>Europe</strong> — every centrally authorised EU medicine plus the pipeline of
            drugs awaiting an EU decision. <strong>Novel</strong> — recent first-in-class FDA
            approvals. <strong>US</strong> — the full FDA approvals database and upcoming PDUFA
            decision dates. <strong>Trials</strong> — live ClinicalTrials.gov searches.{' '}
            <strong>Critical</strong> — the EU critical-medicines list. Tap a therapeutic-area
            chip for a one-tap search, and filter the EU list by Advanced therapy, Orphan, PRIME,
            or Generic. US data is queried live from the FDA; the EU dataset refreshes once a
            week, so newly approved drugs appear within about a week.
          </Section>

          <Section
            icon={<Bell size={18} />}
            tint="bg-indigo-50 text-indigo-600"
            title="Follow indications, not just drugs"
          >
            Follow a condition — e.g. <em>multiple myeloma</em> — and get an on-device reminder
            before the EU is expected to decide on <em>any</em> drug for it, including ones that
            enter the pipeline later.
            <button
              onClick={onOpenAlerts}
              className="block mt-1.5 text-[13px] font-semibold text-indigo-600 active:text-indigo-800"
            >
              Open decision alerts →
            </button>
          </Section>

          <Section
            icon={<Pill size={18} />}
            tint="bg-emerald-50 text-emerald-600"
            title="Tap any medicine for the full picture"
          >
            At-a-glance facets parsed from the indication (biomarker, line of therapy, setting),
            the EU + US regulatory status ladder, links to the official EMA / FDA pages, private
            notes <Inline><StickyNote size={13} className="self-center" /></Inline> that never
            leave your device, a share summary{' '}
            <Inline><Share2 size={13} className="self-center" /></Inline>, and a one-tap Phase 3
            trials search for the same molecule.
          </Section>

          <Section
            icon={<GitCompare size={18} />}
            tint="bg-sky-50 text-sky-600"
            title="Compare drugs — down to the full label"
          >
            Add two medicines to the compare tray for a side-by-side overview, or open the
            <strong> full-text label comparison</strong>: EU SmPC and US Prescribing Information,
            section by section (indications, posology, warnings, adverse reactions…). For the same
            molecule you can flip a column between the EU and US label — US-only sections like the
            Boxed Warning are called out.
          </Section>

          <Section
            icon={<BookOpen size={18} />}
            tint="bg-amber-50 text-amber-600"
            title="Decode the jargon"
          >
            Tap any badge — ORPHAN, PRIME, Biosimilar, 351(k)… — or the book icon in the header
            for a plain-language explanation with the official source.
            <button
              onClick={onOpenGlossary}
              className="block mt-1.5 text-[13px] font-semibold text-amber-600 active:text-amber-800"
            >
              Open the glossary →
            </button>
          </Section>

          <Section
            icon={<WifiOff size={18} />}
            tint="bg-slate-100 text-slate-600"
            title="Works offline"
          >
            The full catalogue and label library are stored on the device — search, browse, and
            compare complete labels with no connection, even in airplane mode.
          </Section>

          <Section
            icon={<LayoutGrid size={18} />}
            tint="bg-cyan-50 text-cyan-600"
            title="See what's next on your home screen"
          >
            Add the DrugRadar widget (long-press the home screen → Add Widget) to see the next
            expected EU decisions for your followed indications at a glance, without opening the
            app.
          </Section>

          <Section
            icon={<CalendarPlus size={18} />}
            tint="bg-rose-50 text-rose-600"
            title="Put decision dates in your calendar"
          >
            In the decision-alerts panel, tap{' '}
            <Inline><CalendarPlus size={13} className="self-center" /></Inline> next to any
            upcoming EU decision — or "Add all" — to export it as a calendar event with a
            reminder three days ahead. The event itself notes the date is an estimate.
          </Section>

          <Section
            icon={<Bookmark size={18} />}
            tint="bg-violet-50 text-violet-600"
            title="Save your searches"
          >
            Tap the <Inline><Bookmark size={13} className="self-center" /></Inline> bookmark in
            the search field to save the current search. Saved searches appear as chips under the
            search bar — separately on each tab — and re-run with one tap.
          </Section>

          <Section
            icon={<Search size={18} />}
            tint="bg-teal-50 text-teal-600"
            title="Find drugs from your home screen"
          >
            Every EU medicine is indexed in the iOS system search: swipe down on the home screen,
            type a drug or substance name, and jump straight to its detail page in DrugRadar.
          </Section>

          <p className="text-[10px] text-slate-400 leading-snug border-t border-slate-100 pt-3">
            DrugRadar is for informational purposes only — not medical advice and not a clinical
            decision-support tool. Data may be incomplete or out of date; always verify against
            the current official EMA SmPC / FDA label.
          </p>

          <button
            onClick={onClose}
            className="w-full py-3 bg-blue-600 text-white font-semibold rounded-xl active:bg-blue-700 transition-colors"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
};

export default WelcomeGuide;
