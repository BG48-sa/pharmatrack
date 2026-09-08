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
    term: 'CHMP opinion',
    abbr: 'CHMP',
    body:
      'The Committee for Medicinal Products for Human Use is the EMA scientific committee that assesses centrally-authorised medicines. Its opinion is a scientific recommendation — the last step before the legally-binding European Commission decision.',
    soWhat:
      'An opinion is not yet a marketing authorisation, and the final outcome is not decided until the EC acts. The EC normally issues the binding decision about 67 days later — that estimate drives the “Expected” list and decision reminders.',
    sourceLabel: 'EMA — CHMP',
    sourceUrl: 'https://www.ema.europa.eu/en/committees/committee-medicinal-products-human-use-chmp',
  },
  {
    id: 'ec-decision',
    term: 'European Commission decision',
    abbr: 'EC decision',
    body:
      'The legally-binding act that grants an EU-wide marketing authorisation, adopted by the European Commission after a CHMP opinion. Only after this decision may the medicine be marketed in the EU.',
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
      'Medicines based on genes, tissues or cells: gene therapies, somatic-cell therapies and tissue-engineered products. In the EU the Committee for Advanced Therapies (CAT) assesses them and prepares the draft opinion, which the CHMP adopts as its final opinion.',
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
      'An EU authorisation granted on less comprehensive data than normally required, when the benefit of immediate availability outweighs the risk of incomplete data. The holder must supply further confirmatory evidence post-authorisation. DrugRadar shows the flag as recorded at the time of grant in EMA\'s data; conversion to a full (standard) authorisation is noted in the detail sheet only where it has been verified.',
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
    id: 'cdx',
    term: 'Companion diagnostic',
    abbr: 'CDx',
    body:
      'An in-vitro diagnostic (or imaging tool) whose result is essential for the safe and effective use of a specific medicine — typically whether the patient carries the biomarker the drug targets. In the US the FDA authorises named devices for specific drug and indication pairs (PMA, 510(k), De Novo or HDE) and publishes the list DrugRadar bundles. In the EU the IVD Regulation (2017/746) classes companion diagnostics as class C devices whose conformity assessment includes consultation of the medicines authority, and the SmPC asks for a validated test rather than one named kit.',
    soWhat:
      'The two frameworks answer different questions: the FDA list tells you which device was studied with which drug; the SmPC tells you a validated test is required and leaves the choice of CE-marked assay to the laboratory. On a biomarker card the EU test method and the FDA-authorised devices are shown side by side for that reason.',
    sourceLabel: 'FDA — List of FDA-authorized companion diagnostic devices',
    sourceUrl: 'https://www.fda.gov/medical-devices/in-vitro-diagnostics/list-fda-authorized-companion-diagnostic-devices-in-vitro-and-imaging-tools',
  },
  {
    id: 'dev',
    term: 'Drug–device combination',
    abbr: 'Drug+Device',
    body:
      'A medicine supplied with an integral device that administers or delivers it — an ocular or subcutaneous implant, an inhaler, a pre-filled pen or similar. In the EU the combination is authorised as a medicinal product, while the device component must meet the relevant device requirements (MDR Article 117).',
    soWhat:
      'The device is part of the product: handling, training and switching considerations differ from a plain vial or tablet, and device performance is part of the benefit–risk assessment.',
    sourceLabel: 'EMA — medical devices overview',
    sourceUrl: 'https://www.ema.europa.eu/en/human-regulatory-overview/medical-devices',
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
