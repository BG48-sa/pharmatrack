/**
 * Structured indication parsing.
 *
 * Turns the free-text approved indication into a handful of typed facets a
 * clinician scans in a second: biomarker, line of therapy, disease setting,
 * regimen, population.
 *
 * Design rules (after external reviews found meaning reversals and merged
 * indications):
 *  1. NEGATION is respected. "non-metastatic", "not previously treated",
 *     "without …", "excluding …" never yield the positive facet; where the
 *     negated form is itself informative (non-metastatic) it is shown as such.
 *     An exclusion clause ("excluding patients whose tumours have a PD-L1
 *     TPS ≥ 50%") negates everything it governs, to the end of that clause.
 *  2. NUMERIC OPERATORS are preserved. "PD-L1 TPS <1%" is shown with "<", not
 *     silently turned into "≥1".
 *  3. Alterations are bound to the gene actually named ("HER2 exon 20
 *     insertion" is not an EGFR facet).
 *  4. MULTIPLE INDICATIONS stay separate. Bullets, numbered items and line
 *     breaks split the text — and so do the traces of formatting lost in
 *     extraction: a period or heading glued to the next capitalised word, a
 *     list whose items start in lowercase after a colon or a period. A stem
 *     such as "X as monotherapy is indicated for:" is carried into each of
 *     its items so no item loses its regimen or population.
 *  5. UNCERTAIN passages are flagged, not summarised. When a passage still
 *     looks like several indications (two "indicated" statements, or an
 *     early-stage and a metastatic setting side by side), it is returned with
 *     `uncertain` set and the caller must show the full text instead of
 *     badges.
 * It remains a reading aid: the caller always shows the full text and the
 * reader verifies against the SmPC / label.
 */

export type FacetGroup = 'Biomarker' | 'Line' | 'Setting' | 'Regimen' | 'Population';

export interface Facet {
  group: FacetGroup;
  label: string;
}

/** Facets for one indication passage, with the passage they were derived from. */
export interface IndicationFacetGroup {
  clause: string;
  facets: Facet[];
  /**
   * Set when the passage very likely holds more than one indication whose
   * boundaries could not be recovered. The facets are still returned for
   * diagnostics, but must not be shown as one set of badges.
   */
  uncertain?: string;
}

type Negated = (index: number) => boolean;

// Negating context immediately before a match: "non-metastatic", "not
// previously treated", "no prior …", "without …", "excluding …", "other than …".
const NEGATION_BEFORE = /(?:\bnon[\s-]?|\bnot\s+(?:\w+[\s-]+){0,3}|\bno\s+(?:\w+\s+){0,2}|\bwithout\s+(?:\w+\s+){0,2}|\bexcluding\s+|\bother\s+than\s+|\babsence\s+of\s+|\bnegative\s+for\s+|\bfree\s+(?:of|from)\s+|\bineligible\s+for\s+)$/;

const isNegatedBefore = (t: string, index: number): boolean =>
  NEGATION_BEFORE.test(t.slice(Math.max(0, index - 40), index));

// An exclusion clause negates everything it governs: up to the end of the
// sentence, a semicolon, a closing bracket, or a comma that resumes the main
// statement (", for the treatment of …").
const EXCLUSION_START = /\b(?:excluding|except(?:\s+for|\s+in)?|other\s+than|but\s+not|not\s+including|with\s+the\s+exception\s+of)\b/g;
const EXCLUSION_END = /[.;)]|,\s+(?:for|in|as|when|to|at|after|before|following|and\s+for|or\s+for)\b/;

const exclusionSpans = (t: string): Array<[number, number]> => {
  const spans: Array<[number, number]> = [];
  const g = new RegExp(EXCLUSION_START.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = g.exec(t))) {
    const from = m.index + m[0].length;
    const end = t.slice(from).search(EXCLUSION_END);
    spans.push([m.index, end < 0 ? t.length : from + end]);
  }
  return spans;
};

