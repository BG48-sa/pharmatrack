/**
 * Native glossary of the regulatory terms DrugRadar surfaces as badges and
 * status labels. Written for a clinician audience: what the designation is, and
 * — more usefully — what it changes about how you should read the entry.
 *
 * Entries are keyed by a stable id. EmaFlags keys (atmp, orphan, prime, cond,
 * exc, acc, bio, gen) are reused verbatim so a badge can open its own entry.
 */
export interface GlossaryEntry {
  id: string;
  term: string;
  abbr?: string;
  body: string;
  /** Why it matters when reading a specific drug entry. */
  soWhat?: string;
  /** Authoritative page to read more. */
  sourceLabel?: string;
  sourceUrl?: string;
}

export const GLOSSARY: GlossaryEntry[] = [
  {
    id: 'chmp',
    term: 'CHMP positive opinion',
    abbr: 'CHMP',
    body:
      'The Committee for Medicinal Products for Human Use is the EMA scientific committee that assesses centrally-authorised medicines. A positive opinion is its recommendation to approve — the last scientific step before the legally-binding European Commission decision.',
    soWhat:
      'A positive opinion is not yet a marketing authorisation. The EC normally issues the binding decision about 67 days later — that estimate drives the “Expected” list and decision reminders.',
    sourceLabel: 'EMA — CHMP',
    sourceUrl: 'https://www.ema.europa.eu/en/committees/committee-medicinal-products-human-use-chmp',
  },
  {
    id: 'ec-decision',
    term: 'European Commission decision',
    abbr: 'EC decision',
    body:
      'The legally-binding act that grants an EU-wide marketing authorisation, adopted by the European Commission after a CHMP positive opinion. Only after this decision may the medicine be marketed in the EU.',
    soWhat:
      'DrugRadar estimates this date as the CHMP opinion date + ~67 days. It is an estimate, not an official calendar entry — verify against the EMA medicine page.',
    sourceLabel: 'EMA — authorisation of medicines',
    sourceUrl: 'https://www.ema.europa.eu/en/about-us/what-we-do/authorisation-medicines',
  },
  {
    id: 'atmp',
    term: 'Advanced therapy medicinal product',
    abbr: 'ATMP',
    body:
      'Medicines based on genes, tissues or cells: gene therapies, somatic-cell therapies and tissue-engineered products. In the EU they are assessed with input from the Committee for Advanced Therapies (CAT).',
    soWhat:
      'ATMPs (including CAR-T and gene therapies) carry distinct manufacturing, administration and long-term follow-up requirements — the label is a flag that this is not a conventional small-molecule or antibody.',
    sourceLabel: 'EMA — advanced therapies',
    sourceUrl: 'https://www.ema.europa.eu/en/human-regulatory-overview/advanced-therapy-medicinal-products-overview',
  },
  {
    id: 'orphan',
    term: 'Orphan designation',
    abbr: 'Orphan',
    body:
      'A status for medicines intended to treat a rare, life-threatening or chronically debilitating condition (in the EU, affecting no more than 5 in 10,000 people). It brings incentives such as protocol assistance and a period of market exclusivity.',
    soWhat:
      'Orphan status signals a small target population and often a pivotal trial that is smaller or single-arm — weigh the evidence base accordingly.',
    sourceLabel: 'EMA — orphan medicines',
    sourceUrl: 'https://www.ema.europa.eu/en/human-regulatory-overview/orphan-designation-overview',
  },
  {
    id: 'prime',
    term: 'PRIority MEdicines',
    abbr: 'PRIME',
    body:
      'An EMA scheme offering enhanced, early scientific and regulatory support to medicines that may address an unmet medical need, to speed patient access without lowering evidentiary standards.',
    soWhat:
      'PRIME marks a medicine the EMA prioritised for development support — a signal of perceived unmet need, not of superior efficacy.',
    sourceLabel: 'EMA — PRIME',
    sourceUrl: 'https://www.ema.europa.eu/en/human-regulatory-overview/research-development/prime-priority-medicines',
  },
  {
    id: 'cond',
    term: 'Conditional marketing authorisation',
    abbr: 'Conditional',
    body:
      'An EU authorisation granted on less comprehensive data than normally required, when the benefit of immediate availability outweighs the risk of incomplete data. The holder must supply further confirmatory evidence post-authorisation.',
    soWhat:
      'Approval rests on preliminary (often surrogate-endpoint or single-arm) data with obligations still open — confirmatory trials may later confirm or withdraw the benefit.',
    sourceLabel: 'EMA — conditional MA',
    sourceUrl: 'https://www.ema.europa.eu/en/human-regulatory-overview/marketing-authorisation/conditional-marketing-authorisation',
  },
  {
    id: 'exc',
    term: 'Authorisation under exceptional circumstances',
    abbr: 'Except. circ.',
    body:
      'Used when comprehensive data cannot be obtained even after authorisation — e.g. the condition is so rare that a full dataset is impossible. Reviewed annually; unlike a conditional MA it is not expected to become a standard authorisation.',
    soWhat:
      'The evidence base is inherently limited by design and will stay that way — it is not a stepping-stone to a fuller dataset.',
    sourceLabel: 'EMA — exceptional circumstances',
    sourceUrl: 'https://www.ema.europa.eu/en/glossary-terms/authorisation-under-exceptional-circumstances',
  },
  {
    id: 'acc',
    term: 'Accelerated assessment',
    abbr: 'Accelerated',
    body:
      'Shortens the EMA review timetable (from 210 to as few as 150 active days) for medicines of major public-health interest, particularly therapeutic innovation.',
    soWhat:
      'The review was expedited; the evidentiary bar is unchanged. It affects timing, not the strength of the approval.',
    sourceLabel: 'EMA — accelerated assessment',
    sourceUrl: 'https://www.ema.europa.eu/en/glossary-terms/accelerated-assessment',
  },
  {
    id: 'bio',
    term: 'Biosimilar',
    abbr: 'Biosimilar',
    body:
      'A biological medicine highly similar to an already-authorised biological (the reference product), with no clinically meaningful differences in safety, purity or potency.',
    soWhat:
      'A biosimilar is not a generic: it is a comparable, not identical, biologic. Interchangeability and substitution rules are decided nationally.',
    sourceLabel: 'EMA — biosimilars',
    sourceUrl: 'https://www.ema.europa.eu/en/human-regulatory-overview/biosimilar-medicines-overview',
  },
  {
    id: 'gen',
    term: 'Generic medicine',
    abbr: 'Generic',
    body:
      'A medicine with the same active substance(s), strength and pharmaceutical form as an already-authorised reference medicine, shown to be bioequivalent to it.',
    soWhat:
      'Generics enter after the reference product’s protection expires and are relied upon as therapeutically equivalent to the original.',
    sourceLabel: 'EMA — generic medicines',
    sourceUrl: 'https://www.ema.europa.eu/en/human-regulatory-overview/generic-and-hybrid-medicines',
  },
  {
    id: 'pdufa',
    term: 'PDUFA date',
    abbr: 'PDUFA',
    body:
      'Under the Prescription Drug User Fee Act, the target date by which the U.S. FDA aims to complete its review of a marketing application. It is a goal date for an FDA decision, not a guaranteed approval date.',
    soWhat:
      'A PDUFA date tells you when an FDA action (approval, complete-response letter, or delay) is expected — the drug is not yet approved on that date.',
    sourceLabel: 'FDA — PDUFA',
    sourceUrl: 'https://www.fda.gov/industry/fda-user-fee-programs/prescription-drug-user-fee-amendments',
  },
  {
    id: '351k',
    term: '351(k) biosimilar application',
    abbr: '351(k)',
    body:
      'The U.S. FDA licensure pathway (section 351(k) of the Public Health Service Act) for biosimilar and interchangeable biological products, which relies on comparison to a licensed reference biologic.',
    soWhat:
      'Marks a U.S. biosimilar. An “interchangeable” designation is a further FDA determination that can permit pharmacy-level substitution.',
    sourceLabel: 'FDA — biosimilars',
    sourceUrl: 'https://www.fda.gov/drugs/therapeutic-biologics-applications-bla/biosimilars',
  },
  {
    id: 'novel',
    term: 'Novel drug (CDER)',
    abbr: 'Novel',
    body:
      'The FDA Center for Drug Evaluation and Research’s annual list of “novel” new drugs — new molecular entities and new therapeutic biologics never before marketed in the U.S. It is the headline roster of genuinely new medicines each year.',
    soWhat:
      'A “Novel YYYY” badge means the drug was first-of-its-kind in the U.S. that year, not merely a new formulation or indication of an existing drug.',
    sourceLabel: 'FDA — Novel Drug Approvals',
    sourceUrl: 'https://www.fda.gov/drugs/new-drugs-fda-cders-new-molecular-entities-and-new-therapeutic-biological-products',
  },
];

const BY_ID = new Map(GLOSSARY.map((e) => [e.id, e]));
export const glossaryEntry = (id: string): GlossaryEntry | undefined => BY_ID.get(id);
