import React, { useEffect, useRef, useState } from 'react';
import { getNote, setNote } from '../services/notes';
import { NotebookPen, Check } from 'lucide-react';

/**
 * Private, on-device note for one drug. Autosaves (debounced) to Capacitor
 * Preferences via services/notes. Reloads when `noteKey` changes so the same
 * mounted component can follow whichever drug is shown in the detail pane.
 */
const DrugNotes: React.FC<{ noteKey: string }> = ({ noteKey }) => {
  const [text, setText] = useState('');
  const [saved, setSaved] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest unsaved edit, so closing the sheet (or switching drugs) inside the
  // debounce window still persists it instead of dropping the keystrokes.
  const pending = useRef<{ key: string; text: string } | null>(null);

  // Load the stored note whenever the drug changes; flush any unsaved edit for
  // the previous drug first.
  useEffect(() => {
    let active = true;
    setLoaded(false);
    getNote(noteKey).then((t) => {
      if (!active) return;
      setText(t);
      setSaved(!!t);
      setLoaded(true);
    });
    return () => {
      active = false;
      if (timer.current) clearTimeout(timer.current);
      if (pending.current) {
        setNote(pending.current.key, pending.current.text);
        pending.current = null;
      }
    };
  }, [noteKey]);

  const onChange = (v: string) => {
    setText(v);
    setSaved(false);
    pending.current = { key: noteKey, text: v };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      pending.current = null;
      setNote(noteKey, v).then(() => setSaved(true));
    }, 500);
  };

  return (
    <div className="mt-4 pt-4 border-t border-slate-100">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold flex items-center">
          <NotebookPen size={12} className="mr-1" /> My notes
        </p>
        {loaded && text.trim() !== '' && (
          <span
            className={`inline-flex items-center gap-1 text-[11px] font-medium ${
              saved ? 'text-green-600' : 'text-slate-400'
            }`}
          >
            {saved ? (
              <>
                <Check size={12} /> Saved
              </>
            ) : (
              'Saving…'
            )}
          </span>
        )}
      </div>
      <textarea
        value={text}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Private note — e.g. “discuss at tumour board”, “check SmPC dosing”, “relevant for CAR-T pathway”."
        rows={3}
        className="block w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-800 placeholder-slate-400 leading-relaxed focus:outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
      />
      <p className="text-[10px] text-slate-400 mt-1.5 leading-snug">
        Stored only on this device — never uploaded.
      </p>
    </div>
  );
};

export default DrugNotes;
