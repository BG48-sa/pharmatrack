import { Drug, DrugDataResponse, Source } from '../types';

/**
 * openFDA + EMA data service.
 *
 * - FDA approval data (dates, sponsor, names, class, biosimilar/351(k) status)
 *   comes from the Drugs@FDA dataset via the public openFDA API.
 * - Indication text is enriched from the openFDA drug labeling endpoint.
 * - EMA marketing-authorisation dates come from a bundled snapshot of the EMA's
 *   official "Download medicine data" report (EMA has no live query API), keyed
 *   by INN. Regenerate with scripts/build-ema-data.py.
 *
 * Everything maps to a real regulatory record — nothing is model-generated.
 */

const DRUGSFDA_API = 'https://api.fda.gov/drug/drugsfda.json';
const LABEL_API = 'https://api.fda.gov/drug/label.json';

interface EmaRec { d: string; n: string; u: string; b: boolean; k?: number }
// A lookup answer: `exact` = matched by product name; otherwise the INN matched
// and `ambiguous` says several EU products share that substance (Itvisma vs
// Zolgensma, biosimilars) — then no product-specific date may be shown.
// ema-medicines.json is { generated, byInn, authorised, pipeline }; the FDA
// tabs enrich approvals from the INN index only. Starts empty; liveData.ts
// loads the shipped snapshot at startup.
let emaData: Record<string, EmaRec> = {};
let emaByName: Record<string, EmaRec> = {};

// Swap in a fresher snapshot fetched at runtime (see services/liveData.ts).
export const __setFdaEmaData = (d: { byInn?: Record<string, EmaRec>; byName?: Record<string, EmaRec> }): void => {
  emaData = d.byInn || {};
  emaByName = d.byName || {};
};

// CBER cell & gene therapy snapshot, keyed by BLA application number. These
// products are absent from Drugs@FDA, which carries no approval date or pharm
// class in the label endpoint — so we supply the official FDA approval date and
// a descriptive class here. Regenerate with scripts/build-cgt-data.py.
// n/g/m/i (brand, generic, manufacturer, indication) let the US tab list a
// product even when openFDA carries no label record for it yet (new approvals,
// cord-blood units, withdrawn products such as Roctavian or Beqvez).
interface CgtRec { d: string; c: string; n?: string; g?: string; m?: string; i?: string }
let cgtData: Record<string, CgtRec> = {};

// Swap in a fresher snapshot fetched at runtime (see services/liveData.ts).
export const __setCgtData = (d: Record<string, CgtRec>): void => { cgtData = d; };

const OPENFDA_SOURCE: Source = {
  title: 'Drugs@FDA — U.S. Food & Drug Administration (openFDA)',
  uri: 'https://open.fda.gov/apis/drug/drugsfda/',
};
const EMA_SOURCE: Source = {
  title: 'European Medicines Agency — medicine data (EPAR)',
  uri: 'https://www.ema.europa.eu/en/medicines/download-medicine-data',
};
const CBER_SOURCE: Source = {
  title: 'FDA CBER — Approved Cellular and Gene Therapy Products',
  uri: 'https://www.fda.gov/vaccines-blood-biologics/cellular-gene-therapy-products/approved-cellular-and-gene-therapy-products',
};
const LABEL_SOURCE: Source = {
  title: 'FDA Structured Product Labeling (openFDA drug labels)',
  uri: 'https://open.fda.gov/apis/drug/label/',
};
// FDA Oncology Center of Excellence — the authoritative running feed of
// oncology / hematologic-malignancy approval notifications. Surfaced when the
// result set is oncology-related.
const FDA_ONCOLOGY_SOURCE: Source = {
  title: 'FDA Oncology Center of Excellence — cancer & hematologic-malignancy approval notifications',
  uri: 'https://www.fda.gov/drugs/resources-information-approved-drugs/oncology-cancerhematologic-malignancies-approval-notifications#updates',
};

const ONC_RE = /neoplasm|carcinoma|\bcancer\b|\btumou?r\b|oncolog|antineoplastic|leukaemi|leukemi|lymphoma|myeloma|melanoma|sarcoma|glioma|malignan/i;
const isOncology = (d: Drug): boolean => ONC_RE.test(`${d.indication || ''} ${d.drugClass || ''}`);

// FDA's list of first-time generic (ANDA) approvals — the authoritative US
// generics register, complementing the EU Community Register.
const FDA_FIRST_GENERIC_SOURCE: Source = {
  title: 'FDA First Generic Drug Approvals — U.S. Food & Drug Administration',
  uri: 'https://www.fda.gov/drugs/drug-and-biologic-approval-and-ind-activity-reports/first-generic-drug-approvals',
};