/** First occurrence of `re` that is not negated; returns its index or -1. */
const findPositive = (t: string, re: RegExp, negated: Negated): number => {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  let m: RegExpExecArray | null;
  while ((m = g.exec(t))) {
    if (!negated(m.index)) return m.index;
    if (m.index === g.lastIndex) g.lastIndex++;
  }
  return -1;
};
/** True when `re` occurs somewhere directly after a negating word ("non-", "without …"). */
const findNegated = (t: string, re: RegExp): boolean => {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  let m: RegExpExecArray | null;
  while ((m = g.exec(t))) {
    if (isNegatedBefore(t, m.index)) return true;
    if (m.index === g.lastIndex) g.lastIndex++;
  }
  return false;
};

// --- Splitting the text into indication passages ------------------------------

// A short line without any statement word is a heading ("Sickle cell disease",
// "Non-small cell lung cancer (NSCLC)") that belongs to the passage after it.
const STATEMENT_WORDS = /\b(indicated|indication|treatment|treat|treating|therapy|therapies|prevention|prevent|preventing|prophylaxis|management|immunisation|immunization|vaccination|diagnosis|diagnostic|imaging|relief|reduction|control|use|used)\b/i;
const looksLikeHeading = (s: string, next?: string): boolean => {
  const words = s.split(/\s+/).length;
  if (words > 8 || !/[A-Za-z]{3}/.test(s) || /[.:;]$/.test(s) || /^see\b/i.test(s) || /\bindicated\b/i.test(s)) return false;
  if (!STATEMENT_WORDS.test(s)) return true;
  // "Adjuvant treatment of melanoma" directly before "X is indicated …" is a heading too.
  return words <= 6 && !!next && /\bindicated\b/i.test(next);
};

// An explanatory sentence between or after the indications ("Prior
// chemotherapy must have included …", "Continued approval may be contingent
// …", "The safety and efficacy in children have not been established"): not an
// indication, so it neither gets the list stem nor yields facets.
const NOTE_PHRASES = /\b(?:not been established|not been studied|not been evaluated|no data|limited data|continued approval|not recommended)\b/i;
const NOTE_START = /^(?:\S+\s+){0,7}(?:must|should|may|cannot)\b|^(?:for (?:study|further|the) results|see |refer to |please |note[:\s]|relative to|compared (?:to|with)|the (?:efficacy|safety)|efficacy|safety|clinical benefit)/i;
// A note that states how the medicine is given ("may be used as monotherapy
// or in combination with MTX") also carries its regimen.
const REGIMEN_NOTE = /\b(?:may|can|should) be (?:used|given|administered|initiated|combined)\b/i;
export const isNote = (s: string): boolean =>
  /^limitations? of use\b/i.test(s) || (/^[A-Z]/.test(s) && !/\bindicated\b/i.test(s) && (NOTE_PHRASES.test(s) || NOTE_START.test(s)));

// Re-attach the fragments that the split produced: headings go in front of the
// passage they introduce, and a list stem ("X as monotherapy is indicated
// for:") is repeated in front of each of its items — a sub-stem ("in
// combination with:") on top of it — so an item never loses the regimen or
// population stated once for the whole list.
export interface Passage { text: string; note: boolean }

const BULLET = /^[•\-–]\s*/;

