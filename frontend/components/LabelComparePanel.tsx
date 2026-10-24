import React, { useEffect, useMemo, useState } from 'react';
import { X, FileText, ExternalLink, ChevronDown, Loader2, Highlighter } from 'lucide-react';
import { loadLabelFile } from '../services/labelFiles';
import { diffSections, DiffUnit, SectionDiff } from '../services/labelDiff';

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
interface LabelDoc {
  slug: string; brand: string; inn: string; usBrand?: string; url?: string; dailymed?: string; sections: Record<string, SectionData>;
  // US labels only: which product openFDA supplied. 'brand' = the same product
  // name exists in the US; 'substance' = a different US product with the same
  // active substance (originator or another brand) — never presented as the same medicine.
  usGeneric?: string; usRoute?: string; match?: 'brand' | 'substance';
  // Traceability per document: when the source text was retrieved, and (US) the label version date.
  retrieved?: string; effective?: string;
  // true = the file's hash matches the applied data release's index; false = it does not
  // (served from a different deploy); undefined = nothing to check against.
  verified?: boolean;
}

export interface LabelIntegrity {
  /** SHA-256 the applied release's index records for a label file. */
  expectedSha: (slug: string, source: Src) => string | undefined;
  releaseId?: string;
  releaseDate?: string;
  indexVerified?: { eu?: boolean | null; us?: boolean | null };
}

interface Props {
  columns: LabelColumn[];
  onClose: () => void;
  /** Whether a given medicine has a label in a given jurisdiction (enables the EU/US toggle). */
  available?: (slug: string, source: Src) => boolean;
  /** When each label corpus was extracted (ISO dates), so offline/cached text is honest about its age. */
  corpusDates?: { eu?: string; us?: string };
  /** Binds each label file to the applied data release (hash chain release → index → file). */
  integrity?: LabelIntegrity;
}

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

// Loads a label file bound to the applied data release (see loadLabelFile).
const loadDoc = (col: LabelColumn, integrity?: LabelIntegrity): Promise<LabelDoc | null> =>
  loadLabelFile<LabelDoc>(dir(col.source), col.slug, integrity?.expectedSha(col.slug, col.source), integrity?.releaseId);

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

// --- Difference highlighting -------------------------------------------------
// Colour AND a text decoration per kind, so the marks survive red–green colour
// vision deficiency and greyscale printing: dotted underline = only in this
// label, light amber = wording differs, bold wavy underline = a number differs.
const SIDE_UNIQUE = [
  'bg-rose-100 text-rose-950 underline decoration-dotted decoration-rose-400 underline-offset-2 rounded-sm box-decoration-clone px-0.5',
  'bg-emerald-100 text-emerald-950 underline decoration-dotted decoration-emerald-500 underline-offset-2 rounded-sm box-decoration-clone px-0.5',
];
const SIDE_SWATCH = ['bg-rose-100 border-rose-300', 'bg-emerald-100 border-emerald-400'];
const CHANGED = 'bg-amber-50 rounded-sm box-decoration-clone';
const WORD_DIFF = 'bg-amber-200 rounded-sm';
const WORD_NUM = 'text-red-700 font-bold underline decoration-wavy decoration-red-400 underline-offset-2';

const renderUnit = (u: DiffUnit, side: number, i: number): React.ReactNode => {
  if (u.k === 'unique') return <span key={i} className={SIDE_UNIQUE[side]}>{u.text}</span>;
  if (u.k === 'changed') {
    return (
      <span key={i} className={CHANGED}>
        {u.words
          ? u.words.map((w, j) => (w.k === 'same' ? w.t : <mark key={j} className={w.k === 'num' ? `${WORD_NUM} bg-transparent` : WORD_DIFF}>{w.t}</mark>))
          : u.text}
      </span>
    );
  }
  return <span key={i}>{u.text}</span>;
};

/** The diffed version of renderText: units re-joined per source line, tables as blocks. */
const renderDiff = (units: DiffUnit[], side: number): React.ReactNode[] => {
  const lines = new Map<number, DiffUnit[]>();
  for (const u of units) { const l = lines.get(u.line); if (l) l.push(u); else lines.set(u.line, [u]); }
  return [...lines.entries()].map(([line, us]) => {
    if (us[0].table) {
      const cls = us[0].k === 'unique' ? `border-l-4 ${side === 0 ? 'border-rose-300' : 'border-emerald-400'}` : us[0].k === 'changed' ? 'border-l-4 border-amber-300' : '';
      return <pre key={line} className={`overflow-x-auto whitespace-pre font-mono text-[11px] leading-relaxed text-slate-700 my-1 bg-slate-50 rounded-md px-2 py-1.5 ${cls}`}>{us[0].text}</pre>;
    }
    return (
      <p key={line} className="whitespace-pre-wrap text-[12px] leading-relaxed text-slate-700 my-1">
        {us.map((u, i) => <React.Fragment key={i}>{i > 0 ? ' ' : ''}{renderUnit(u, side, i)}</React.Fragment>)}
      </p>
    );
  });
};

