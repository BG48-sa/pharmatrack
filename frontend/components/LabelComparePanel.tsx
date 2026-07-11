import React, { useEffect, useState } from 'react';
import { X, FileText, ExternalLink, ChevronDown, Loader2 } from 'lucide-react';

/**
 * Jurisdiction-aware full-text label comparison. Each column is a medicine's
 * label from a given jurisdiction — the EU Summary of Product Characteristics
 * (SmPC) or the US Prescribing Information (USPI, from openFDA). Rows are aligned
 * by a section map so like-for-like clinical content lines up across both the
 * two-drug EU comparison and the same-molecule EU-vs-US comparison. All data is
 * bundled, so it works fully offline.
 */
type Src = 'eu' | 'us';
export interface LabelColumn { slug: string; source: Src }
interface SectionData { title?: string; text?: string; tables?: string[]; missing?: boolean }
interface LabelDoc { slug: string; brand: string; inn: string; usBrand?: string; url?: string; dailymed?: string; sections: Record<string, SectionData> }

interface Props {
  columns: LabelColumn[];
  onClose: () => void;
  /** Whether a given medicine has a label in a given jurisdiction (enables the EU/US toggle). */
  available?: (slug: string, source: Src) => boolean;
}

const REMOTE = 'https://bg48-sa.github.io/pharmatrack/data/';
const dir = (s: Src) => (s === 'eu' ? 'smpc' : 'uspi');

// Section map: each row pulls a different section key per jurisdiction. `null`
// = that jurisdiction's label has no equivalent section (shown explicitly).
const ROWS: { label: string; note?: string; keys: Record<Src, string | null> }[] = [
  { label: 'Indications', keys: { eu: '4.1', us: 'indications' } },
  { label: 'Dosage & administration', keys: { eu: '4.2', us: 'dosage' } },
  { label: 'Contraindications', keys: { eu: '4.3', us: 'contraindications' } },
  { label: 'Boxed warning', note: 'US labels only', keys: { eu: null, us: 'boxed_warning' } },
  { label: 'Warnings & precautions', keys: { eu: '4.4', us: 'warnings' } },
  { label: 'Adverse reactions', keys: { eu: '4.8', us: 'adverse_reactions' } },
  { label: 'Use in specific populations', note: 'US labels only', keys: { eu: null, us: 'specific_populations' } },
  { label: 'Mechanism / pharmacodynamics', keys: { eu: '5.1', us: 'mechanism' } },
  { label: 'Pharmacokinetics', keys: { eu: '5.2', us: 'pharmacokinetics' } },
];

const COLLAPSED_PX = 260;

async function loadDoc(col: LabelColumn): Promise<LabelDoc | null> {
  const path = `data/${dir(col.source)}/${col.slug}.json`;
  for (const url of [`${import.meta.env.BASE_URL}${path}`, REMOTE + path.slice(5)]) {
    try { const r = await fetch(url); if (r.ok) return await r.json(); } catch { /* next */ }
  }
  return null;
}

// A table line is one with ≥2 multi-space runs (aligned columns from pdftotext,
// EU side); such runs render monospace so alignment survives.
const isTabularLine = (l: string): boolean => (l.match(/ {2,}/g) || []).length >= 2;