const joinFragments = (rawPieces: string[]): Passage[] => {
  const out: Passage[] = [];
  let base: string | null = null; // the statement that opens the list
  let sub: string | null = null; // a sub-heading inside the list
  let heading: string | null = null;
  const withHeading = (s: string): string => {
    const r = heading ? `${heading}: ${s}` : s;
    heading = null;
    return r;
  };
  const stem = (): string | null => [base, sub].filter(Boolean).join(' ') || null;
  const pieces = rawPieces
    .map((raw) => ({ text: raw.replace(BULLET, '').trim(), bullet: BULLET.test(raw) }))
    .filter((p) => p.text);
  const notes = pieces.map((p) => isNote(p.text));
  const nextItem = (i: number): { text: string; bullet: boolean } | undefined => {
    for (let j = i + 1; j < pieces.length; j++) if (!notes[j]) return pieces[j];
    return undefined;
  };
  pieces.forEach(({ text: p, bullet }, i) => {
    if (notes[i]) {
      out.push({ text: p, note: true });
      return;
    }
    const next = nextItem(i);
    const lower = /^[a-z]/.test(p);
    const statement = !lower && /\bindicated\b/i.test(p);
    // The next piece is a list item when it starts in lowercase or carries a
    // bullet — unless it is a complete statement of its own ("• X is indicated
    // for …"), which stands alone.
    const nextIsItem = !!next && (/^[a-z]/.test(next.text) || (next.bullet && !/\bindicated\b/i.test(next.text)));
    // A stem ends with a colon, or is a statement / fragment whose next piece
    // is a list item (the colon was lost). An item never is one.
    const isStem = /:$/.test(p) || (!lower && !bullet && nextIsItem && (statement || !/[.;]$/.test(p)));
    if (isStem) {
      if (statement || !base) { base = withHeading(p); sub = null; }
      else sub = p;
      return;
    }
    if (!lower && !bullet && looksLikeHeading(p, next?.text)) {
      heading = heading ? `${heading} · ${p}` : p;
      return;
    }
    const st = stem();
    if (st && (lower || (bullet && !statement) || !statement)) {
      out.push({ text: withHeading(`${st} ${p}`), note: false });
      return;
    }
    if (statement) { base = null; sub = null; } // a complete statement ends the list
    out.push({ text: withHeading(p), note: false });
  });
  if (heading) out.push({ text: heading, note: false });
  return out;
};

// Lost period before a new statement that opens with the product name
// ("… ALK positive mutations Keytruda as monotherapy is indicated for …"): a
// line break unless the word before is a function word of the same sentence.
const FUNCTION_WORDS = new Set(['in', 'for', 'with', 'of', 'and', 'or', 'to', 'as', 'by', 'on', 'at', 'from', 'than', 'receiving', 'including', 'the', 'a', 'an']);
// Lost period before a new statement that opens with the product name.
// Rule 1 — a Title-case name after a lowercase word or a bracket, in any
// construction ("… ALK positive mutations Keytruda as monotherapy is
// indicated …"). Rule 2 — the name as the subject ("… Transplant PROGRAF ® is
// indicated", "… (CSPC) ZYTIGA is a CYP17 inhibitor indicated …", "Psoriatic
// Arthritis Enbrel is indicated"): US labels repeat every indication in their
// highlights, so the name may also follow a capitalised heading word.
const BRAND_AFTER_LOWER = /\b([a-z]+|\))[ \t]+(?=[A-Z][\w-]+[^.\n;:]{0,100}?\b(?:is|are) (?:[\w()/-]+ ){0,6}?indicated\b)/g;
const BRAND_AS_SUBJECT = /\b([A-Za-z]+|\))[ \t]+(?=[A-Z][\w-]{2,}(?: [A-Z][A-Z0-9-]{2,})?(?: [®™])?(?:,| is | are )[^.\n;:]{0,100}?\bindicated\b)/g;
const breakBefore = (m: string, before: string): string => (FUNCTION_WORDS.has(before.toLowerCase()) ? m : `${before}\n`);
const splitBrandStatements = (t: string): string =>
  t.replace(BRAND_AFTER_LOWER, breakBefore).replace(BRAND_AS_SUBJECT, (m, before: string, offset: number, whole: string) => {
    if (FUNCTION_WORDS.has(before.toLowerCase())) return m;
    if (/^[a-z]/.test(before) || before === ')') return `${before}\n`;
    // A capitalised word before the name splits only when it ends a heading
    // of two or more words ("Psoriatic Arthritis Enbrel is indicated"), never
    // a two-word product name ("Palbociclib Viatris is indicated").
    const line = whole.slice(whole.lastIndexOf('\n', offset) + 1, offset + before.length);
    return line.trim().split(/\s+/).length >= 2 ? `${before}\n` : m;
  });