const DiffLegend: React.FC<{ names: string[] }> = ({ names }) => (
  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-500 mt-1.5">
    {names.map((n, i) => (
      <span key={i} className="inline-flex items-center gap-1"><span className={`inline-block w-3 h-3 rounded-sm border ${SIDE_SWATCH[i]}`} /> only in {n}</span>
    ))}
    <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-amber-200 border border-amber-300" /> wording differs</span>
    <span className="inline-flex items-center gap-1"><span className={`${WORD_NUM} text-[10px]`}>12</span> number differs</span>
  </div>
);

const SectionCell: React.FC<{ section?: SectionData; absent?: boolean; expanded: boolean; sectionKey?: string | null; units?: DiffUnit[]; side?: number }> = ({ section, absent, expanded, sectionKey, units, side = 0 }) => {
  if (absent) return <p className="text-[11px] italic text-slate-300">Not a section of this label.</p>;
  if (!section || section.missing || (!section.text && !section.tables?.length)) {
    // An empty extract is NOT evidence that the official label lacks the
    // section — say what we know. Only the boxed warning is a genuine absence
    // (most US labels have none).
    return sectionKey === 'boxed_warning'
      ? <p className="text-[12px] italic text-slate-400">No boxed warning in this extract (most US labels carry none — confirm in the official label).</p>
      : <p className="text-[12px] italic text-slate-400">Section not available in this extract — open the official label via the source link below.</p>;
  }
  return (
    <div className="relative min-w-0" style={expanded ? undefined : { maxHeight: COLLAPSED_PX, overflow: 'hidden' }}>
      {section.text ? (units ? renderDiff(units, side) : renderText(section.text)) : null}
      {section.tables?.map((html, i) => (
        <div key={i} className="uspi-table overflow-x-auto my-1.5" dangerouslySetInnerHTML={{ __html: html }} />
      ))}
      {!expanded && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-white to-transparent" />}
    </div>
  );
};

const fmtCorpusDate = (iso: string): string => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

const LabelComparePanel: React.FC<Props> = ({ columns, onClose, available, corpusDates, integrity }) => {
  // Columns are internal state so each can be toggled between EU / US in place.
  const [cols, setCols] = useState<LabelColumn[]>(columns);
  const [docs, setDocs] = useState<(LabelDoc | null)[] | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // "Highlight differences": on by default for a two-label comparison (where
  // the diff is defined), off otherwise; remembered per browser.
  const [highlight, setHighlight] = useState<boolean>(() => {
    try { const v = localStorage.getItem('labelCompare.highlight'); if (v !== null) return v === '1'; } catch { /* private mode etc. */ }
    return columns.length === 2;
  });
  const toggleHighlight = () => setHighlight((h) => { try { localStorage.setItem('labelCompare.highlight', h ? '0' : '1'); } catch { /* ignore */ } return !h; });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  // (Re)load whenever the set of columns changes (initial mount or a toggle).
  useEffect(() => {
    let cancelled = false; // a quick EU/US toggle must not be overwritten by the earlier, slower load
    setDocs(null);
    Promise.all(cols.map((c) => loadDoc(c, integrity))).then((d) => { if (!cancelled) setDocs(d); });
    return () => { cancelled = true; };
  }, [cols]);

  const setColSource = (i: number, source: Src) =>
    setCols((prev) => (prev[i].source === source ? prev : prev.map((c, j) => (j === i ? { ...c, source } : c))));

  const bothLoaded = docs && docs.every(Boolean);
  const sameMolecule = cols.length === 2 && cols[0].slug === cols[1].slug;
  const crossJurisdiction = sameMolecule && cols[0].source !== cols[1].source;
  // US columns whose label belongs to a different product (same active substance).
  const substituteUs = (docs || []).map((d, i) => (d && cols[i].source === 'us' && d.match === 'substance' ? d : null));
  const anySubstitute = substituteUs.some(Boolean);
  // The EU name of the medicine in column i: from the EU document of the same
  // slug if one is shown, else a readable form of the slug (US docs carry the US brand).
  const euBrandFor = (i: number): string => {
    const eu = docs?.find((d, j) => d && cols[j].slug === cols[i].slug && cols[j].source === 'eu');
    if (eu?.brand) return eu.brand;
    const d = docs?.[i];
    if (d?.brand && d.brand !== d.usBrand) return d.brand;
    return cols[i].slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  };
  // Hide rows with no content in ANY present column's jurisdiction.
  const rows = ROWS.filter((r) => cols.some((c) => r.keys[c.source]));
  // Sentence-level differences per row, two columns only (services/labelDiff.ts).
  const canDiff = cols.length === 2 && !!bothLoaded;
  const diffs = useMemo<Record<string, SectionDiff | null>>(() => {
    if (!canDiff || !highlight || !docs) return {};
    const out: Record<string, SectionDiff | null> = {};
    for (const row of rows) {
      const ka = row.keys[cols[0].source], kb = row.keys[cols[1].source];
      const sa = ka ? docs[0]!.sections[ka] : undefined, sb = kb ? docs[1]!.sections[kb] : undefined;
      const ta = sa && !sa.missing ? sa.text || '' : '', tb = sb && !sb.missing ? sb.text || '' : '';
      out[row.label] = diffSections(ta, tb);
    }
    return out;
    // rows derives from cols; docs change with cols.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canDiff, highlight, docs, cols]);
  const colName = (i: number): string => {
    const d = docs?.[i];
    const brand = cols[i].source === 'us' ? d?.usBrand || d?.brand : d?.brand;
    return `${brand || cols[i].slug} (${cols[i].source.toUpperCase()})`;
  };
  // With more than two columns (a whole drug class), give each a readable min
  // width and let the aligned grid scroll horizontally instead of squishing.
  const many = cols.length > 2;
  const colTmpl = many ? 'minmax(13rem, 1fr)' : '1fr';
  const gridCols = `9rem ${cols.map(() => colTmpl).join(' ')}`;
  const minWidth = many ? `${9 + cols.length * 13}rem` : undefined;

  return (
    <div role="dialog" aria-modal="true" aria-label="Label comparison" className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/40 backdrop-blur-sm sm:items-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white rounded-t-3xl sm:rounded-3xl w-full sm:max-w-5xl max-h-[92vh] overflow-y-auto shadow-2xl relative animate-in slide-in-from-bottom-4 duration-300" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white/90 backdrop-blur-xl px-5 pt-6 pb-3 border-b border-slate-100 z-10">
          <button onClick={onClose} className="absolute top-5 right-4 p-2 text-slate-400 hover:text-slate-600 bg-slate-50 rounded-full" aria-label="Close"><X size={18} /></button>
          <div className="flex items-center space-x-3 pr-8">
            <div className="p-2.5 bg-sky-50 rounded-xl text-sky-600 shrink-0"><FileText size={22} /></div>
            <div>
              <h2 className="text-xl font-bold text-slate-900 leading-tight">{crossJurisdiction ? 'EU vs US label' : 'Label comparison'}</h2>
              <p className="text-sm text-slate-500 mt-0.5">
                {crossJurisdiction
                  ? anySubstitute
                    ? 'Same active substance, different US product — EU SmPC vs US Prescribing Information'
                    : 'Same product — EU SmPC vs US Prescribing Information'
                  : 'Key label sections, side by side'}
              </p>
              {corpusDates && (corpusDates.eu || corpusDates.us) && (
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Label text extracted{' '}
                  {[
                    cols.some((c) => c.source === 'eu') && corpusDates.eu ? `EU ${fmtCorpusDate(corpusDates.eu)}` : null,
                    cols.some((c) => c.source === 'us') && corpusDates.us ? `US ${fmtCorpusDate(corpusDates.us)}` : null,
                  ].filter(Boolean).join(' · ')}{' '}
                  — verify against the linked official label.
                </p>
              )}
            </div>
          </div>
          {canDiff && (
            <div className="mt-2.5">
              <button
                type="button"
                role="switch"
                aria-checked={highlight}
                onClick={toggleHighlight}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors ${
                  highlight ? 'bg-sky-600 border-sky-600 text-white' : 'bg-white border-slate-200 text-sky-600 active:bg-sky-50'
                }`}
                title="Sentence-level comparison of the two labels: statements found on one side only, and numbers that differ in matching statements"
              >
                <Highlighter size={12} /> Highlight differences
              </button>
              {highlight && <DiffLegend names={[colName(0), colName(1)]} />}
              {highlight && anySubstitute && (
                <p className="text-[10px] text-amber-700 mt-1">The US column is a different product — differences reflect two products, not one label in two jurisdictions.</p>
              )}
            </div>
          )}
        </div>

        <div className="px-5 py-4 pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
          {!docs && <div className="flex items-center justify-center py-16 text-slate-400"><Loader2 className="animate-spin mr-2" size={20} /> Loading label sections…</div>}
          {docs && !bothLoaded && (
            <p className="text-sm text-slate-500 py-10 text-center leading-relaxed">The full label isn’t available for one of these medicines yet. Coverage is being extended — please try again later.</p>
          )}
          {bothLoaded && anySubstitute && (
            <div className="mb-3 rounded-xl bg-amber-50 border border-amber-200 p-3 text-[12px] text-amber-900 leading-snug">
              <p className="font-bold mb-1">The US column is a different product</p>
              {substituteUs.map((d, i) => d && (
                <p key={i}>
                  No US label named <strong>{euBrandFor(i)}</strong> was found. Shown instead: <strong>{d.usBrand}</strong>
                  {d.usGeneric ? ` (${d.usGeneric.toLowerCase()}${d.usRoute ? `, ${d.usRoute.toLowerCase()}` : ''})` : ''}, a US product with the same active substance.
                  Strengths, formulation and approved indications can differ — read it as a reference for the substance, not as this medicine's US label.
                </p>
              ))}
            </div>
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
                    {cols[i].source === 'us' && d!.match === 'substance' && (
                      <div className="text-[10px] font-bold text-amber-700 uppercase tracking-wide">different product · same substance</div>
                    )}
                    <div className="text-[11px] text-slate-500 font-medium truncate">{d!.inn}</div>
                    {(d!.retrieved || d!.effective) && (
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        {cols[i].source === 'us'
                          ? `${d!.effective ? `label version ${fmtCorpusDate(d!.effective)}` : ''}${d!.effective && d!.retrieved ? ' · ' : ''}${d!.retrieved ? `retrieved ${fmtCorpusDate(d!.retrieved)}` : ''}`
                          : `SmPC text retrieved ${fmtCorpusDate(d!.retrieved || '')}`}
                      </div>
                    )}
                    {cols[i].source === 'us' && (
                      <div className="text-[10px] text-slate-400 leading-snug" title="openFDA/DailyMed carry the label currently in use (Structured Product Labeling). FDA notes it can differ from the last FDA-approved labeling listed in Drugs@FDA.">
                        current in-use label (DailyMed) — can differ from the last FDA-approved version
                      </div>
                    )}
                    {d!.verified === true && (
                      <div className="text-[10px] text-emerald-700 mt-0.5" title="The file's SHA-256 matches the index of the data release the app has applied">
                        file integrity verified · data release {integrity?.releaseDate ? fmtCorpusDate(integrity.releaseDate.slice(0, 10)) : integrity?.releaseId || ''}
                      </div>
                    )}
                    {d!.verified === false && (
                      <div className="text-[10px] text-amber-700 mt-0.5" title="The file's SHA-256 does not match the index of the applied data release — it was served from a different deploy">
                        label file from a different data release than the app's data
                      </div>
                    )}
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
                    {highlight && canDiff && diffs[row.label] && (
                      <div className="text-[10px] text-slate-500 mt-1 leading-snug">
                        {diffs[row.label]!.stats.uniqueA + diffs[row.label]!.stats.uniqueB + diffs[row.label]!.stats.changed === 0
                          ? 'no differences found'
                          : `${diffs[row.label]!.stats.uniqueA} only ${cols[0].source.toUpperCase()} · ${diffs[row.label]!.stats.uniqueB} only ${cols[1].source.toUpperCase()} · ${diffs[row.label]!.stats.changed} differ`}
                      </div>
                    )}
                    {highlight && canDiff && diffs[row.label] === null && row.keys[cols[0].source] && row.keys[cols[1].source] && (
                      <div className="text-[10px] text-slate-400 mt-1 leading-snug">not compared (a section is missing or too long)</div>
                    )}
                    <button onClick={() => setExpanded((e) => ({ ...e, [row.label]: !e[row.label] }))} className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-sky-600 active:text-sky-800">
                      <ChevronDown size={13} className={`transition-transform ${expanded[row.label] ? 'rotate-180' : ''}`} />
                      {expanded[row.label] ? 'Collapse' : 'Expand'}
                    </button>
                  </div>
                  {docs!.map((d, i) => {
                    const key = row.keys[cols[i].source];
                    const diff = highlight ? diffs[row.label] : null;
                    const units = diff ? (i === 0 ? diff.a : diff.b) : undefined;
                    return <SectionCell key={i} absent={key === null} sectionKey={key} section={key ? d!.sections[key] : undefined} expanded={!!expanded[row.label]} units={units} side={i} />;
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
                {highlight && canDiff ? 'Highlighted differences are a deterministic sentence-by-sentence comparison of the extracted texts (word overlap), not a clinical judgement: a rephrased statement can show as "only in" one label, and matching is approximate. ' : ''}
                Section text is extracted from the official source documents (EMA product-information / openFDA drug labels) and may be abbreviated; long sections are truncated with the full text one tap away via the links above. Labels are revised frequently; the live linked document is the only authoritative version. US text is the label currently in use as listed on DailyMed/openFDA, which the FDA notes can differ from the last FDA-approved labeling in Drugs@FDA. For informational use by a healthcare professional only — not medical advice and not a basis for any prescribing, dosing, or treatment decision. Verify against the current label before use.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default LabelComparePanel;
