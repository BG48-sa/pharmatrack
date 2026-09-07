/**
 * Structured indication parsing.
 *
 * Turns the free-text approved indication into a handful of typed facets a
 * clinician scans in a second: biomarker, line of therapy, disease setting,
 * regimen, population.
 *
 * Design rules (after an external review found meaning reversals):
 *  1. NEGATION is respected. "non-metastatic", "not previously treated",
 *     "without …", "excluding …" never yield the positive facet; where the
 *     negated form is itself informative (non-metastatic) it is shown as such.
 *  2. NUMERIC OPERATORS are preserved. "PD-L1 TPS <1%" is shown with "<", not
 *     silently turned into "≥1".
 *  3. Alterations are bound to the gene actually named ("HER2 exon 20
 *     insertion" is not an EGFR facet).
 *  4. MULTIPLE INDICATIONS stay separate. A label with three bullet
 *     indications yields three facet groups, each with the clause it came
 *     from, so adult/metastatic/monotherapy and paediatric/early-stage/
 *     combination are never merged into one set of badges.
 * It remains a reading aid: the caller always shows the full text and the
 * reader verifies against the SmPC / label.
 */

export type FacetGroup = 'Biomarker' | 'Line' | 'Setting' | 'Regimen' | 'Population';

export interface Facet {
  group: FacetGroup;
  label: string;
}

/** Facets for one indication clause, with the clause they were derived from. */
export interface IndicationFacetGroup {
  clause: string;
  facets: Facet[];
}

// Negating context immediately before a match: "non-metastatic", "not
// previously treated", "no prior …", "without …", "excluding …", "other than …".
const NEGATION_BEFORE = /(?:\bnon[\s-]?|\bnot\s+(?:\w+[\s-]+){0,3}|\bno\s+(?:\w+\s+){0,2}|\bwithout\s+(?:\w+\s+){0,2}|\bexcluding\s+|\bother\s+than\s+|\babsence\s+of\s+|\bnegative\s+for\s+|\bfree\s+(?:of|from)\s+|\bineligible\s+for\s+)$/;

const isNegated = (t: string, index: number): boolean =>
  NEGATION_BEFORE.test(t.slice(Math.max(0, index - 40), index));

/** First occurrence of `re` that is not negated; returns its index or -1. */
const findPositive = (t: string, re: RegExp): number => {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  let m: RegExpExecArray | null;
  while ((m = g.exec(t))) {
    if (!isNegated(t, m.index)) return m.index;
    if (m.index === g.lastIndex) g.lastIndex++;
  }
  return -1;
};
/** True when `re` occurs somewhere in a negated context. */
const findNegated = (t: string, re: RegExp): boolean => {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  let m: RegExpExecArray | null;
  while ((m = g.exec(t))) {
    if (isNegated(t, m.index)) return true;
    if (m.index === g.lastIndex) g.lastIndex++;
  }
  return false;
};

// Split a label's indication text into its individual indication clauses:
// bullets, numbered items, line breaks, and sentence boundaries.
export const splitIndicationClauses = (text: string): string[] => {
  const t = text
    .replace(/\r/g, '')
    .replace(/[•●▪◦]/g, '\n• ')
    .replace(/\s(?=\(?\d{1,2}[.)]\s+[A-Z])/g, '\n');
  return t
    .split(/\n+|(?<=[a-z0-9)%])\.\s+(?=[A-Z•])/)
    .map((s) => s.replace(/^[•\-–\s]+/, '').trim())
    .filter((s) => s.length > 12);
};

const parseClause = (text: string): Facet[] => {
  const t = text.toLowerCase();
  const out: Facet[] = [];
  const add = (group: FacetGroup, label: string) => {
    if (!out.some((f) => f.group === group && f.label === label)) out.push({ group, label });
  };
  const has = (re: RegExp) => findPositive(t, re) >= 0;

  // --- Disease setting (negation-aware) ---
  if (has(/\bmetastatic\b/)) add('Setting', 'Metastatic');
  else if (findNegated(t, /\bmetastatic\b/)) add('Setting', 'Non-metastatic');
  if (has(/locally advanced/)) add('Setting', 'Locally advanced');
  else if (has(/\badvanced\b/)) add('Setting', 'Advanced');
  if (has(/\bunresectable\b/)) add('Setting', 'Unresectable');
  else if (has(/\bresectable\b/)) add('Setting', 'Resectable');
  if (has(/\brecurrent\b/)) add('Setting', 'Recurrent');
  if (has(/neoadjuvant/)) add('Setting', 'Neoadjuvant');
  else if (has(/\badjuvant\b/)) add('Setting', 'Adjuvant');
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
      if (isNegated(t, m.index)) continue;
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
  const pdl1 = t.match(/pd-?l1[^.]{0,40}?\b(cps|tps)\b\s*(?:score\s*)?(?:of\s*)?(≥|>=|≤|<=|<|>|=|greater than or equal to|at least|less than|below|above|more than)?\s*(\d{1,3})\s*%?\s*(or more|or higher|or greater|and above|or less|or lower|and below)?/);
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
  } else if (has(/pd-?l1/)) add('Biomarker', 'PD-L1');

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
  if (has(/for (?:the )?first[\s-]?line|previously untreated|treatment[\s-]?na[iï]ve|newly diagnosed|(?:have|has) not (?:previously )?received/))
    add('Line', 'First-line / untreated');
  if (has(/for (?:the )?second[\s-]?line/)) add('Line', 'Second-line');
  if (has(/relapsed|refractory/)) add('Line', 'Relapsed/refractory');
  if (has(/\bmaintenance\b/)) add('Line', 'Maintenance');
  if (has(/disease progression|progressed on or after|previously treated with|(?:who have|after) received (?:at least )?(?:one|two|three|\d+)|after (?:at least )?(?:one|two|three|\d+) (?:prior|previous)/))
    add('Line', 'Previously treated');

  // --- Regimen ---
  if (has(/in combination with/)) add('Regimen', 'Combination');
  if (has(/as (?:a )?(?:monotherapy|single[\s-]?agent)|single agent|\bmonotherapy\b/)) add('Regimen', 'Monotherapy');

  // --- Population ---
  if (has(/\badults?\b/)) add('Population', 'Adults');
  if (has(/paediatric|pediatric|children|adolescent|infant|young adult|(?:\d+|one|two|three|four|five|six|twelve|18|25) (?:months|years) (?:of age )?(?:and|or) older|up to (?:and including )?\d+ years/)) add('Population', 'Paediatric / age-limited');

  return out;
};

/**
 * Parse an indication text clause by clause. Returns one group per clause that
 * yields facets, keeping population, setting, biomarker and regimen together.
 */
export const parseIndicationGroups = (text?: string): IndicationFacetGroup[] => {
  if (!text || !text.trim()) return [];
  const groups: IndicationFacetGroup[] = [];
  for (const clause of splitIndicationClauses(text)) {
    const facets = parseClause(clause);
    if (facets.length) groups.push({ clause, facets });
  }
  return groups;
};

/** Flat facets — only safe when the text is a single indication clause. */
export const parseIndication = (text?: string): Facet[] => {
  const groups = parseIndicationGroups(text);
  return groups.length === 1 ? groups[0].facets : [];
};