// US label boilerplate that only gets in the way of sentence boundaries: the
// section header, highlight cross-references "( 1.2 , 14.3 )" and
// "[see Clinical Studies (14)]", and numbered sub-headings "1.1 Melanoma".
const stripUsBoilerplate = (t: string): string =>
  t
    .replace(/^\s*(?:1\s+)?INDICATIONS AND USAGE\s*/i, '')
    .replace(/\[see [^\]]*\]/gi, '')
    .replace(/\(\s*\d+(?:\.\d+)?(?:\s*,\s*\d+(?:\.\d+)?)*\s*\)/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s(?=\d\.\d{1,2}\s+[A-Z][a-z])/g, '\n');

// Split a label's indication text into its individual indication passages:
// bullets, numbered items, line breaks, sentence boundaries — and the traces
// of formatting lost in extraction.
export const splitPassages = (text: string): Passage[] => {
  const t = splitBrandStatements(
    stripUsBoilerplate(text)
      .replace(/\r/g, '')
      .replace(/[•●▪◦]/g, '\n• ')
      // Roman-numeral items ("in:i. Neonates … season.ii. Children …").
      .replace(/(?<=^|[.:;]\s*)(?:i{1,3}|iv|vi{0,3})\.\s+(?=[A-Z•])/g, '\n• ')
      // Numbered items ("… resection. 2. Treatment of …") — only after a
      // sentence end, so "CPS ≥ 10. Head and neck …" keeps its number.
      .replace(/(?<=[.:;])\s(?=\(?\d{1,2}[.)]\s+[A-Z])/g, '\n')
      // Lost line break 1: a period glued to the next sentence's capital
      // ("regimens.HER2-low", "immunotherapy.Gastric cancer"). A lowercase
      // letter, digit, ")" , "%" or an acronym (NSCLC) must precede the
      // period, so "U.S." and "2.5" are untouched.
      .replace(/(?<=[a-z0-9)\]%]|[A-Z]{3,})\.(?=[A-Z])/g, '.\n')
      // Lost line break 2: a heading glued to the next Capitalised word
      // ("cancerEnhertu", "(NSCLC)Enhertu"). The word before must be
      // lowercase from its start, so CamelCase names (NovoRapid), "eGFR" and
      // "mRNA" are untouched.
      .replace(/(?<=\b[a-z]{3,}|\))(?=[A-Z][a-z]{2,}\b)/g, '\n')
      // … and a heading glued to an acronym ("Breast cancerHER2-positive …").
      .replace(/(?<=\b[a-z]{3,})(?=[A-Z]{2,}\d?[\s-])/g, '\n')
      // Lost list markers: a sentence never starts in lowercase after a
      // period or a colon unless a bullet was dropped ("… is indicated for:
      // the adjuvant treatment … (see section 5.1). the treatment of …").
      // Abbreviations such as "e.g." and "i.e." are excluded.
      .replace(/(?<!\b(?:e\.g|i\.e|etc|vs|approx|incl|excl|resp|cf|ca|no|min|max|fig|ref))([.:])\s+(?=[a-z])/g, '$1\n')
      // A list item that follows a closing bracket without any marker
      // ("… (see section 5.1) the treatment of metastatic …").
      .replace(/\)\s+(?=the (?:(?:adjuvant|neoadjuvant|first[\s-]?line|second[\s-]?line|maintenance|symptomatic|long-term|short-term) )?(?:treatment|prevention|prophylaxis|management|reduction|relief) of\b)/g, ')\n')
      // Sentence boundaries ("… in adults. Keytruda as monotherapy …").
      .replace(/(?<=[a-z0-9)\]%]|[A-Z]{3,})\s?\.\s+(?=[A-Z•])/g, '.\n'),
  );
  const pieces = t
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return joinFragments(pieces).filter((p) => p.text.length > 12);
};