// FDA records are ALL-CAPS; render them more readably.
const titleCase = (s?: string): string => {
  if (!s) return '';
  return s
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\b(Hcl|Hci|Xr|Er|Sr|Ir|Ii|Iii|Iv|Hd|Otc|Fda|Ema)\b/g, (m) => m.toUpperCase());
};

// "20240426" -> "2024-04-26"
const formatDate = (yyyymmdd?: string): string => {
  if (!yyyymmdd || yyyymmdd.length !== 8) return 'N/A';
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
};

const cleanClass = (cls?: string): string =>
  (cls || '').replace(/\s*\[(EPC|MoA|PE|CS|EXT)\]\s*$/i, '').trim();

const cleanIndication = (raw?: string): string => {
  if (!raw) return '';
  let t = raw.replace(/\s+/g, ' ').trim();
  t = t.replace(/^[\d.\s]*INDICATIONS\s+AND\s+USAGE[\s:.-]*/i, '').trim();
  if (t.length > 260) t = t.slice(0, 260).replace(/\s+\S*$/, '') + '…';
  return t;
};

// Look up an EMA marketing-authorisation record by active ingredient / generic
// name, trying the full normalized name and its first token (drops salt forms).
// Product identity first (brand names), substance second. A substance match
// shared by several EU products is returned with `ambiguous` so callers show
// 'same substance authorised' instead of another product's date and EPAR link.
type EmaHit = EmaRec & { ambiguous?: boolean };
const lookupEma = (names: (string | undefined)[], brands: (string | undefined)[] = []): EmaHit | undefined => {
  for (const b of brands) {
    const key = String(b || '').toLowerCase().trim();
    if (key && emaByName[key]) return emaByName[key];
  }
  for (const raw of names) {
    if (!raw) continue;
    const norm = raw.toLowerCase().trim();
    const hit = emaData[norm] || (() => { const first = norm.split(/[\s,;]+/)[0]; return first ? emaData[first] : undefined; })();
    if (hit) return hit.k && hit.k > 1 ? { ...hit, ambiguous: true } : hit;
  }
  return undefined;
};
// How an EMA hit is shown on a US-sourced card.
const emaDateFor = (ema: EmaHit | undefined): string => (ema ? (ema.ambiguous ? `Same substance in EU (${ema.n}, ${ema.d})` : ema.d) : 'Not in EMA');
const emaUrlFor = (ema: EmaHit | undefined): string | undefined => (ema && !ema.ambiguous ? ema.u || undefined : undefined);

// Public EMA-by-substance lookup (date + EPAR url) for offline enrichment of the
// curated disease catalog. Returns the earliest central MA record for an INN.
export const lookupEmaRec = (name: string): { d: string; u: string } | undefined => {
  const r = lookupEma([name]);
  return r ? { d: r.d, u: r.u } : undefined;
};

interface FdaSubmission {
  submission_type?: string;
  submission_status?: string;
  submission_status_date?: string;
  submission_class_code?: string;
}
interface FdaResult {
  application_number?: string;
  sponsor_name?: string;
  submissions?: FdaSubmission[];
  products?: Array<{
    brand_name?: string;
    reference_drug?: string;
    dosage_form?: string;
    route?: string;
    active_ingredients?: Array<{ name?: string }>;
  }>;
  openfda?: {
    generic_name?: string[];
    brand_name?: string[];
    substance_name?: string[];
    pharm_class_epc?: string[];
    pharm_class_moa?: string[];
    manufacturer_name?: string[];
  };
}

