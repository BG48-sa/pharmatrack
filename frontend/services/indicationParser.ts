/**
 * Structured indication parsing.
 *
 * Turns the free-text approved indication ("...metastatic NSCLC with EGFR exon
 * 20 insertion after platinum-based chemotherapy...") into a handful of typed
 * facets a clinician scans in a second: biomarker, line of therapy, disease
 * setting, regimen, population.
 *
 * This is deliberately CONSERVATIVE and pattern-based — it only asserts a facet
 * when the wording is unambiguous, and the caller always shows the full source
 * text alongside so the reader can verify. It is a reading aid, not a substitute
 * for the SmPC / FDA label.
 */

export type FacetGroup = 'Biomarker' | 'Line' | 'Setting' | 'Regimen' | 'Population';

export interface Facet {
  group: FacetGroup;
  label: string;
}

export const parseIndication = (text?: string): Facet[] => {
  if (!text || !text.trim()) return [];
  const t = text.toLowerCase();
  const out: Facet[] = [];
  const add = (group: FacetGroup, label: string) => {
    if (!out.some((f) => f.group === group && f.label === label)) out.push({ group, label });
  };

  // --- Disease setting ---
  if (/\bmetastatic\b/.test(t)) add('Setting', 'Metastatic');
  if (/locally advanced/.test(t)) add('Setting', 'Locally advanced');
  else if (/\badvanced\b/.test(t)) add('Setting', 'Advanced');
  if (/\bunresectable\b/.test(t)) add('Setting', 'Unresectable');
  if (/\brecurrent\b/.test(t)) add('Setting', 'Recurrent');
  if (/neoadjuvant/.test(t)) add('Setting', 'Neoadjuvant');
  else if (/\badjuvant\b/.test(t)) add('Setting', 'Adjuvant');
  if (/early[\s-]?stage/.test(t)) add('Setting', 'Early-stage');

  // --- Biomarker / molecular selection (highest value, shown first) ---
  // Polarity matters: "HER2-negative" is a real selection criterion and the
  // OPPOSITE of "HER2-positive", so a bare gene match would be dangerously wrong.
  // `near(gene, 'positive'|'negative')` tolerates the abbreviation/paren/hyphen
  // labels insert, e.g. "hormone receptor (HR)‑positive" or "(HER2)‑negative",
  // while the period-stop and 6-char cap keep the match local.
  const near = (gene: string, word: string) =>
    new RegExp(`${gene}[^.]{0,6}${word}`).test(t);

  // EGFR
  if (/exon 20 insertion/.test(t)) add('Biomarker', 'EGFR exon 20 ins');
  if (/exon 19 deletion/.test(t)) add('Biomarker', 'EGFR exon 19 del');
  if (/\bt790m\b/.test(t)) add('Biomarker', 'EGFR T790M');
  if (/\bl858r\b/.test(t)) add('Biomarker', 'EGFR L858R');
  if (/egfr[\s-]?wild[\s-]?type|wild[\s-]?type egfr/.test(t)) add('Biomarker', 'EGFR wild-type');
  // Bare "EGFR" only if no specific EGFR alteration was already captured.
  else if (/\begfr\b/.test(t) && !out.some((f) => f.group === 'Biomarker' && f.label.startsWith('EGFR')))
    add('Biomarker', 'EGFR');

  if (/\balk\b/.test(t)) add('Biomarker', 'ALK');
  if (/\bros1\b/.test(t)) add('Biomarker', 'ROS1');

  // HER2 (polarity-aware)
  if (/her2[\s-]?low/.test(t)) add('Biomarker', 'HER2-low');
  else if (near('her2', 'negative') || near('erbb2', 'negative')) add('Biomarker', 'HER2-negative');
  else if (near('her2', 'positive') || near('erbb2', 'positive')) add('Biomarker', 'HER2-positive');
  else if (/\bher2\b|erbb2/.test(t)) add('Biomarker', 'HER2');

  if (/braf[\s-]?v600/.test(t)) add('Biomarker', 'BRAF V600');
  else if (/\bbraf\b/.test(t)) add('Biomarker', 'BRAF');

  if (/kras[\s-]?g12c/.test(t)) add('Biomarker', 'KRAS G12C');
  else if (/(?:kras|nras|\bras\b)[\s-]?wild[\s-]?type|wild[\s-]?type ras/.test(t))
    add('Biomarker', 'RAS wild-type');
  else if (/\bkras\b/.test(t)) add('Biomarker', 'KRAS');

  if (/\bbrca(?:1|2|1\/2)?\b|gbrca/.test(t)) add('Biomarker', 'BRCA');

  // PD-L1 — capture the CPS/TPS threshold when the label states one.
  const pdl1 = t.match(/pd-?l1[^.]{0,40}?(cps|tps)[^%\d]{0,12}(\d{1,3})\s*%?/);
  if (pdl1) add('Biomarker', `PD-L1 ${pdl1[1].toUpperCase()} ≥${pdl1[2]}`);
  else if (/pd-?l1/.test(t)) add('Biomarker', 'PD-L1');

  if (/\bmsi-?h\b|microsatellite instability[\s-]?high|mismatch[\s-]repair[\s-]deficien|dmmr/.test(t))
    add('Biomarker', 'MSI-H / dMMR');
  if (/\bntrk\b|neurotrophic[^.]{0,20}fusion/.test(t)) add('Biomarker', 'NTRK fusion');
  if (/met[\s-]?exon[\s-]?14/.test(t)) add('Biomarker', 'MET exon 14');
  if (/\bret\b/.test(t)) add('Biomarker', 'RET');
  if (/\bflt3\b/.test(t)) add('Biomarker', 'FLT3');
  if (/\bidh1\b/.test(t)) add('Biomarker', 'IDH1');
  if (/\bidh2\b/.test(t)) add('Biomarker', 'IDH2');
  if (/\bfgfr\d?\b/.test(t)) add('Biomarker', 'FGFR');
  if (/pik3ca/.test(t)) add('Biomarker', 'PIK3CA');
  if (/\bbcma\b/.test(t)) add('Biomarker', 'BCMA');
  if (/\bcd19\b/.test(t)) add('Biomarker', 'CD19');
  if (/\bcd20\b/.test(t)) add('Biomarker', 'CD20');
  if (/philadelphia|bcr-?abl|\bph\+/.test(t)) add('Biomarker', 'Ph+ / BCR-ABL');
  if (/triple[\s-]?negative/.test(t)) add('Biomarker', 'Triple-negative');
  // HR / hormone-receptor polarity
  if (near('hormone receptor', 'negative') || /hr[\s-]?negative/.test(t) || near('estrogen receptor', 'negative') || near('oestrogen receptor', 'negative'))
    add('Biomarker', 'HR-negative');
  else if (near('hormone receptor', 'positive') || /hr[\s-]?positive/.test(t) || near('estrogen receptor', 'positive') || near('oestrogen receptor', 'positive'))
    add('Biomarker', 'HR-positive');

  // --- Line of therapy ---
  // Only assert from UNAMBIGUOUS phrasing. Deliberately NOT triggered by a bare
  // "first-line", because labels often say "after first-line treatment" (which
  // actually means the drug is used LATER). A negative lookbehind also guards
  // "not previously treated".
  if (/for (?:the )?first[\s-]?line|previously untreated|treatment[\s-]?na[iï]ve|newly diagnosed/.test(t))
    add('Line', 'First-line');
  if (/for (?:the )?second[\s-]?line/.test(t)) add('Line', 'Second-line');
  if (/relapsed|refractory/.test(t)) add('Line', 'Relapsed/refractory');
  if (/\bmaintenance\b/.test(t)) add('Line', 'Maintenance');
  if (/disease progression|progressed on or after|(?<!not )previously treated with|who have received (?:at least )?(?:one|two|three|\d+)/.test(t))
    add('Line', 'Previously treated');

  // --- Regimen ---
  if (/in combination with/.test(t)) add('Regimen', 'Combination');
  if (/as (?:a )?(?:monotherapy|single[\s-]?agent)|single agent/.test(t)) add('Regimen', 'Monotherapy');

  // --- Population ---
  if (/\badults?\b/.test(t)) add('Population', 'Adults');
  if (/paediatric|pediatric|children|adolescent|infant/.test(t)) add('Population', 'Paediatric');

  return out;
};
