/**
 * FDA-authorised companion diagnostics (US) — bundled snapshot of the FDA page
 * "List of FDA-Authorized Companion Diagnostic Devices (In Vitro and Imaging
 * Tools)".
 *
 * WHY THIS EXISTS
 *   The biomarker catalog (services/biomarkers.ts) is Europe-centred: an SmPC
 *   requires a *validated test*, not a named kit. US practice works the other
 *   way round — the FDA authorises one specific device for one drug + indication
 *   pair and publishes the definitive list. Bundling that list lets the app
 *   answer "which FDA-authorised test goes with this biomarker / drug" offline,
 *   and puts the US devices beside the EU test-method box on every biomarker
 *   card, so a European reader sees both regulatory framings at once.
 *
 * SHAPE (fda-cdx.json — built by scripts/build-cdx-data.py from a verbatim
 * browser extract of the FDA tables in scripts/cdx/, see the README there)
 *   { generated, listDate, source, total,
 *     devices: [ { name, maker, method, genes[], auths: [ CdxAuth ] } ],
 *     group:   [ CdxGroupRow ] }
 *   `method` is DERIVED from the device type by the build script (the FDA list
 *   has no such column) — present it as derived, never as an FDA field.
 */

export const FDA_CDX_URL =
  'https://www.fda.gov/medical-devices/in-vitro-diagnostics/list-fda-authorized-companion-diagnostic-devices-in-vitro-and-imaging-tools';

export interface CdxDrug {
  b: string; // brand as listed by the FDA (title-cased)
  g: string; // generic / proper name
}

/** One row of the FDA table: a device authorised for one drug + indication. */
export interface CdxAuth {
  ind: string;
  sample: string;
  /** The FDA's own drug wording, cleaned ("Keytruda (pembrolizumab) BLA 125514 in combination with…"). */
  drug: string;
  drugs: CdxDrug[];
  apps: string[]; // "NDA 208065", "BLA 125514"…
  bm: string; // biomarker as listed
  det: string; // biomarker details as listed
  genes: string[]; // canonical tokens for matching (EGFR, HER2, PD-L1, dMMR…)
  num: string; // PMA / 510(k) / De Novo / HDE number
  date: string; // ISO date of that submission
  type: string; // PMA | 510(k) | De Novo | HDE | CBER
  /** Later supplements the FDA lists on the same row. */
  hist?: { num: string; date: string }[];
  /** Row carries a "Group Labeling, see table below" note. */
  grp?: boolean;
}

export interface CdxDevice {
  name: string;
  maker: string;
  method: string;
  genes: string[];
  auths: CdxAuth[];
}

/** A row of the FDA "Group Labeling" table (device authorised for a drug class). */
export interface CdxGroupRow {
  dev: string;
  maker: string;
  ind: string;
  sample: string;
  num: string;
  date: string;
  drugs: CdxDrug[];
  text: string;
}

interface CdxData {
  generated: string;
  listDate: string;
  source: string;
  total: number;
  devices: CdxDevice[];
  group: CdxGroupRow[];
}

/** A device with the subset of its authorisations that matched a query or biomarker. */
export interface CdxHit {
  device: CdxDevice;
  auths: CdxAuth[];
}

// Starts empty; services/liveData.ts loads the shipped snapshot at startup.
let data: CdxData = { generated: '', listDate: '', source: FDA_CDX_URL, total: 0, devices: [], group: [] };
// Search haystack per authorisation, built once per dataset.
let hay: WeakMap<CdxAuth, string[]> = new WeakMap();

// "PD-L1" → pdl1 + pd + l1, "HER-2" → her2 + her + 2, so both the glued and
// the split spellings find a row; plain words split on anything non-alphanumeric.
const toks = (s: string): string[] => {
  const out: string[] = [];
  for (const w of s.toLowerCase().split(/[^a-z0-9-]+/)) {
    if (!w) continue;
    if (w.includes('-')) {
      const glued = w.replace(/-/g, '');
      if (glued) out.push(glued);
      for (const p of w.split('-')) if (p) out.push(p);
    } else out.push(w);
  }
  return out;
};

const hayOf = (dev: CdxDevice, a: CdxAuth): string[] => {
  let h = hay.get(a);
  if (!h) {
    h = toks(
      [dev.name, dev.maker, dev.method, a.ind, a.sample, a.drug, ...a.drugs.map((d) => `${d.b} ${d.g}`),
        ...a.apps, a.bm, a.det, ...a.genes, a.num, a.type, a.date, ...(a.hist || []).map((x) => x.num)].join(' '),
    );
    hay.set(a, h);
  }
  return h;
};

/** Swap in the freshest snapshot fetched at runtime (see services/liveData.ts). */
export const __setCdxData = (d: Partial<CdxData> | null | undefined): void => {
  if (d && Array.isArray(d.devices)) {
    data = { ...data, ...d, devices: d.devices, group: Array.isArray(d.group) ? d.group : [] } as CdxData;
    hay = new WeakMap();
  }
};

export const cdxMeta = (): { listDate: string; source: string; total: number; devices: number; group: number } => ({
  listDate: data.listDate,
  source: data.source || FDA_CDX_URL,
  total: data.total || data.devices.reduce((n, d) => n + d.auths.length, 0),
  devices: data.devices.length,
  group: data.group.length,
});

