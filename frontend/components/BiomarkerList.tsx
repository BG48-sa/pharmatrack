import React, { useMemo, useState } from 'react';
import {
  allBiomarkers,
  findBiomarkers,
  buildBiomarkerComparison,
  drugLink,
  refLabel,
  BIOMARKER_GROUPS,
  Biomarker,
  BiomarkerGroup,
} from '../services/biomarkers';
import {
  allCdxDevices,
  findCdx,
  findCdxGroup,
  cdxGroupRows,
  cdxForBiomarker,
  cdxMeta,
  cdxAuthCount,
  cdxDate,
  CdxAuth,
  CdxHit,
  CdxGroupRow,
} from '../services/companionDx';
import {
  Dna,
  FlaskConical,
  GitCompare,
  Search as SearchIcon,
  ExternalLink,
  BookOpen,
  Microscope,
  ChevronDown,
} from 'lucide-react';

interface Props {
  query: string;
  /** Open the shared side-by-side compare for this biomarker's EU drugs. */
  onCompare: (m: Biomarker) => void;
}

type Mode = 'eu' | 'us';

// Distinct accent per alteration type, so the list stays scannable at a glance.
const TYPE_COLORS: Record<string, string> = {
  mutation: 'bg-purple-50 text-purple-700 border-purple-200',
  fusion: 'bg-blue-50 text-blue-700 border-blue-200',
  expression: 'bg-amber-50 text-amber-700 border-amber-200',
  signature: 'bg-teal-50 text-teal-700 border-teal-200',
  hla: 'bg-rose-50 text-rose-700 border-rose-200',
  enzyme: 'bg-rose-50 text-rose-700 border-rose-200',
};
const typeColor = (t: string): string => TYPE_COLORS[t] || 'bg-slate-100 text-slate-600 border-slate-200';

// Same idea for the (derived) test method of an FDA device.
const methodColor = (m: string): string => {
  if (/^IHC/.test(m)) return 'bg-amber-50 text-amber-700 border-amber-200';
  if (/FISH|ISH/.test(m)) return 'bg-blue-50 text-blue-700 border-blue-200';
  if (/^PCR/.test(m)) return 'bg-purple-50 text-purple-700 border-purple-200';
  if (/NGS|sequencing/i.test(m)) return 'bg-teal-50 text-teal-700 border-teal-200';
  return 'bg-slate-100 text-slate-600 border-slate-200';
};

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** One FDA authorisation: drug, indication + sample, biomarker detail, submission number and date. */
const AuthRow: React.FC<{ a: CdxAuth }> = ({ a }) => {
  // A single plain drug is shown as brand + generic; combinations and "alone or
  // with" wordings are shown exactly as the FDA writes them.
  const simple = a.drugs.length === 1 && !/combination|\bor\b|alone|\+/i.test(a.drug);
  return (
    <li className="py-2 border-t border-slate-100 first:border-t-0">
      {simple ? (
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-[13px] font-semibold text-slate-900">{a.drugs[0].b}</span>
          <span className="text-[12px] text-slate-500">{a.drugs[0].g}</span>
        </div>
      ) : (
        <p className="text-[13px] font-medium text-slate-900">{a.drug}</p>
      )}
      <p className="text-[12px] text-slate-700 mt-0.5">
        {a.ind}
        {a.sample ? <span className="text-slate-500"> · {a.sample}</span> : null}
      </p>
      <p className="text-[12px] text-slate-600 mt-0.5">
        <span className="font-mono text-[11px] text-slate-700 bg-slate-100 rounded px-1 py-0.5">{a.bm}</span>{' '}
        {a.det}
      </p>
      <p className="text-[11px] text-slate-500 mt-1">
        <span className="font-mono">{a.type} {a.num}</span> · {cdxDate(a.date)}
        {(a.hist || []).map((h) => (
          <span key={h.num}>
            {' '}· <span className="font-mono">{h.num}</span> {cdxDate(h.date)}
          </span>
        ))}
        {simple && a.apps.length > 0 && <span> · {a.apps.join(', ')}</span>}
      </p>
      {a.grp && (
        <p className="text-[11px] text-blue-700 mt-0.5">
          Group labelling — also authorised for the whole drug class (see the group-labelling table below).
        </p>
      )}
    </li>
  );
};