const mapResult = (r: FdaResult, id: number): { drug: Drug; appNo?: string } | null => {
  const products = r.products || [];
  if (products.length === 0) return null;

  const product = products.find((p) => p.reference_drug === 'Yes') || products[0];
  const of = r.openfda || {};

  const orig = (r.submissions || []).find(
    (s) => s.submission_type === 'ORIG' && s.submission_status === 'AP'
  );

  // 351(k) biosimilar = a submission carries the BIOSIMILAR class code.
  const is351k = (r.submissions || []).some(
    (s) => (s.submission_class_code || '').toUpperCase() === 'BIOSIMILAR'
  );

  const brandName =
    titleCase(product.brand_name) || titleCase(of.brand_name?.[0]) || 'Unknown';

  const ingredientNames = (product.active_ingredients || []).map((a) => a.name).filter(Boolean) as string[];
  const genericName =
    titleCase(of.generic_name?.[0]) || titleCase(ingredientNames.join(', ')) || '—';

  const drugClass =
    cleanClass(of.pharm_class_epc?.[0]) ||
    cleanClass(of.pharm_class_moa?.[0]) ||
    [titleCase(product.dosage_form), titleCase(product.route)].filter(Boolean).join(' · ') ||
    '';

  const company = titleCase(r.sponsor_name) || titleCase(of.manufacturer_name?.[0]) || '—';

  // EMA approval date by INN / active ingredient.
  const ema = lookupEma([
    of.generic_name?.[0],
    of.substance_name?.[0],
    ingredientNames[0],
  ], [product.brand_name, ...(of.brand_name || [])]);

  return {
    appNo: r.application_number,
    drug: {
      id,
      brandName,
      genericName,
      indication: '', // filled in by enrichWithIndications()
      drugClass: drugClass || undefined,
      company,
      fdaApprovalDate: formatDate(orig?.submission_status_date),
      emaApprovalDate: emaDateFor(ema),
      emaUrl: emaUrlFor(ema),
      is351k,
      applicationDate351k: is351k ? formatDate(orig?.submission_status_date) : undefined,
    },
  };
};

interface LabelResult {
  indications_and_usage?: string[];
  openfda?: {
    application_number?: string[];
    brand_name?: string[];
    generic_name?: string[];
    substance_name?: string[];
    manufacturer_name?: string[];
    pharm_class_epc?: string[];
    pharm_class_moa?: string[];
    route?: string[];
  };
}

const enrichWithIndications = async (drugs: Drug[], appNos: (string | undefined)[]): Promise<void> => {
  const valid = appNos.filter((a): a is string => !!a);
  if (valid.length === 0) return;
  try {
    const clause = valid.map((a) => `"${a}"`).join(' ');
    const params = new URLSearchParams({
      search: `openfda.application_number:(${clause})`,
      limit: '100',
    });
    const res = await fetch(`${LABEL_API}?${params.toString()}`);
    if (!res.ok) return;
    const json = await res.json();
    const results: LabelResult[] = json.results || [];
    const byApp = new Map<string, string>();
    for (const r of results) {
      const indication = cleanIndication(r.indications_and_usage?.[0]);
      if (!indication) continue;
      for (const app of r.openfda?.application_number || []) {
        if (!byApp.has(app)) byApp.set(app, indication);
      }
    }
    drugs.forEach((drug, i) => {
      const app = appNos[i];
      if (app && byApp.has(app)) drug.indication = byApp.get(app)!;
    });
  } catch {
    /* best-effort */
  }
};

const buildSources = (drugs: Drug[], usedLabelApi = false, usedCber = false): Source[] => {
  if (!drugs.length) return [];
  const sources = [OPENFDA_SOURCE];
  if (usedLabelApi) sources.push(LABEL_SOURCE);
  if (usedCber) sources.push(CBER_SOURCE);
  if (drugs.some((d) => d.emaApprovalDate && d.emaApprovalDate !== 'Not in EMA')) {
    sources.push(EMA_SOURCE);
  }
  if (drugs.some(isOncology)) sources.push(FDA_ONCOLOGY_SOURCE);
  sources.push(FDA_FIRST_GENERIC_SOURCE);
  return sources;
};

// Map an SPL label record to a Drug. Used as a fallback for products that are
// NOT in Drugs@FDA — chiefly CBER-regulated cell & gene therapies (e.g. Casgevy,
// CAR-T) and other biologics. The label endpoint has no reliable approval date
// (effective_time is the label-revision date), so fdaApprovalDate is left 'N/A'.
const mapLabelResult = (r: LabelResult, id: number): Drug | null => {
  const of = r.openfda || {};
  const brandName = titleCase(of.brand_name?.[0]);
  const genericName = titleCase(of.generic_name?.[0]) || titleCase(of.substance_name?.[0]);
  if (!brandName && !genericName) return null;

  // Enrich CBER cell/gene therapies with the curated FDA approval date & class.
  const cgt = cgtData[of.application_number?.[0] || ''];

  const drugClass =
    cgt?.c ||
    cleanClass(of.pharm_class_epc?.[0]) ||
    cleanClass(of.pharm_class_moa?.[0]) ||
    titleCase(of.route?.[0]) ||
    undefined;

  const ema = lookupEma([of.generic_name?.[0], of.substance_name?.[0]], of.brand_name || []);

  return {
    id,
    brandName: brandName || 'Unknown',
    genericName: genericName || '—',
    indication: cleanIndication(r.indications_and_usage?.[0]),
    drugClass,
    company: titleCase(of.manufacturer_name?.[0]) || '—',
    fdaApprovalDate: cgt ? cgt.d : 'N/A',
    emaApprovalDate: emaDateFor(ema),
    emaUrl: emaUrlFor(ema),
  };
};

