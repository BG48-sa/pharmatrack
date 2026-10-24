/**
 * Sentence-level comparison of two label sections (EU SmPC vs US Prescribing
 * Information, or two EU labels) for the comparison panel's "highlight
 * differences" view.
 *
 * Why not a plain word diff: the SmPC and the USPI are written by different
 * authors in different regulatory styles, so a raw word diff lights up nearly
 * everything. What an assessor wants to see is the CLAIM that exists on one
 * side only (a population, a line of therapy, a contraindication, a boxed
 * warning) and the NUMBER that differs inside an otherwise matching sentence
 * (dose, age limit, threshold). So:
 *
 *   1. each section is cut into units — sentences for prose, one unit per
 *      aligned table block (pdftotext columns on the EU side);
 *   2. units are matched across the two sides by token overlap (Dice
 *      coefficient on content words, cross-reference markers such as "( 1.1 )"
 *      or "(see section 5.1)" removed first), greedily, best pair first;
 *   3. an unmatched unit is "unique" to its side; a matched pair whose tokens
 *      differ is "changed", with the differing words marked and numbers that
 *      differ marked separately.
 *
 * Deterministic, runs in the browser on bundled text, no network. The result
 * carries the ORIGINAL text, so the rendering never shows normalised tokens.
 */

export type UnitKind = 'same' | 'unique' | 'changed' | 'heading';
export type WordKind = 'same' | 'diff' | 'num';

export interface DiffWord { t: string; k: WordKind }
export interface DiffUnit {
  /** Original text of the sentence / table block. */
  text: string;
  k: UnitKind;
  /** Index of the source line the unit came from (prose is re-joined per line). */
  line: number;
  /** Aligned table block — rendered monospace, compared as one unit. */
  table?: boolean;
  /** For 'changed' units: the text split into whitespace chunks with their mark. */
  words?: DiffWord[];
  /** Overlap with the matched unit on the other side (0–1), for 'same'/'changed'. */
  sim?: number;
  /** Index of the matched unit on the other side, for 'same'/'changed'. */
  pair?: number;
}

export interface SectionDiff {
  a: DiffUnit[];
  b: DiffUnit[];
  stats: { uniqueA: number; uniqueB: number; changed: number; unitsA: number; unitsB: number };
}

/** Two units are the same statement when their (IDF-weighted) content-word overlap is at least this. */
export const MATCH_THRESHOLD = 0.4;
/** Sections whose pairwise comparison would exceed this many unit pairs are not diffed. */
const MAX_PAIRS = 400_000;

const STOP = new Set(['a', 'an', 'the', 'of', 'in', 'for', 'and', 'or', 'with', 'to', 'is', 'are', 'as', 'by', 'be', 'at', 'on', 'this', 'that', 'it', 'its', 'see', 'section', 'who', 'have', 'has', 'been', 'after', 'following']);