const renderText = (raw: string): React.ReactNode[] => {
  // U+F0B7 is a Symbol-font bullet from the source PDFs with no glyph in normal
  // fonts (renders as a tofu box) — map it to a real bullet.
  const text = raw.replace(//g, '•');
  const segs: { table: boolean; lines: string[] }[] = [];
  for (const line of text.split('\n')) {
    const table = isTabularLine(line);
    const last = segs[segs.length - 1];
    if (last && last.table === table) last.lines.push(line);
    else segs.push({ table, lines: [line] });
  }
  return segs.map((seg, i) => {
    // Only a BLOCK of ≥2 aligned lines is a real table; a lone "tabular" line is
    // just narrative with stray indentation gaps — render it as prose with the
    // extra spacing collapsed so it reads normally.
    if (seg.table && seg.lines.length >= 2) {
      return <pre key={i} className="overflow-x-auto whitespace-pre font-mono text-[11px] leading-relaxed text-slate-700 my-1 bg-slate-50 rounded-md px-2 py-1.5">{seg.lines.join('\n')}</pre>;
    }
    const prose = seg.lines.map((l) => l.replace(/ {2,}/g, ' ')).join('\n');
    return <p key={i} className="whitespace-pre-wrap text-[12px] leading-relaxed text-slate-700 my-1">{prose}</p>;
  });
};

const SectionCell: React.FC<{ section?: SectionData; absent?: boolean; expanded: boolean }> = ({ section, absent, expanded }) => {
  if (absent) return <p className="text-[11px] italic text-slate-300">Not a section of this label.</p>;
  if (!section || section.missing || (!section.text && !section.tables?.length)) {
    return <p className="text-[12px] italic text-slate-400">Not stated in this label.</p>;
  }
  return (
    <div className="relative min-w-0" style={expanded ? undefined : { maxHeight: COLLAPSED_PX, overflow: 'hidden' }}>
      {section.text ? renderText(section.text) : null}
      {section.tables?.map((html, i) => (
        <div key={i} className="uspi-table overflow-x-auto my-1.5" dangerouslySetInnerHTML={{ __html: html }} />
      ))}
      {!expanded && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-white to-transparent" />}
    </div>
  );
};

const LabelComparePanel: React.FC<Props> = ({ columns, onClose, available }) => {
  // Columns are internal state so each can be toggled between EU / US in place.
  const [cols, setCols] = useState<LabelColumn[]>(columns);
  const [docs, setDocs] = useState<(LabelDoc | null)[] | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  // (Re)load whenever the set of columns changes (initial mount or a toggle).
  useEffect(() => { setDocs(null); Promise.all(cols.map(loadDoc)).then(setDocs); }, [cols]);

  const setColSource = (i: number, source: Src) =>
    setCols((prev) => (prev[i].source === source ? prev : prev.map((c, j) => (j === i ? { ...c, source } : c))));

  const bothLoaded = docs && docs.every(Boolean);
  const sameMolecule = cols.length === 2 && cols[0].slug === cols[1].slug;
  const crossJurisdiction = sameMolecule && cols[0].source !== cols[1].source;
  // Hide rows with no content in ANY present column's jurisdiction.
  const rows = ROWS.filter((r) => cols.some((c) => r.keys[c.source]));
  // With more than two columns (a whole drug class), give each a readable min
  // width and let the aligned grid scroll horizontally instead of squishing.
  const many = cols.length > 2;
  const colTmpl = many ? 'minmax(13rem, 1fr)' : '1fr';
  const gridCols = `9rem ${cols.map(() => colTmpl).join(' ')}`;
  const minWidth = many ? `${9 + cols.length * 13}rem` : undefined;

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/40 backdrop-blur-sm sm:items-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white rounded-t-3xl sm:rounded-3xl w-full sm:max-w-5xl max-h-[92vh] overflow-y-auto shadow-2xl relative animate-in slide-in-from-bottom-4 duration-300" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white/90 backdrop-blur-xl px-5 pt-6 pb-3 border-b border-slate-100 z-10">
          <button onClick={onClose} className="absolute top-5 right-4 p-2 text-slate-400 hover:text-slate-600 bg-slate-50 rounded-full" aria-label="Close"><X size={18} /></button>
          <div className="flex items-center space-x-3 pr-8">
            <div className="p-2.5 bg-sky-50 rounded-xl text-sky-600 shrink-0"><FileText size={22} /></div>
            <div>
              <h2 className="text-xl font-bold text-slate-900 leading-tight">{crossJurisdiction ? 'EU vs US label' : 'Label comparison'}</h2>
              <p className="text-sm text-slate-500 mt-0.5">{crossJurisdiction ? 'Same medicine — EU SmPC vs US Prescribing Information' : 'Full label sections, side by side'}</p>
            </div>
          </div>
        </div>

        <div className="px-5 py-4 pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
          {!docs && <div className="flex items-center justify-center py-16 text-slate-400"><Loader2 className="animate-spin mr-2" size={20} /> Loading label sections…</div>}
          {docs && !bothLoaded && (
            <p className="text-sm text-slate-500 py-10 text-center leading-relaxed">The full label isn’t available for one of these medicines yet. Coverage is being extended — please try again later.</p>
          )}
          {bothLoaded && (
            <>
              <div className="overflow-x-auto -mx-1 px-1">
              <div style={{ minWidth }}>
              <div className="grid gap-3 items-end" style={{ gridTemplateColumns: gridCols }}>
                <div className="text-[10px] text-slate-400 self-end pb-1">Tap EU / US to switch each label</div>
                {docs!.map((d, i) => (
                  <div key={i} className="bg-slate-50 border border-slate-200 rounded-xl p-2.5 min-w-0">
                    <div className="font-bold text-slate-900 text-sm leading-tight truncate">{cols[i].source === 'us' ? (d!.usBrand || d!.brand) : d!.brand}</div>
                    <div className="text-[11px] text-slate-500 font-medium truncate">{d!.inn}</div>
                    <div className="mt-1.5 inline-flex rounded-md border border-slate-200 overflow-hidden">
                      {(['eu', 'us'] as Src[]).map((s) => {
                        const active = cols[i].source === s;
                        const usable = active || !available || available(cols[i].slug, s);
                        return (
                          <button
                            key={s}
                            disabled={!usable}
                            onClick={() => usable && setColSource(i, s)}
                            className={`px-2 py-0.5 text-[10px] font-bold tracking-wide transition-colors ${
                              active ? 'bg-sky-600 text-white' : usable ? 'bg-white text-sky-600 active:bg-sky-50' : 'bg-slate-50 text-slate-300 cursor-not-allowed'
                            }`}
                            title={s === 'eu' ? 'EU SmPC' : usable ? 'US Prescribing Information' : 'No US label for this medicine'}
                          >
                            {s.toUpperCase()}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              {rows.map((row) => (
                <div key={row.label} className="grid gap-3 py-3 border-t border-slate-100" style={{ gridTemplateColumns: gridCols }}>
                  <div className="pt-0.5 min-w-0">
                    <div className="text-[13px] font-bold text-slate-700 leading-tight">{row.label}</div>
                    {row.note && <div className="text-[10px] text-slate-400 mt-0.5">{row.note}</div>}
                    <button onClick={() => setExpanded((e) => ({ ...e, [row.label]: !e[row.label] }))} className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-sky-600 active:text-sky-800">
                      <ChevronDown size={13} className={`transition-transform ${expanded[row.label] ? 'rotate-180' : ''}`} />
                      {expanded[row.label] ? 'Collapse' : 'Show full'}
                    </button>
                  </div>
                  {docs!.map((d, i) => {
                    const key = row.keys[cols[i].source];
                    return <SectionCell key={i} absent={key === null} section={key ? d!.sections[key] : undefined} expanded={!!expanded[row.label]} />;
                  })}
                </div>
              ))}

              <div className="grid gap-3 pt-3 border-t border-slate-100" style={{ gridTemplateColumns: gridCols }}>
                <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold pt-0.5">Source</div>
                {docs!.map((d, i) => (
                  <a key={i} href={cols[i].source === 'us' ? (d!.dailymed || 'https://www.accessdata.fda.gov/scripts/cder/daf/') : (d!.url || '#')} target="_blank" rel="noopener noreferrer" className="inline-flex items-center text-[11px] font-semibold text-sky-600 active:text-sky-800 h-fit">
                    {cols[i].source === 'us' ? 'Full US label (DailyMed)' : 'Live SmPC (EMA)'} <ExternalLink size={11} className="ml-1 shrink-0" />
                  </a>
                ))}
              </div>
              </div>
              </div>

              <p className="text-[10px] text-slate-400 mt-5 leading-snug">
                {crossJurisdiction
                  ? 'The EU SmPC and the US Prescribing Information are separate legal documents: approved indications, boxed/black-box warnings, dosing and populations differ, and each applies ONLY in its own jurisdiction — they are not interchangeable. '
                  : ''}
                Section text is extracted from the official source documents (EMA product-information / openFDA drug labels) and may be abbreviated; long sections are truncated with the full text one tap away via the links above. Labels are revised frequently; the live linked document is the only authoritative version. For informational use by a healthcare professional only — not medical advice and not a basis for any prescribing, dosing, or treatment decision. Verify against the current label before use.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default LabelComparePanel;