// Search the SPL label endpoint as a fallback when Drugs@FDA has no match.
// This also covers DISEASE / INDICATION searches (e.g. "multiple myeloma"),
// which the Drugs@FDA endpoint can't match — only the label carries the
// indications_and_usage text. This mirrors the Europe tab, which already
// searches therapeutic area + indication.
const searchLabels = async (query: string): Promise<Drug[]> => {
  const q = query.trim();
  if (!q) return [];
  const fields = [
    'openfda.brand_name',
    'openfda.generic_name',
    'openfda.substance_name',
    'openfda.manufacturer_name',
    'openfda.pharm_class_epc',
    'indications_and_usage',
  ];
  const orClause = fields.map((f) => `${f}:"${q}"`).join(' ');
  // Fetch a wider slice so the branded-first sort + generic dedupe below has
  // material to work with, then cap the rendered list at 20.
  const params = new URLSearchParams({ search: `(${orClause})`, limit: '50' });

  const res = await fetch(`${LABEL_API}?${params.toString()}`);
  if (res.status === 404 || !res.ok) return [];

  const json = await res.json();
  const results: LabelResult[] = json.results || [];

  // A disease search returns mostly generic (ANDA) copies; the branded
  // originator (BLA/NDA) products are far more useful, so surface them first.
  const rank = (r: LabelResult): number => {
    const app = (r.openfda?.application_number?.[0] || '').toUpperCase();
    if (app.startsWith('BLA')) return 0;
    if (app.startsWith('NDA')) return 1;
    return 2; // ANDA / unknown
  };
  results.sort((a, b) => rank(a) - rank(b));

  // Dedupe by active ingredient so a disease search doesn't return a dozen
  // identical generics; fall back to brand name when no ingredient is present.
  const seen = new Set<string>();
  const drugs: Drug[] = [];
  for (const r of results) {
    const of = r.openfda || {};
    const key = (
      of.generic_name?.[0] || of.substance_name?.[0] || of.brand_name?.[0] || ''
    ).toLowerCase();
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    const drug = mapLabelResult(r, drugs.length + 1);
    if (drug) drugs.push(drug);
    if (drugs.length >= 20) break;
  }
  return drugs;
};

const requestDrugs = async (search: string, sort?: string, limit = 30): Promise<Drug[]> => {
  const params = new URLSearchParams({ search });
  if (sort) params.set('sort', sort);
  params.set('limit', String(limit));

  const res = await fetch(`${DRUGSFDA_API}?${params.toString()}`);
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`openFDA request failed (${res.status}).`);

  const json = await res.json();
  const results: FdaResult[] = json.results || [];

  const seen = new Set<string>();
  const drugs: Drug[] = [];
  const appNos: (string | undefined)[] = [];
  for (const r of results) {
    const key = r.application_number || JSON.stringify(r.products?.[0]);
    if (seen.has(key)) continue;
    seen.add(key);
    const mapped = mapResult(r, drugs.length + 1);
    if (mapped) {
      drugs.push(mapped.drug);
      appNos.push(mapped.appNo);
    }
    if (drugs.length >= 20) break;
  }

  await enrichWithIndications(drugs, appNos);
  return drugs;
};

/** Default view: most recent notable FDA approvals (branded NDAs/BLAs with a known drug class). */
export const fetchRecentDrugApprovals = async (): Promise<DrugDataResponse> => {
  try {
    const search =
      'openfda.product_type:"HUMAN PRESCRIPTION DRUG"' +
      ' AND _exists_:openfda.pharm_class_epc' +
      ' AND submissions.submission_type:ORIG' +
      ' AND submissions.submission_status:AP';
    const drugs = await requestDrugs(search, 'submissions.submission_status_date:desc');
    return { drugs, sources: buildSources(drugs) };
  } catch (error) {
    console.error('Error fetching recent FDA approvals:', error);
    throw new Error('Failed to load FDA approvals. Please check your connection and try again.');
  }
};