// The two labels say the same thing in two regulatory dialects. Before matching,
// multi-word phrases and British/American spellings are folded to one form —
// only for MATCHING; the rendered text is always the original.
const PHRASES: [RegExp, string][] = [
  [/\bsingle[- ]agent\b/g, 'monotherapy'],
  [/\bas monotherapy\b/g, 'monotherapy'],
  [/\bfirst[- ]line\b/g, 'firstline'], [/\bsecond[- ]line\b/g, 'secondline'], [/\bthird[- ]line\b/g, 'thirdline'],
  [/\bp(a)?ediatric patients?\b/g, 'pediatric'], [/\badolescents?\b/g, 'pediatric'], [/\bchildren\b/g, 'pediatric'],
  [/\baged (\d+) years and (older|above)\b/g, '$1 years and older'], [/\b(\d+) years of age and (older|above)\b/g, '$1 years and older'],
  [/\bin combination with\b/g, 'with'], [/\bcombined with\b/g, 'with'],
  [/\bprotein[- ]bound paclitaxel\b/g, 'nabpaclitaxel'], [/\bpaclitaxel protein[- ]bound\b/g, 'nabpaclitaxel'], [/\bnab[- ]paclitaxel\b/g, 'nabpaclitaxel'],
  [/\bplatinum[- ](containing|based) chemotherapy\b/g, 'platinum chemotherapy'],
  [/\bdisease progression\b/g, 'progression'], [/\bprogressed\b/g, 'progression'],
  [/\bprior (therapy|treatment)\b/g, 'priortherapy'], [/\bprevious (therapy|treatment)\b/g, 'priortherapy'],
  [/\bmarketing authori[sz]ation\b/g, 'approval'],
];
const SYNONYMS: Record<string, string> = {
  tumour: 'tumor', tumours: 'tumors', carcinoma: 'cancer', carcinomas: 'cancers', neoplasm: 'cancer', malignancy: 'cancer',
  oesophageal: 'esophageal', oesophagus: 'esophagus', haematological: 'hematological', haematologic: 'hematologic',
  leukaemia: 'leukemia', anaemia: 'anemia', oedema: 'edema', diarrhoea: 'diarrhea', paediatric: 'pediatric',
  authorised: 'approved', authorized: 'approved', medicinal: 'drug', product: 'drug',
  adults: 'adult', patients: 'patient', dosage: 'dose', doses: 'dose', dosing: 'dose', recommended: 'recommend',
  administered: 'administer', administration: 'administer', infusion: 'infuse', infused: 'infuse', intravenously: 'intravenous',
  indicated: 'indicate', indication: 'indicate', treatment: 'treat', treating: 'treat', therapy: 'treat',
  weeks: 'week', wk: 'week', q3w: 'every 3 week', q6w: 'every 6 week', q2w: 'every 2 week', q4w: 'every 4 week',
  minutes: 'minute', min: 'minute', hours: 'hour', hrs: 'hour', hr: 'hour', days: 'day', months: 'month', years: 'year', yrs: 'year',
  // Oncology abbreviations the US label uses where the EU spells the disease out.
  nsclc: 'non small cell lung cancer', sclc: 'small cell lung cancer', hnscc: 'head neck squamous cell cancer',
  rcc: 'renal cell cancer', ccrcc: 'clear cell renal cell cancer', hcc: 'hepatocellular cancer', mcc: 'merkel cell cancer',
  tnbc: 'triple negative breast cancer', crc: 'colorectal cancer', chl: 'classical hodgkin lymphoma',
  pmbcl: 'primary mediastinal large b cell lymphoma', cscc: 'cutaneous squamous cell cancer', mpm: 'malignant pleural mesothelioma',
  btc: 'biliary tract cancer', gej: 'gastroesophageal junction', nmibc: 'non muscle invasive bladder cancer', mibc: 'muscle invasive bladder cancer',
  dlbcl: 'diffuse large b cell lymphoma', aml: 'acute myeloid leukemia', all: 'acute lymphoblastic leukemia', cll: 'chronic lymphocytic leukemia',
  cml: 'chronic myeloid leukemia', mm: 'multiple myeloma', gist: 'gastrointestinal stromal tumor', msi: 'microsatellite instability',
  dmmr: 'mismatch repair deficient', tmb: 'tumor mutational burden', gastro: 'gastro', oesophagogastric: 'esophagogastric',
};

const fold = (s: string): string => {
  let t = s.toLowerCase();
  for (const [re, rep] of PHRASES) t = t.replace(re, rep);
  return t;
};

// A line with ≥2 runs of multiple spaces is an aligned table row (pdftotext, EU side).
const isTabularLine = (l: string): boolean => (l.match(/ {2,}/g) || []).length >= 2;

