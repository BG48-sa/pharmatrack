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

export type UnitKind = 'same' | 'unique' | 'changed';
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
}

export interface SectionDiff {
  a: DiffUnit[];
  b: DiffUnit[];
  stats: { uniqueA: number; uniqueB: number; changed: number; unitsA: number; unitsB: number };
}

/** Two units are the same statement when their content-word overlap is at least this. */
export const MATCH_THRESHOLD = 0.55;
/** Sections whose pairwise comparison would exceed this many unit pairs are not diffed. */
const MAX_PAIRS = 400_000;

const STOP = new Set(['a', 'an', 'the', 'of', 'in', 'for', 'and', 'or', 'with', 'to', 'is', 'are', 'as', 'by', 'be', 'at', 'on', 'this', 'that', 'it', 'its', 'see', 'section']);

// A line with ≥2 runs of multiple spaces is an aligned table row (pdftotext, EU side).
const isTabularLine = (l: string): boolean => (l.match(/ {2,}/g) || []).length >= 2;

/** Cross-reference markers carry no clinical content and differ by convention per jurisdiction. */
const stripRefs = (s: string): string =>
  s
    .replace(/\(\s*\d+(?:\.\d+)*\s*\)/g, ' ')                 // US "( 1.1 )", "(2.3)"
    .replace(/\(\s*see\s+sections?[^)]*\)/gi, ' ')            // EU "(see section 5.1)"
    .replace(/\[see[^\]]*\]/gi, ' ');                          // US "[see Warnings and Precautions (5.2)]"

const isNumeric = (t: string): boolean => /^\d/.test(t);

/** Content tokens of a text: lower-case, accents removed, numbers kept with their decimals ("2.5", "12"). */
export const tokens = (s: string): string[] => {
  const norm = stripRefs(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
  const out: string[] = [];
  for (const m of norm.matchAll(/[a-z0-9]+(?:[.,][0-9]+)?/g)) {
    const t = m[0].replace(',', '.');
    if (!STOP.has(t) && (t.length > 1 || isNumeric(t))) out.push(t);
  }
  return out;
};

const counts = (ts: string[]): Map<string, number> => {
  const m = new Map<string, number>();
  for (const t of ts) m.set(t, (m.get(t) || 0) + 1);
  return m;
};

/** Dice coefficient on token multisets (0 = nothing shared, 1 = identical). */
export const similarity = (a: string[], b: string[]): number => {
  if (!a.length || !b.length) return 0;
  const ca = counts(a), cb = counts(b);
  let shared = 0;
  for (const [t, n] of ca) shared += Math.min(n, cb.get(t) || 0);
  return (2 * shared) / (a.length + b.length);
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
  const lines = text.replace(//g, '•').split('\n');
  let i = 0, lineNo = 0;
  while (i < lines.length) {
    if (isTabularLine(lines[i])) {
      let j = i;
      while (j < lines.length && isTabularLine(lines[j])) j++;
      if (j - i >= 2) { units.push({ text: lines.slice(i, j).join('\n'), line: lineNo++, table: true }); i = j; continue; }
    }
    const line = lines[i].replace(/ {2,}/g, ' ').trim();
    if (line) for (const s of splitSentences(line)) units.push({ text: s, line: lineNo });
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

  // Every candidate pair above the threshold, best first; greedy one-to-one assignment.
  const pairs: { i: number; j: number; s: number }[] = [];
  for (let i = 0; i < ua.length; i++) {
    if (!ta[i].length) continue;
    for (let j = 0; j < ub.length; j++) {
      if (!tb[j].length || !!ua[i].table !== !!ub[j].table) continue;
      const s = similarity(ta[i], tb[j]);
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

  const build = (units: typeof ua, mine: string[][], theirs: string[][], match: Map<number, { j: number; s: number }>): DiffUnit[] =>
    units.map((u, i) => {
      const m = match.get(i);
      if (!m) return { ...u, k: mine[i].length ? 'unique' : 'same' };
      const unshared = unsharedTokens(mine[i], theirs[m.j]);
      if (!unshared.size) return { ...u, k: 'same', sim: m.s };
      return { ...u, k: 'changed', sim: m.s, words: u.table ? undefined : markWords(u.text, unshared, m.s >= WORD_MARK_THRESHOLD) };
    });

  const a = build(ua, ta, tb, matchA);
  const b = build(ub, tb, ta, new Map([...matchB].map(([j, v]) => [j, { j: v.i, s: v.s }])));
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