// --- CBER snapshot search -----------------------------------------------------
// The curated cell & gene therapy list (cgt-products.json) is searched directly,
// so a product surfaces even when neither Drugs@FDA nor the label endpoint has
// a record for it. Matches brand, generic, manufacturer, class and indication.
const norm = (t: string): string =>
  t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const cgtToDrug = (bla: string, r: CgtRec, id: number): Drug => {
  const ema = lookupEma([r.g], [r.n]);
  return {
    id,
    brandName: r.n || bla,
    genericName: r.g || '—',
    indication: r.i || '',
    drugClass: r.c,
    company: r.m || '—',
    fdaApprovalDate: r.d,
    emaApprovalDate: emaDateFor(ema),
    emaUrl: emaUrlFor(ema),
  };
};

const searchCgtSnapshot = (query: string): Drug[] => {
  const q = norm(query.trim());
  if (q.length < 3) return [];
  const terms = q.split(/\s+/).filter(Boolean);
  const hits = Object.entries(cgtData)
    .filter(([bla, r]) => {
      if (!r.n) return false; // legacy snapshot without names
      const hay = norm(`${r.n} ${r.g || ''} ${r.m || ''} ${r.c} ${r.i || ''} ${bla}`);
      return terms.every((t) => hay.includes(t));
    })
    .sort((a, b) => b[1].d.localeCompare(a[1].d)); // newest approval first
  return hits.map(([bla, r], i) => cgtToDrug(bla, r, i + 1));
};

// Append snapshot products that the API results don't already contain
// (same brand or same generic name), renumbering ids so keys stay unique.
const mergeCgt = (drugs: Drug[], query: string): { drugs: Drug[]; added: boolean } => {
  const extra = searchCgtSnapshot(query);
  if (!extra.length) return { drugs, added: false };
  const seen = new Set<string>();
  drugs.forEach((d) => { seen.add(norm(d.brandName)); seen.add(norm(d.genericName)); });
  const fresh = extra.filter((d) => !seen.has(norm(d.brandName)) && !seen.has(norm(d.genericName)));
  if (!fresh.length) return { drugs, added: false };
  const merged = [...drugs, ...fresh].map((d, i) => ({ ...d, id: i + 1 }));
  return { drugs: merged, added: true };
};

const is351kQuery = (q: string): boolean =>
  /351\s*\(?k\)?|biosimilar/i.test(q);

// The "Generic" US chip: ANDA applications are the US generic-drug approvals.
const isGenericQuery = (q: string): boolean => /^generics?$/i.test(q.trim());

/** Search by brand, generic/ingredient, sponsor, class — or list 351(k) biosimilars. */
export const searchDrugDatabase = async (query: string): Promise<DrugDataResponse> => {
  const q = query.trim();
  if (!q) return { drugs: [], sources: [] };

  try {
    let search: string;
    if (is351kQuery(q)) {
      // All FDA-approved 351(k) biosimilars (pending applications are not
      // published by the FDA, so only approved biosimilars are available).
      search = 'submissions.submission_class_code:BIOSIMILAR AND submissions.submission_status:AP';
    } else if (isGenericQuery(q)) {
      // US generic-drug approvals = ANDA applications, most recently approved first.
      search = 'application_number:ANDA* AND submissions.submission_status:AP';
    } else {
      const fields = [
        'openfda.brand_name',
        'openfda.generic_name',
        'openfda.substance_name',
        'sponsor_name',
        'openfda.pharm_class_epc',
      ];
      const orClause = fields.map((f) => `${f}:"${q}"`).join(' ');
      search = `(${orClause}) AND submissions.submission_status:AP`;
    }
    const special = is351kQuery(q) || isGenericQuery(q);
    const drugs = await requestDrugs(search, 'submissions.submission_status_date:desc');
    if (drugs.length > 0) {
      if (special) return { drugs, sources: buildSources(drugs) };
      const m = mergeCgt(drugs, q);
      return { drugs: m.drugs, sources: buildSources(m.drugs, false, m.added) };
    }

    // Drugs@FDA covers CDER products; CBER cell & gene therapies and some other
    // biologics (Casgevy, CAR-T, etc.) only appear in the SPL label endpoint.
    // Fall back to it, then top up from the curated CBER snapshot so products
    // without any openFDA record still surface.
    if (!special) {
      const labelDrugs = await searchLabels(q);
      const m = mergeCgt(labelDrugs, q);
      return { drugs: m.drugs, sources: buildSources(m.drugs, labelDrugs.length > 0, m.added) };
    }
    return { drugs, sources: buildSources(drugs) };
  } catch (error) {
    console.error('Error searching FDA data:', error);
    throw new Error(`Failed to search for "${query}". Please try again.`);
  }
};