/** The indication passages as plain text (explanatory notes included). */
export const splitIndicationClauses = (text: string): string[] => splitPassages(text).map((p) => p.text);

// --- Facets of one passage ------------------------------------------------------

// A prior-treatment phrase, not the treatment setting: "completing adjuvant
// chemotherapy", "after adjuvant therapy", "prior adjuvant …".
const HISTORY_BEFORE = /(?:prior|previous|previously|completing|completed|after|following|during|received)\s+(?:[\w,]+[\s-]+){0,3}\(?$/;

const parseClause = (text: string): Facet[] => {
  // "eGFR" is kidney function, not the EGFR gene — keep it from the gene rules.
  const t = text.replace(/\beGFR\b/g, 'kidney-filtration').toLowerCase();
  const spans = exclusionSpans(t);
  const negated: Negated = (i) => isNegatedBefore(t, i) || spans.some(([s, e]) => i > s && i < e);
  const out: Facet[] = [];
  const add = (group: FacetGroup, label: string) => {
    if (!out.some((f) => f.group === group && f.label === label)) out.push({ group, label });
  };
  const has = (re: RegExp) => findPositive(t, re, negated) >= 0;

  // --- Disease setting (negation-aware) ---
  // "metastatic disease who have undergone complete resection" is an adjuvant
  // (resected) setting, not metastatic disease under treatment.
  const metastatic = findPositive(t, /\bmetastatic\b(?![^.]{0,80}?\b(?:complete(?:ly)? resect|undergone (?:complete )?resection|resected)\b)/, negated) >= 0;
  if (metastatic) add('Setting', 'Metastatic');
  else if (!has(/\bmetastatic\b/) && findNegated(t, /\bmetastatic\b/)) add('Setting', 'Non-metastatic');
  if (has(/locally advanced/)) add('Setting', 'Locally advanced');
  else if (has(/\badvanced\b/)) add('Setting', 'Advanced');
  if (has(/\bunresectable\b/)) add('Setting', 'Unresectable');
  else if (has(/\bresectable\b/)) add('Setting', 'Resectable');
  if (has(/\brecurrent\b/)) add('Setting', 'Recurrent');
  // "(neo)adjuvant" is a setting only when it is not part of a treatment history.
  const settingNotHistory = (re: RegExp): boolean => {
    const g = new RegExp(re.source, 'g');
    let m: RegExpExecArray | null;
    while ((m = g.exec(t))) {
      if (!negated(m.index) && !HISTORY_BEFORE.test(t.slice(Math.max(0, m.index - 48), m.index))) return true;
    }
    return false;
  };
  if (settingNotHistory(/\bneoadjuvant\b/)) add('Setting', 'Neoadjuvant');
  if (settingNotHistory(/\badjuvant\b/)) add('Setting', 'Adjuvant');
  if (has(/early[\s-]?stage/)) add('Setting', 'Early-stage');

  // --- Biomarker / molecular selection ---
  // Polarity matters: "HER2-negative" is the OPPOSITE of "HER2-positive".
  const near = (gene: string, word: string) => has(new RegExp(`${gene}[^.]{0,6}${word}`));

  // Alterations are bound to the gene named within the preceding 40 characters.
  const geneBefore = (index: number): string | null => {
    const back = t.slice(Math.max(0, index - 40), index);
    const m = back.match(/\b(egfr|her2|erbb2|met|kras|braf|alk)\b(?![^]*\b(?:egfr|her2|erbb2|met|kras|braf|alk)\b)/);
    if (!m) return null;
    return m[1] === 'erbb2' ? 'HER2' : m[1].toUpperCase();
  };
  const boundAlteration = (re: RegExp, short: string, defaultGene: string | null) => {
    const g = new RegExp(re.source, 'g');
    let m: RegExpExecArray | null;
    while ((m = g.exec(t))) {
      if (negated(m.index)) continue;
      const gene = geneBefore(m.index) || defaultGene;
      add('Biomarker', gene ? `${gene} ${short}` : short);
    }
  };
  boundAlteration(/exon 20 insertion/, 'exon 20 ins', null);
  boundAlteration(/exon 19 deletion/, 'exon 19 del', 'EGFR');
  boundAlteration(/\bt790m\b/, 'T790M', 'EGFR');
  boundAlteration(/\bl858r\b/, 'L858R', 'EGFR');
  boundAlteration(/exon[\s-]?14 skipping/, 'exon 14 skipping', 'MET');
  if (has(/egfr[\s-]?wild[\s-]?type|wild[\s-]?type egfr/)) add('Biomarker', 'EGFR wild-type');
  else if (has(/\begfr\b/) && !out.some((f) => f.group === 'Biomarker' && f.label.startsWith('EGFR'))) add('Biomarker', 'EGFR');

  if (has(/\balk\b/)) add('Biomarker', 'ALK');
  if (has(/\bros1\b/)) add('Biomarker', 'ROS1');

  // HER2 (polarity-aware; a HER2-bound alteration already covers the gene)
  if (has(/(?:her2|erbb2)[^.]{0,20}?\bmutat/)) add('Biomarker', 'HER2 mutation');
  if (has(/her2[\s-]?low/)) add('Biomarker', 'HER2-low');
  else if (near('her2', 'negative') || near('erbb2', 'negative')) add('Biomarker', 'HER2-negative');
  else if (near('her2', 'positive') || near('erbb2', 'positive')) add('Biomarker', 'HER2-positive');
  else if (has(/\bher2\b|erbb2/) && !out.some((f) => f.group === 'Biomarker' && f.label.startsWith('HER2'))) add('Biomarker', 'HER2');

  if (has(/braf[\s-]?v600/)) add('Biomarker', 'BRAF V600');
  else if (has(/\bbraf\b/) && !out.some((f) => f.label.startsWith('BRAF'))) add('Biomarker', 'BRAF');

  if (has(/kras[\s-]?g12c/)) add('Biomarker', 'KRAS G12C');
  else if (has(/(?:kras|nras|\bras\b)[\s-]?wild[\s-]?type|wild[\s-]?type ras/)) add('Biomarker', 'RAS wild-type');
  else if (has(/\bkras\b/) && !out.some((f) => f.label.startsWith('KRAS'))) add('Biomarker', 'KRAS');

  if (has(/\bbrca(?:1|2|1\/2)?\b|gbrca/)) add('Biomarker', 'BRCA');

  // PD-L1 with the threshold AND its operator ("<1%" must never become "≥1").
  // A threshold inside an exclusion ("excluding … TPS ≥ 50%") is not a
  // selection criterion and yields no badge.
  {
    const re = /pd-?l1[^.]{0,40}?\b(cps|tps)\b\s*(?:score\s*)?(?:of\s*)?(≥|>=|≤|<=|<|>|=|greater than or equal to|at least|less than|below|above|more than)?\s*(\d{1,3})\s*%?\s*(or more|or higher|or greater|and above|or less|or lower|and below)?/g;
    let pdl1: RegExpExecArray | null = null;
    let anyThreshold = false;
    let m: RegExpExecArray | null;
    while ((m = re.exec(t))) {
      anyThreshold = true;
      if (!negated(m.index)) { pdl1 = m; break; }
    }
    if (pdl1) {
      const opWord = (pdl1[2] || '').trim();
      const tail = (pdl1[4] || '').trim();
      const op =
        /^(≥|>=|greater than or equal to|at least)$/.test(opWord) || /or more|or higher|or greater|and above/.test(tail) ? '≥'
        : /^(≤|<=)$/.test(opWord) || /or less|or lower|and below/.test(tail) ? '≤'
        : /^(<|less than|below)$/.test(opWord) ? '<'
        : /^(>|above|more than)$/.test(opWord) ? '>'
        : '';
      // CPS is a score (no unit); TPS/IC/TC are percentages — keep the notation the label uses.
      const score = pdl1[1].toUpperCase();
      add('Biomarker', `PD-L1 ${score} ${op}${pdl1[3]}${score === 'CPS' ? '' : '%'}`);
    } else if (!anyThreshold && has(/pd-?l1/)) add('Biomarker', 'PD-L1');
  }

  if (has(/\bmsi-?h\b|microsatellite instability[\s-]?high|mismatch[\s-]repair[\s-]deficien|dmmr/)) add('Biomarker', 'MSI-H / dMMR');
  if (has(/\bntrk\b|neurotrophic[^.]{0,20}fusion/)) add('Biomarker', 'NTRK fusion');
  if (has(/met[\s-]?exon[\s-]?14/) && !out.some((f) => f.label.startsWith('MET'))) add('Biomarker', 'MET exon 14');
  if (has(/\bret\b/)) add('Biomarker', 'RET');
  if (has(/\bflt3\b/)) add('Biomarker', 'FLT3');
  if (has(/\bidh1\b/)) add('Biomarker', 'IDH1');
  if (has(/\bidh2\b/)) add('Biomarker', 'IDH2');
  if (has(/\bfgfr\d?\b/)) add('Biomarker', 'FGFR');
  if (has(/pik3ca/)) add('Biomarker', 'PIK3CA');
  if (has(/\bbcma\b/)) add('Biomarker', 'BCMA');
  if (has(/\bcd19\b/)) add('Biomarker', 'CD19');
  if (has(/\bcd20\b/)) add('Biomarker', 'CD20');
  if (has(/philadelphia|bcr-?abl|\bph\+/)) add('Biomarker', 'Ph+ / BCR-ABL');
  if (has(/triple[\s-]?negative/)) add('Biomarker', 'Triple-negative');
  if (near('hormone receptor', 'negative') || has(/\bhr[\s-]?negative/) || near('estrogen receptor', 'negative') || near('oestrogen receptor', 'negative'))
    add('Biomarker', 'HR-negative');
  else if (near('hormone receptor', 'positive') || has(/\bhr[\s-]?positive/) || near('estrogen receptor', 'positive') || near('oestrogen receptor', 'positive'))
    add('Biomarker', 'HR-positive');
  // HLA restriction (TCR / cell therapies): keep the exact allele wording.
  const hla = t.match(/hla-?[ab]\*?\d{2}[^.]{0,140}?(?:positive|negative|excluded)/) || t.match(/hla-?[ab]\*?\d{2}(?::\d{2}p?)?/);
  if (hla) add('Biomarker', hla[0].toUpperCase().replace(/\s+/g, ' ').slice(0, 90));

  // --- Line of therapy ---
  if (has(/for (?:the )?first[\s-]?line|first[\s-]?line (?:treatment|therapy) of|as (?:a )?first[\s-]?line|in the first[\s-]?line setting|previously untreated|treatment[\s-]?na[iï]ve|newly diagnosed|(?:have|has) not (?:previously )?received/))
    add('Line', 'First-line / untreated');
  if (has(/for (?:the )?second[\s-]?line/)) add('Line', 'Second-line');
  if (has(/relapsed|refractory/)) add('Line', 'Relapsed/refractory');
  if (has(/\bmaintenance\b/)) add('Line', 'Maintenance');
  if (has(/disease progression|progressed on or after|previously treated with|(?:who have|after) received (?:at least )?(?:one|two|three|\d+)|after (?:at least )?(?:one|two|three|\d+) (?:prior|previous)|received (?:a |an )?prior|previously received|\bprior (?:systemic )?(?:therapy|therapies|treatment|chemotherapy|lines? of)\b|following (?:\w+[\s-]+){0,3}(?:chemotherapy|immunotherapy)\b/))
    add('Line', 'Previously treated');

  // --- Regimen ---
  if (has(/in combination with/)) add('Regimen', 'Combination');
  if (has(/as (?:a )?(?:monotherapy|single[\s-]?agent)|single agent|\bmonotherapy\b/)) add('Regimen', 'Monotherapy');

  // --- Population ---
  if (has(/\badults?\b/)) add('Population', 'Adults');
  if (has(/paediatric|pediatric|children|adolescent|infant|neonate|young adult|(?:\d+|one|two|three|four|five|six|twelve|18|25) (?:months|years) (?:of age )?(?:and|or) (?:older|above|over)|up to (?:and including )?\d+ years|\b\d+ (?:to|-|–) (?:<\s?)?\d+ (?:months|years)|\baged? \d+|from (?:the age of )?\d+ (?:months|years|weeks)|≥\s?\d+ (?:months|years)/)) add('Population', 'Paediatric / age-limited');

  return out;
};

// --- Uncertainty gate -------------------------------------------------------------

const EARLY_SETTINGS = ['Adjuvant', 'Neoadjuvant', 'Early-stage', 'Non-metastatic', 'Resectable'];

// Indication statements ("X is indicated for", "an antibody indicated for") —
// not "as indicated by elevated CRP" or "chemotherapy is not yet clinically
// indicated", which are conditions inside one indication.
const STATEMENT_RE = /\b(?:is|are)(?: also| only)? indicated\b|\bindicated (?:for|in|as|to)\b/gi;
const countStatements = (s: string): number => {
  const g = new RegExp(STATEMENT_RE.source, 'gi');
  let n = 0;
  let m: RegExpExecArray | null;
  while ((m = g.exec(s))) {
    if (!/\bnot(?: yet)?(?: clinically)?\s*$/i.test(s.slice(Math.max(0, m.index - 25), m.index))) n++;
  }
  return n;
};

/** Why a passage must not be summarised as one set of badges, or undefined. */
const uncertainReason = (clause: string, facets: Facet[]): string | undefined => {
  const statements = countStatements(clause);
  if (statements >= 2) return `it contains ${statements} "indicated" statements`;
  const settings = new Set(facets.filter((f) => f.group === 'Setting').map((f) => f.label));
  if (settings.has('Metastatic') && EARLY_SETTINGS.some((s) => settings.has(s)))
    return 'it names both an early-stage and a metastatic setting';
  return undefined;
};

/**
 * Parse an indication text passage by passage. Returns one group per passage
 * that yields facets, keeping population, setting, biomarker and regimen
 * together. A group with `uncertain` set must be shown as text, not badges.
 */
export const parseIndicationGroups = (text?: string): IndicationFacetGroup[] => {
  if (!text || !text.trim()) return [];
  const groups: IndicationFacetGroup[] = [];
  for (const { text: clause, note } of splitPassages(text)) {
    // An explanatory note ("screening for HLA-B*57:01 should be performed",
    // "may be used as monotherapy or in combination with MTX") can carry a
    // biomarker requirement or a regimen, but no setting, line or population.
    const facets = note
      ? parseClause(clause).filter((f) => f.group === 'Biomarker' || (f.group === 'Regimen' && REGIMEN_NOTE.test(clause)))
      : parseClause(clause);
    if (!facets.length) continue;
    const uncertain = uncertainReason(clause, facets);
    groups.push(uncertain ? { clause, facets, uncertain } : { clause, facets });
  }
  return groups;
};

/** Flat facets — only safe when the text is a single, certain indication passage. */
export const parseIndication = (text?: string): Facet[] => {
  const groups = parseIndicationGroups(text);
  return groups.length === 1 && !groups[0].uncertain ? groups[0].facets : [];
};