/** Cross-reference markers carry no clinical content and differ by convention per jurisdiction. */
const stripRefs = (s: string): string =>
  s
    .replace(/\(\s*\d+(?:\.\d+)*(?:\s*,\s*\d+(?:\.\d+)*)*\s*\)/g, ' ')   // US "( 1.1 )", "(2.3)", "( 1.18 , 2.1 )"
    .replace(/\(\s*see\s+sections?[^)]*\)/gi, ' ')            // EU "(see section 5.1)"
    .replace(/\[see[^\]]*\]/gi, ' ');                          // US "[see Warnings and Precautions (5.2)]"

const isNumeric = (t: string): boolean => /^\d/.test(t);

/** Content tokens of a text: lower-case, accents removed, numbers kept with their decimals ("2.5", "12"). */
export const tokens = (s: string): string[] => {
  const norm = fold(stripRefs(s)).normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  const out: string[] = [];
  for (const m of norm.matchAll(/[a-z0-9]+(?:[.,][0-9]+)?/g)) {
    const t = m[0].replace(',', '.');
    if (STOP.has(t) || (t.length <= 1 && !isNumeric(t))) continue;
    const syn = SYNONYMS[t];
    if (syn && syn.includes(' ')) out.push(...syn.split(' ')); else out.push(syn || t);
  }
  return out;
};

/** A heading / product-presentation line, not a claim: short, no sentence punctuation, no number; or a "▸ BRAND 25 mg/mL …" line. */
export const isHeading = (text: string): boolean => {
  const t = text.trim();
  if (/^[▸•]/.test(t) && /\b(mg|ml|mg\/ml|tablets?|capsules?|solution|concentrate|injection|powder|suspension)\b/i.test(t)) return true;
  if (/^\d+(\.\d+)*\s+[A-Z][A-Z\s&/,-]{3,}$/.test(t)) return true;                       // "4 CONTRAINDICATIONS"
  return !/[.;:]\s*$/.test(t) && t.split(/\s+/).length <= 8 && !/\d/.test(t);
};

/** US subsection titles run into their first sentence: "1.5 Classical Hodgkin Lymphoma KEYTRUDA is indicated…". */
const stripSubsectionTitle = (t: string): string => t.replace(/^\d+\.\d+\s+(?:[A-Z][A-Za-z-]*\s+){1,7}(?=[A-Z]{3,}\b)/, '');

/** US sections open with their number + capitalised title on the same line as the text: "1 INDICATIONS AND USAGE X is…". */
const stripSectionTitle = (text: string): string =>
  text.replace(/^\s*\d+(?:\.\d+)*\s+(?:[A-Z][A-Z&/,()-]*\s+)+?(?=[A-Z][a-z]|[A-Z0-9][A-Za-z0-9-]*\s+[a-z])/, '');

const counts = (ts: string[]): Map<string, number> => {
  const m = new Map<string, number>();
  for (const t of ts) m.set(t, (m.get(t) || 0) + 1);
  return m;
};

/** Similarity of two token multisets (0 = nothing shared, 1 = identical): the Dice
 *  coefficient, or — when one side is much longer (the EU sentence carries the
 *  qualifiers, the US Highlights line just the claim) — the overlap coefficient
 *  (shared / smaller side) slightly discounted, so containment counts as a match.
 *  With `weight`, each token counts by its weight (IDF: a word in every sentence of
 *  the section — the brand name, "indicated", "patients" — says nothing about which
 *  sentence this is). */
export const similarity = (a: string[], b: string[], weight?: (t: string) => number): number => {
  if (!a.length || !b.length) return 0;
  const w = weight || (() => 1);
  const ca = counts(a), cb = counts(b);
  let shared = 0, wa = 0, wb = 0;
  for (const [t, n] of ca) { shared += Math.min(n, cb.get(t) || 0) * w(t); wa += n * w(t); }
  for (const [t, n] of cb) wb += n * w(t);
  if (!wa || !wb) return 0;
  const dice = (2 * shared) / (wa + wb);
  const overlap = shared / Math.min(wa, wb);
  return Math.max(dice, 0.85 * overlap);
};