/** Every device with all its authorisations, alphabetical (the FDA's order). */
export const allCdxDevices = (): CdxHit[] => data.devices.map((device) => ({ device, auths: device.auths }));

export const cdxGroupRows = (): CdxGroupRow[] => data.group;

// A query token matches a haystack token when identical, or (4+ chars) as a
// prefix — "ntrk" finds NTRK1, "osimert" finds osimertinib, but "ret" stays exact.
const tokenMatch = (h: string, q: string): boolean => h === q || (q.length >= 4 && h.startsWith(q));
const rowMatches = (h: string[], q: string[]): boolean => q.every((t) => h.some((x) => tokenMatch(x, t)));

/**
 * Devices whose authorisations match every word of the query — by device,
 * manufacturer, method, indication, sample, drug (brand / generic / NDA-BLA),
 * biomarker, details or submission number. Ranked by number of matching
 * authorisations. Returns the whole list for queries under 2 characters.
 */
export const findCdx = (query: string): CdxHit[] => {
  const q = toks(query.trim());
  if (query.trim().length < 2 || !q.length) return allCdxDevices();
  const hits: CdxHit[] = [];
  for (const device of data.devices) {
    const auths = device.auths.filter((a) => rowMatches(hayOf(device, a), q));
    if (auths.length) hits.push({ device, auths });
  }
  return hits.sort((a, b) => b.auths.length - a.auths.length || a.device.name.localeCompare(b.device.name));
};

/** Group-labelling rows matching every word of the query (all rows for an empty query). */
export const findCdxGroup = (query: string): CdxGroupRow[] => {
  const q = toks(query.trim());
  if (query.trim().length < 2 || !q.length) return data.group;
  return data.group.filter((g) =>
    rowMatches(toks([g.dev, g.maker, g.ind, g.sample, g.num, g.date, ...g.drugs.map((d) => `${d.b} ${d.g}`), g.text].join(' ')), q),
  );
};

/** Total authorisations across a set of hits. */
export const cdxAuthCount = (hits: CdxHit[]): number => hits.reduce((n, h) => n + h.auths.length, 0);

// --- joining the FDA list onto the EU biomarker catalog ----------------------
type Rule = (a: CdxAuth) => boolean;
const has = (a: CdxAuth, ...genes: string[]): boolean => genes.some((g) => a.genes.includes(g));
const text = (a: CdxAuth): string => `${a.bm} ${a.det}`.toLowerCase();

// A gene alone is too coarse where the catalog splits one gene into several
// clinically distinct entries (EGFR ×3, HER2 ×3, KRAS G12C, MET exon 14) or
// where the FDA groups markers differently (MSI/dMMR, HRD/HRR, KIT/PDGFRA).
// Keyed by biomarker id; anything else falls back to gene-token overlap.
const RULES: Record<string, Rule> = {
  'egfr-activating': (a) => has(a, 'EGFR') && /exon 19|l858r|g719|l861q|s768/.test(text(a)),
  'egfr-t790m': (a) => has(a, 'EGFR') && /t790m/.test(text(a)),
  'egfr-exon20': (a) => has(a, 'EGFR') && /exon 20/.test(text(a)),
  'her2-amplified': (a) => has(a, 'HER2') && /amplif|overexpress/.test(text(a)) && !/low|mutation/.test(text(a)),
  'her2-low': (a) => has(a, 'HER2') && /her2-low|ultralow|ihc 1\+/.test(text(a)),
  'her2-mutation': (a) => has(a, 'HER2') && /mutation/.test(text(a)),
  'kras-g12c': (a) => has(a, 'KRAS') && /^(kras\s+)?g12c\*?$/.test(a.det.trim().toLowerCase()),
  'met-ex14': (a) => has(a, 'MET') && /exon 14/.test(text(a)),
  'msi-dmmr': (a) => has(a, 'dMMR', 'MSI-H'),
  brca: (a) => has(a, 'BRCA1', 'BRCA2'),
  hrd: (a) => has(a, 'HRD', 'HRR'),
  'kit-pdgfra': (a) => has(a, 'KIT', 'PDGFRA'),
};

// "CD274 (PD-L1)" → CD274, PD-L1; "FGFR2 / FGFR3" → FGFR2, FGFR3. A pharmaco-
// genomic entry like "HLA-B*57:01" yields no token the FDA list uses (its HLA
// rows are HLA-A*02:01 for tebentafusp / afamitresgene), so it correctly
// matches nothing.
const geneRule = (gene: string): Rule => {
  const tokens = gene.split(/[\s/,()]+/).filter((t) => t.length >= 2 && /^[A-Z0-9-]+$/i.test(t) && !/^(incl|signature)$/i.test(t));
  return (a) => tokens.some((t) => a.genes.includes(t));
};

/**
 * FDA-authorised devices whose authorisation covers this catalog biomarker —
 * each device with only the matching rows. Alphabetical by device.
 */
export const cdxForBiomarker = (m: { id: string; gene: string }): CdxHit[] => {
  const rule = RULES[m.id] ?? geneRule(m.gene);
  const hits: CdxHit[] = [];
  for (const device of data.devices) {
    const auths = device.auths.filter(rule);
    if (auths.length) hits.push({ device, auths });
  }
  return hits;
};

/** "30 Nov 2017" from an ISO date (falls back to the raw string). */
export const cdxDate = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(m[3])} ${months[Number(m[2]) - 1]} ${m[1]}`;
};