/** An FDA device card for the US view; expands to its (matching) authorisations. */
const DeviceCard: React.FC<{ hit: CdxHit; forceOpen: boolean }> = ({ hit, forceOpen }) => {
  const [open, setOpen] = useState<boolean | null>(null);
  const shown = open ?? forceOpen;
  const { device, auths } = hit;
  const partial = auths.length < device.auths.length;
  const genes = device.genes.slice(0, 8);
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4">
      <button type="button" onClick={() => setOpen(!shown)} aria-expanded={shown} className="w-full text-left flex items-start gap-3">
        <div className="p-2 bg-blue-100 rounded-xl text-blue-700 shrink-0">
          <Microscope size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-bold text-slate-900 leading-tight">{device.name}</h3>
            <span className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-lg border text-[10px] font-bold uppercase tracking-wide ${methodColor(device.method)}`}>
              {device.method}
            </span>
          </div>
          <p className="text-[12px] text-slate-500 mt-0.5">{device.maker}</p>
          <div className="flex flex-wrap gap-1 mt-1.5">
            {genes.map((g) => (
              <span key={g} className="font-mono text-[10px] text-slate-600 bg-slate-100 rounded px-1.5 py-0.5">{g}</span>
            ))}
            {device.genes.length > genes.length && (
              <span className="text-[10px] text-slate-400 self-center">+{device.genes.length - genes.length} more</span>
            )}
          </div>
          <p className="text-[11px] text-slate-500 mt-1.5">
            {partial
              ? `${auths.length} of ${plural(device.auths.length, 'authorisation')} match`
              : plural(device.auths.length, 'authorisation')}
            {' · '}{shown ? 'hide' : 'show drug, indication and date'}
          </p>
        </div>
        <ChevronDown size={16} className={`shrink-0 mt-1 text-slate-400 transition-transform ${shown ? 'rotate-180' : ''}`} />
      </button>
      {shown && (
        <ul className="mt-2 ml-11">
          {auths.map((a, i) => (
            <AuthRow key={`${a.num}-${i}`} a={a} />
          ))}
        </ul>
      )}
    </div>
  );
};

/** A row of the FDA group-labelling table (a device authorised for a drug class). */
const GroupRow: React.FC<{ g: CdxGroupRow }> = ({ g }) => (
  <li className="py-2.5 border-t border-slate-100 first:border-t-0">
    <p className="text-[13px] font-semibold text-slate-900">{g.dev}</p>
    <p className="text-[12px] text-slate-700 mt-0.5">
      {g.ind}
      {g.sample ? <span className="text-slate-500"> · {g.sample}</span> : null}
      {' · '}<span className="font-mono text-[11px]">{g.num}</span> · {cdxDate(g.date)}
    </p>
    {g.drugs.length > 0 && (
      <p className="text-[12px] text-slate-600 mt-0.5">Drug class members named: {g.drugs.map((d) => d.b).join(', ')}</p>
    )}
    <p className="text-[11px] text-slate-500 mt-1 leading-snug">{g.text}</p>
  </li>
);

/** The FDA-authorised US tests that cover one catalog biomarker, shown beside the EU test-method box. */
const UsCdxBox: React.FC<{ m: Biomarker }> = ({ m }) => {
  const hits = useMemo(() => cdxForBiomarker(m), [m]);
  const [openDev, setOpenDev] = useState<string | null>(null);
  const meta = cdxMeta();
  const n = cdxAuthCount(hits);
  const open = openDev ? hits.find((h) => h.device.name === openDev) : undefined;
  return (
    <div className="mt-2.5 rounded-xl bg-blue-50/70 border border-blue-100 p-2.5">
      <div className="flex items-center gap-1.5 text-[11px] font-bold text-blue-800 uppercase tracking-wide">
        <Microscope size={12} /> FDA-authorised companion diagnostics (US)
      </div>
      {hits.length === 0 ? (
        <p className="text-[12px] text-slate-600 mt-1">
          None for this biomarker on the FDA list of {cdxDate(meta.listDate)}.
        </p>
      ) : (
        <>
          <p className="text-[13px] font-semibold text-slate-800 mt-1">
            {plural(hits.length, 'test')} · {plural(n, 'authorisation')}
            <span className="font-normal text-[11px] text-slate-500"> · FDA list of {cdxDate(meta.listDate)} · tap a test for drug, indication and date</span>
          </p>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {hits.map((h) => {
              const active = openDev === h.device.name;
              return (
                <button
                  key={h.device.name}
                  type="button"
                  aria-expanded={active}
                  onClick={() => setOpenDev(active ? null : h.device.name)}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border text-[11px] font-semibold transition-colors ${
                    active ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-blue-200 text-blue-700 active:bg-blue-50'
                  }`}
                >
                  {h.device.name}
                  <span className={`font-normal ${active ? 'text-blue-100' : 'text-slate-500'}`}>· {h.device.method} · {h.auths.length}</span>
                </button>
              );
            })}
          </div>
          {open && (
            <div className="mt-2 rounded-lg bg-white border border-blue-100 px-2.5">
              <p className="text-[11px] text-slate-500 pt-2">{open.device.maker} · test method (derived from the device type): {open.device.method}</p>
              <ul>
                {open.auths.map((a, i) => (
                  <AuthRow key={`${a.num}-${i}`} a={a} />
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
};

const BiomarkerCard: React.FC<{ m: Biomarker; onCompare: () => void }> = ({ m, onCompare }) => {
  // Only member drugs authorised in the EU can be compared (built from EMA data).
  const euCount = useMemo(() => buildBiomarkerComparison(m).length, [m]);
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4">
      <div className="flex items-start gap-3">
        <div className="p-2 bg-violet-100 rounded-xl text-violet-700 shrink-0">
          <Dna size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-bold text-slate-900 leading-tight">{m.name}</h3>
            <span className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-lg border text-[10px] font-bold uppercase tracking-wide ${typeColor(m.type)}`}>
              {m.type}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1">
            <span className="font-mono text-[11px] text-slate-600 bg-slate-100 rounded px-1.5 py-0.5">{m.gene}</span>
            <span className="text-[12px] text-slate-500">{m.alt}</span>
          </div>
          <p className="text-[12px] text-slate-600 mt-1.5">{m.context}</p>

          {/* Plain-language explanation of what the alteration is and what it predicts. */}
          {m.desc && (
            <p className="text-[13px] text-slate-700 leading-relaxed mt-2">{m.desc}</p>
          )}

          {/* Curated external "look it up" reference (OncoKB / CFTR2 / PubMed…). */}
          {m.ref && (
            <a
              href={m.ref}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1.5 text-[12px] font-semibold text-violet-700 active:text-violet-900"
            >
              <BookOpen size={13} /> Look it up on {refLabel(m.ref)}
              <ExternalLink size={11} className="text-violet-400" />
            </a>
          )}

          {/* EU test framing: method first (per SmPC), example CE-IVD assays after. */}
          <div className="mt-2.5 rounded-xl bg-violet-50/70 border border-violet-100 p-2.5">
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-violet-800 uppercase tracking-wide">
              <FlaskConical size={12} /> Test method required by the SmPC (EU)
            </div>
            <p className="text-[13px] font-semibold text-slate-800 mt-1">{m.method}</p>
            <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">
              Example CE-marked assays (illustrative, not an endorsement): {m.assays.join(' · ')}
            </p>
          </div>

          {/* US framing: the named devices the FDA has authorised for this biomarker. */}
          <UsCdxBox m={m} />

          {/* Drugs the biomarker result unlocks (EU brand names) — each links to its EMA EPAR. */}
          <div className="mt-2.5">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
              {m.type === 'hla' || m.type === 'enzyme' ? `Screen before prescribing (${m.drugs.length})` : `Indication depends on this result (${m.drugs.length})`} · tap for EU label
            </div>
            <div className="flex flex-wrap gap-1.5">
              {m.drugs.map((d) => (
                <a
                  key={d.b}
                  href={drugLink(d)}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`${d.g} — open EMA EPAR`}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-white border border-violet-200 text-[11px] font-semibold text-violet-700 active:bg-violet-50"
                >
                  {d.b}
                  <ExternalLink size={10} className="text-violet-400" />
                </a>
              ))}
            </div>
          </div>

          {euCount >= 2 && (
            <button
              onClick={onCompare}
              className="mt-3 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-semibold bg-violet-600 text-white active:bg-violet-700 transition-colors"
            >
              <GitCompare size={15} /> Compare all {euCount} side by side
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

const BiomarkerList: React.FC<Props> = ({ query, onCompare }) => {
  const [mode, setMode] = useState<Mode>('eu');
  const [group, setGroup] = useState<BiomarkerGroup | 'all'>('all');
  const [showGroupTable, setShowGroupTable] = useState(false);

  const q = query.trim();
  // A query searches the whole catalog; the group chips filter the browse view.
  const results = useMemo(() => {
    const base = q ? findBiomarkers(q) : allBiomarkers();
    return group === 'all' ? base : base.filter((m) => m.group === group);
  }, [q, group]);

  const grouped = useMemo(
    () =>
      BIOMARKER_GROUPS.map((g) => ({
        ...g,
        items: results.filter((m) => m.group === g.key),
      })).filter((g) => g.items.length > 0),
    [results],
  );

  const totalForQuery = useMemo(() => (q ? findBiomarkers(q).length : allBiomarkers().length), [q]);

  // The FDA list answers the same query from the US side.
  const cdxHits = useMemo(() => (q ? findCdx(q) : allCdxDevices()), [q]);
  const cdxGroup = useMemo(() => (q ? findCdxGroup(q) : cdxGroupRows()), [q]);
  const cdxN = cdxAuthCount(cdxHits);
  const meta = cdxMeta();

  const chip = (active: boolean) =>
    `flex-shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
      active ? 'bg-violet-600 text-white border-violet-600' : 'bg-slate-100 text-slate-700 border-slate-200 active:bg-slate-200'
    }`;
  const seg = (active: boolean) =>
    `flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
      active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 active:bg-slate-200'
    }`;

  return (
    <div className="px-4">
      <div className="mb-3">
        <h2 className="text-xl font-bold text-slate-800">Biomarkers &amp; Companion Diagnostics</h2>
        <p className="text-[11px] text-slate-500 leading-relaxed mt-1">
          Actionable biomarkers and the EU-authorised medicines their result unlocks. In the EU, companion
          diagnostics are governed by the <strong>IVD Regulation</strong> (in force since May 2022): the SmPC
          requires a <strong>validated test</strong> for the biomarker — the assays shown are common CE-IVD
          examples, not the sole requirement. {allBiomarkers().length} biomarkers · EU brand names.
          {meta.total > 0 && (
            <>
              {' '}The <strong>FDA companion diagnostics</strong> view lists every device the FDA has authorised for a
              specific drug and indication — {meta.total} authorisations across {meta.devices} devices, FDA list
              of {cdxDate(meta.listDate)} — and each biomarker card shows its matching US tests.
            </>
          )}
        </p>
      </div>

      {/* EU catalog vs FDA list — both answer the same search box. */}
      <div className="flex gap-1 p-1 rounded-xl bg-slate-100 mb-3" role="group" aria-label="Biomarker view">
        <button type="button" aria-pressed={mode === 'eu'} onClick={() => setMode('eu')} className={seg(mode === 'eu')}>
          <Dna size={13} /> EU biomarkers{q ? ` · ${totalForQuery}` : ''}
        </button>
        <button type="button" aria-pressed={mode === 'us'} onClick={() => setMode('us')} className={seg(mode === 'us')}>
          <Microscope size={13} /> FDA companion diagnostics{q ? ` · ${cdxN}` : ''}
        </button>
      </div>

      {mode === 'eu' ? (
        <>
          {/* Group filter chips */}
          <div className="flex gap-2 overflow-x-auto pb-1 mb-3 hide-scrollbar" style={{ scrollbarWidth: 'none' }}>
            <button onClick={() => setGroup('all')} className={chip(group === 'all')}>
              All
            </button>
            {BIOMARKER_GROUPS.map((g) => (
              <button key={g.key} onClick={() => setGroup(g.key)} className={chip(group === g.key)}>
                {g.label}
              </button>
            ))}
          </div>

          {results.length === 0 ? (
            <div role="status" aria-live="polite" className="text-center py-10 px-6">
              <div className="bg-slate-100 w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3">
                <SearchIcon className="text-slate-400 w-7 h-7" />
              </div>
              <p className="text-slate-700 text-sm font-semibold">
                {q ? `No biomarker matches “${q}”.` : 'No biomarkers in this group.'}
              </p>
              {group !== 'all' && totalForQuery > 0 && (
                <button
                  onClick={() => setGroup('all')}
                  className="mt-4 w-full max-w-xs mx-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-violet-100 text-violet-800 active:bg-violet-200"
                >
                  Clear filter — {totalForQuery} match{totalForQuery === 1 ? '' : 'es'} in other groups
                </button>
              )}
              {q && totalForQuery === 0 && cdxN > 0 && (
                <button
                  onClick={() => setMode('us')}
                  className="mt-4 w-full max-w-xs mx-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-blue-100 text-blue-800 active:bg-blue-200"
                >
                  <Microscope size={15} /> {plural(cdxN, 'FDA companion-diagnostic authorisation')} match
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500">
              {/* Announce result counts to screen readers as the search changes. */}
              <p className="sr-only" role="status" aria-live="polite">{results.length} biomarkers shown</p>
              {grouped.map(({ key, label, items }) => (
                <div key={key}>
                  <div className="inline-flex items-center px-2.5 py-1 rounded-lg border border-violet-200 bg-violet-50 text-violet-700 text-[11px] font-bold uppercase tracking-wide mb-2">
                    {label} · {items.length}
                  </div>
                  <div className="space-y-3">
                    {items.map((m) => (
                      <BiomarkerCard key={m.id} m={m} onCompare={() => onCompare(m)} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="rounded-xl bg-blue-50/70 border border-blue-100 p-3 mb-3 text-[11px] text-slate-600 leading-relaxed">
            <span className="font-semibold text-slate-800">
              {plural(meta.total, 'authorisation')} · {plural(meta.devices, 'device')} · {meta.group} group-labelling {meta.group === 1 ? 'entry' : 'entries'}
            </span>
            {' '}— the FDA's list of companion diagnostic devices authorised for a specific drug and indication, as of{' '}
            {cdxDate(meta.listDate)}. Test methods are derived from the device type. Search by device, manufacturer, drug,
            indication, biomarker or submission number.{' '}
            <a href={meta.source} target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-700 inline-flex items-center gap-1">
              Open the FDA list <ExternalLink size={10} />
            </a>
          </div>

          {cdxHits.length === 0 ? (
            <div role="status" aria-live="polite" className="text-center py-10 px-6">
              <div className="bg-slate-100 w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3">
                <SearchIcon className="text-slate-400 w-7 h-7" />
              </div>
              <p className="text-slate-700 text-sm font-semibold">No FDA companion diagnostic matches “{q}”.</p>
              {totalForQuery > 0 && (
                <button
                  onClick={() => setMode('eu')}
                  className="mt-4 w-full max-w-xs mx-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-violet-100 text-violet-800 active:bg-violet-200"
                >
                  <Dna size={15} /> {plural(totalForQuery, 'EU biomarker')} match
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-3 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <p className="sr-only" role="status" aria-live="polite">
                {cdxN} authorisations in {cdxHits.length} devices shown
              </p>
              {q && (
                <div className="inline-flex items-center px-2.5 py-1 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 text-[11px] font-bold uppercase tracking-wide">
                  {plural(cdxN, 'authorisation')} · {plural(cdxHits.length, 'device')} for “{q}”
                </div>
              )}
              {cdxHits.map((h) => (
                <DeviceCard key={`${h.device.name}-${q}`} hit={h} forceOpen={!!q} />
              ))}
            </div>
          )}

          {cdxGroup.length > 0 && (
            <div className="mt-5 bg-white rounded-2xl shadow-sm border border-slate-200 p-4">
              <button
                type="button"
                onClick={() => setShowGroupTable((v) => !v)}
                aria-expanded={showGroupTable}
                className="w-full text-left flex items-center justify-between gap-2"
              >
                <div>
                  <h3 className="font-bold text-slate-900 leading-tight">Group labelling · {cdxGroup.length}</h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Devices authorised for a whole class of drugs (“a tyrosine kinase inhibitor approved by FDA for that indication”)
                    rather than one named product.
                  </p>
                </div>
                <ChevronDown size={16} className={`shrink-0 text-slate-400 transition-transform ${showGroupTable ? 'rotate-180' : ''}`} />
              </button>
              {showGroupTable && (
                <ul className="mt-2">
                  {cdxGroup.map((g, i) => (
                    <GroupRow key={`${g.dev}-${g.num}-${i}`} g={g} />
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default BiomarkerList;