/** log-scaled inverse document frequency over the units of both sides. */
const idf = (sides: string[][][]): ((t: string) => number) => {
  const df = new Map<string, number>();
  let n = 0;
  for (const side of sides) for (const ts of side) { n++; for (const t of new Set(ts)) df.set(t, (df.get(t) || 0) + 1); }
  return (t) => Math.log(1 + n / (df.get(t) || 1));
};

/** Cut one prose line into sentences. No lookbehind (older WebKit), so the cut is done by scanning. */
const splitSentences = (line: string): string[] => {
  const out: string[] = [];
  let start = 0;
  // Sentence ends: ". " / "; " followed by a capital, digit, bullet or bracket;
  // and the start of a US sub-indication "( 1.2 )" marker's following clause.
  const re = /[.;]\s+(?=[A-Z0-9(•▸\-–])|\(\s*\d[\d., ]*\)\s+(?=[A-Za-z(•▸\-–])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    const cut = m[0].startsWith('(') ? m.index + m[0].trimEnd().length : m.index + 1;
    const piece = line.slice(start, cut).trim();
    // Keep abbreviations / decimals ("e.g.", "i.e.", "vs.", "approx.", "mg/kg.") together.
    if (/\b(e\.g|i\.e|vs|approx|etc|no|Fig|Tab|incl|resp)\.$/i.test(piece) || /\d\.$/.test(piece)) continue;
    // A bare cross-reference marker "( 1.2 )" belongs to the claim before it.
    if (piece && /^\(\s*\d[\d., ]*\)$/.test(piece) && out.length) out[out.length - 1] += ' ' + piece;
    else if (piece) out.push(piece);
    start = cut;
  }
  const rest = line.slice(start).trim();
  if (rest && /^\(\s*\d[\d., ]*\)$/.test(rest) && out.length) out[out.length - 1] += ' ' + rest;
  else if (rest) out.push(rest);
  return out;
};

/** Units of a section: sentences per prose line, one unit per aligned table block. */
export const splitUnits = (text: string): { text: string; line: number; table?: boolean }[] => {
  const units: { text: string; line: number; table?: boolean }[] = [];
  const lines = stripSectionTitle(text.replace(/\uF0B7/g, '•')).split('\n');
  let i = 0, lineNo = 0;
  while (i < lines.length) {
    if (isTabularLine(lines[i])) {
      let j = i;
      while (j < lines.length && isTabularLine(lines[j])) j++;
      if (j - i >= 2) { units.push({ text: lines.slice(i, j).join('\n'), line: lineNo++, table: true }); i = j; continue; }
    }
    const line = lines[i].replace(/ {2,}/g, ' ').trim();
    if (line) for (const s of splitSentences(line)) units.push({ text: stripSubsectionTitle(s), line: lineNo });
    lineNo++;
    i++;
  }
  return units;
};

/** Loosely matched pairs (below this overlap) get only their differing NUMBERS marked: marking every
 *  differing word in a sentence that is mostly rephrased would just paint the whole sentence. */
export const WORD_MARK_THRESHOLD = 0.75;

/** Whitespace chunks of a sentence marked by whether their tokens are among the side's unshared tokens. */
const markWords = (text: string, unshared: Map<string, number>, words: boolean): DiffWord[] => {
  const left = new Map(unshared);
  return text.split(/(\s+)/).map((chunk) => {
    if (!chunk.trim()) return { t: chunk, k: 'same' as WordKind };
    let k: WordKind = 'same';
    for (const t of tokens(chunk)) {
      const n = left.get(t) || 0;
      if (n > 0) { left.set(t, n - 1); if (isNumeric(t)) k = 'num'; else if (words && k !== 'num') k = 'diff'; }
    }
    return { t: chunk, k };
  });
};

const unsharedTokens = (mine: string[], theirs: string[]): Map<string, number> => {
  const ct = counts(theirs), out = new Map<string, number>();
  for (const [t, n] of counts(mine)) if (n > (ct.get(t) || 0)) out.set(t, n - (ct.get(t) || 0));
  return out;
};

/**
 * Compare two section texts. Returns null when either side is empty or the
 * sections are too large to compare in the browser (the panel then shows the
 * plain text, as before).
 */
export const diffSections = (textA: string, textB: string, threshold = MATCH_THRESHOLD): SectionDiff | null => {
  if (!textA?.trim() || !textB?.trim()) return null;
  const ua = splitUnits(textA), ub = splitUnits(textB);
  if (!ua.length || !ub.length || ua.length * ub.length > MAX_PAIRS) return null;
  const ta = ua.map((u) => tokens(u.text)), tb = ub.map((u) => tokens(u.text));
  const ha = ua.map((u) => !u.table && isHeading(u.text)), hb = ub.map((u) => !u.table && isHeading(u.text));
  const w = idf([ta, tb]);

  // Every candidate pair above the threshold, best first; greedy one-to-one assignment.
  const pairs: { i: number; j: number; s: number }[] = [];
  for (let i = 0; i < ua.length; i++) {
    if (!ta[i].length || ha[i]) continue;
    for (let j = 0; j < ub.length; j++) {
      if (!tb[j].length || hb[j] || !!ua[i].table !== !!ub[j].table) continue;
      const s = similarity(ta[i], tb[j], w);
      if (s >= threshold) pairs.push({ i, j, s });
    }
  }
  pairs.sort((x, y) => y.s - x.s);
  const matchA = new Map<number, { j: number; s: number }>(), matchB = new Map<number, { i: number; s: number }>();
  for (const p of pairs) {
    if (matchA.has(p.i) || matchB.has(p.j)) continue;
    matchA.set(p.i, { j: p.j, s: p.s });
    matchB.set(p.j, { i: p.i, s: p.s });
  }
  // A label can state one claim twice (the EU SmPC repeats 4.1 per presentation;
  // the US PI has Highlights and the full section). A unit still unmatched may
  // pair with a counterpart that already has a partner — a repeat is not a difference.
  for (const p of pairs) {
    if (!matchA.has(p.i)) matchA.set(p.i, { j: p.j, s: p.s });
    if (!matchB.has(p.j)) matchB.set(p.j, { i: p.i, s: p.s });
  }

  const build = (units: typeof ua, mine: string[][], theirs: string[][], heads: boolean[], match: Map<number, { j: number; s: number }>): DiffUnit[] =>
    units.map((u, i) => {
      if (heads[i]) return { ...u, k: 'heading' };
      const m = match.get(i);
      if (!m) return { ...u, k: mine[i].some((t) => !isNumeric(t)) ? 'unique' : 'same' };
      const unshared = unsharedTokens(mine[i], theirs[m.j]);
      // A number the counterpart states in its neighbouring sentence is not a
      // difference: the US Highlights split one EU sentence into two lines
      // ("…melanoma. ( 1.1 ) for the adjuvant treatment of adult and pediatric (12 years and older)…").
      for (const t of [...unshared.keys()]) {
        if (isNumeric(t) && [theirs[m.j - 1], theirs[m.j + 1]].some((n) => n && n.includes(t))) unshared.delete(t);
      }
      if (!unshared.size) return { ...u, k: 'same', sim: m.s, pair: m.j };
      return { ...u, k: 'changed', sim: m.s, pair: m.j, words: u.table ? undefined : markWords(u.text, unshared, m.s >= WORD_MARK_THRESHOLD) };
    });

  const a = build(ua, ta, tb, ha, matchA);
  const b = build(ub, tb, ta, hb, new Map([...matchB].map(([j, v]) => [j, { j: v.i, s: v.s }])));
  return {
    a,
    b,
    stats: {
      uniqueA: a.filter((u) => u.k === 'unique').length,
      uniqueB: b.filter((u) => u.k === 'unique').length,
      changed: a.filter((u) => u.k === 'changed').length,
      unitsA: a.length,
      unitsB: b.length,
    },
  };
};
