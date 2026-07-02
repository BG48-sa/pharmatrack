import React, { useEffect, useState } from 'react';
import { GLOSSARY, GlossaryEntry } from '../services/glossary';
import { X, BookOpen, ExternalLink, ChevronLeft, ChevronRight, Lightbulb } from 'lucide-react';

interface Props {
  /** Open directly on this entry id (e.g. tapped from a badge); omit for the full list. */
  initialId?: string;
  onClose: () => void;
}

const EntryDetail: React.FC<{ entry: GlossaryEntry; onBack?: () => void }> = ({ entry, onBack }) => (
  <div>
    {onBack && (
      <button
        onClick={onBack}
        className="inline-flex items-center gap-1 text-sm font-semibold text-blue-600 active:text-blue-800 mb-3"
      >
        <ChevronLeft size={16} /> All terms
      </button>
    )}
    <h3 className="text-lg font-bold text-slate-900 leading-tight">{entry.term}</h3>
    {entry.abbr && entry.abbr !== entry.term && (
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mt-0.5">{entry.abbr}</p>
    )}
    <p className="text-sm text-slate-700 leading-relaxed mt-3">{entry.body}</p>
    {entry.soWhat && (
      <div className="mt-3 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl p-3">
        <Lightbulb size={15} className="text-amber-500 shrink-0 mt-0.5" />
        <p className="text-[13px] text-amber-900 leading-relaxed">{entry.soWhat}</p>
      </div>
    )}
    {entry.sourceUrl && (
      <a
        href={entry.sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center text-xs font-semibold text-blue-600 active:text-blue-800 mt-3"
      >
        {entry.sourceLabel || 'Learn more'} <ExternalLink size={12} className="ml-1" />
      </a>
    )}
    <p className="text-[10px] text-slate-400 mt-4 leading-snug">
      Simplified summary for orientation only — not legal, regulatory, or medical advice.
      The linked official source is authoritative.
    </p>
  </div>
);

const GlossaryModal: React.FC<Props> = ({ initialId, onClose }) => {
  const [selectedId, setSelectedId] = useState<string | undefined>(initialId);
  const [q, setQ] = useState('');

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

  const selected = selectedId ? GLOSSARY.find((e) => e.id === selectedId) : undefined;
  const query = q.trim().toLowerCase();
  const list = query
    ? GLOSSARY.filter(
        (e) =>
          e.term.toLowerCase().includes(query) ||
          (e.abbr || '').toLowerCase().includes(query) ||
          e.body.toLowerCase().includes(query)
      )
    : GLOSSARY;

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
            <div className="p-2.5 bg-blue-50 rounded-xl text-blue-600 shrink-0">
              <BookOpen size={22} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900 leading-tight">Glossary</h2>
              <p className="text-sm text-slate-500 mt-0.5">Regulatory terms, in plain language</p>
            </div>
          </div>
        </div>

        <div className="px-6 py-4 pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
          {selected ? (
            <EntryDetail entry={selected} onBack={() => setSelectedId(undefined)} />
          ) : (
            <>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Filter terms…"
                className="block w-full mb-3 px-3 py-2.5 bg-slate-100 border-transparent rounded-xl text-slate-900 placeholder-slate-500 focus:outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 sm:text-sm"
                autoCorrect="off"
                autoCapitalize="off"
              />
              <div className="space-y-2">
                {list.map((e) => (
                  <button
                    key={e.id}
                    onClick={() => setSelectedId(e.id)}
                    className="w-full text-left flex items-center justify-between gap-3 bg-white border border-slate-200 rounded-xl px-3 py-3 active:bg-slate-50"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-800 text-sm">{e.term}</div>
                      <div className="text-[12px] text-slate-500 leading-snug mt-0.5 line-clamp-2">{e.body}</div>
                    </div>
                    <ChevronRight size={16} className="text-slate-300 shrink-0" />
                  </button>
                ))}
                {list.length === 0 && (
                  <p className="text-center text-sm text-slate-400 py-8">No terms match “{q}”.</p>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default GlossaryModal;
