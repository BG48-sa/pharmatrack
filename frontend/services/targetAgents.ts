/**
 * Molecular targets → the agents that act on them.
 *
 * WHY THIS EXISTS
 *   A disease class in disease-entities.json carries the targets that matter in
 *   that disease (RCC: VEGFR, mTOR, PD-1 …), so a target query surfaces the
 *   whole class. But the class also holds drugs that act on OTHER targets — a
 *   "PD-L1" search must not present six VEGFR inhibitors as PD-L1 drugs. This
 *   table says, per target, which agents actually act on it, so the UI can
 *   highlight those and drop classes that contain none.
 *
 *   Agents are named by INN (a drug matches when any word of its INN is listed,
 *   so "trastuzumab deruxtecan" and "niraparib / abiraterone" resolve). Targets
 *   not listed here fall back to the class-level match with a caveat.
 */

export interface TargetClass {
  /** Display label, e.g. "PD-1/PD-L1". */
  label: string;
  /** Query spellings that name this target (matched after stripping punctuation). */
  aliases: string[];
  /** INN words of the agents acting on the target. */
  agents: string[];
}

const PD1_PDL1 = ['pembrolizumab', 'nivolumab', 'atezolizumab', 'durvalumab', 'avelumab', 'cemiplimab', 'dostarlimab', 'retifanlimab', 'tislelizumab', 'toripalimab'];
const CTLA4 = ['ipilimumab', 'tremelimumab'];
const CD3_BISPECIFIC = ['teclistamab', 'elranatamab', 'talquetamab', 'linvoseltamab', 'glofitamab', 'epcoritamab', 'mosunetuzumab', 'odronextamab', 'blinatumomab', 'tarlatamab', 'tebentafusp'];
const VEGF = ['bevacizumab', 'ramucirumab', 'aflibercept', 'ranibizumab', 'brolucizumab', 'faricimab', 'sunitinib', 'sorafenib', 'pazopanib', 'axitinib', 'cabozantinib', 'lenvatinib', 'tivozanib', 'regorafenib', 'vandetanib', 'nintedanib', 'fruquintinib'];
const COMPLEMENT_C5 = ['eculizumab', 'ravulizumab', 'crovalimab', 'zilucoplan'];

export const TARGET_CLASSES: TargetClass[] = [
  { label: 'PD-1/PD-L1', aliases: ['pd1', 'pdl1', 'pd-1', 'pd-l1', 'programmed death'], agents: PD1_PDL1 },
  { label: 'CTLA-4', aliases: ['ctla4', 'ctla-4'], agents: CTLA4 },
  { label: 'immune checkpoint', aliases: ['checkpoint', 'immune checkpoint'], agents: [...PD1_PDL1, ...CTLA4] },
  { label: 'HER2', aliases: ['her2', 'erbb2', 'neu', 'her2neu'], agents: ['trastuzumab', 'pertuzumab', 'lapatinib', 'neratinib', 'tucatinib', 'margetuximab', 'zanidatamab'] },
  { label: 'EGFR', aliases: ['egfr'], agents: ['erlotinib', 'gefitinib', 'afatinib', 'dacomitinib', 'osimertinib', 'aumolertinib', 'lazertinib', 'mobocertinib', 'cetuximab', 'panitumumab', 'necitumumab', 'amivantamab'] },
  { label: 'ALK', aliases: ['alk'], agents: ['crizotinib', 'ceritinib', 'alectinib', 'brigatinib', 'lorlatinib'] },
  { label: 'ROS1', aliases: ['ros1', 'ros'], agents: ['crizotinib', 'entrectinib', 'repotrectinib', 'taletrectinib'] },
  { label: 'RET', aliases: ['ret'], agents: ['selpercatinib', 'pralsetinib'] },
  { label: 'MET', aliases: ['met', 'cmet', 'c-met'], agents: ['capmatinib', 'tepotinib', 'amivantamab'] },
  { label: 'KRAS G12C', aliases: ['kras', 'g12c', 'krasg12c'], agents: ['sotorasib', 'adagrasib'] },
  { label: 'BRAF', aliases: ['braf', 'v600'], agents: ['vemurafenib', 'dabrafenib', 'encorafenib'] },
  { label: 'MEK', aliases: ['mek'], agents: ['trametinib', 'cobimetinib', 'binimetinib', 'selumetinib'] },
  { label: 'CDK4/6', aliases: ['cdk4', 'cdk6', 'cdk46', 'cdk4/6', 'cdk'], agents: ['palbociclib', 'ribociclib', 'abemaciclib'] },
  { label: 'PARP', aliases: ['parp'], agents: ['olaparib', 'niraparib', 'rucaparib', 'talazoparib'] },
  { label: 'PI3K', aliases: ['pi3k', 'pik3ca'], agents: ['idelalisib', 'alpelisib', 'copanlisib', 'duvelisib', 'inavolisib'] },
  { label: 'mTOR', aliases: ['mtor'], agents: ['everolimus', 'temsirolimus'] },
  { label: 'BTK', aliases: ['btk'], agents: ['ibrutinib', 'acalabrutinib', 'zanubrutinib', 'pirtobrutinib', 'remibrutinib'] },
  { label: 'BCL-2', aliases: ['bcl2', 'bcl-2'], agents: ['venetoclax'] },
  { label: 'FLT3', aliases: ['flt3'], agents: ['midostaurin', 'gilteritinib', 'quizartinib'] },
  { label: 'IDH1/IDH2', aliases: ['idh', 'idh1', 'idh2'], agents: ['ivosidenib', 'enasidenib', 'olutasidenib', 'vorasidenib'] },
  { label: 'menin', aliases: ['menin'], agents: ['revumenib', 'ziftomenib'] },
  { label: 'BCR-ABL', aliases: ['bcrabl', 'bcr-abl', 'abl', 'abl1'], agents: ['imatinib', 'dasatinib', 'nilotinib', 'bosutinib', 'ponatinib', 'asciminib'] },
  { label: 'FGFR', aliases: ['fgfr', 'fgfr2', 'fgfr3'], agents: ['erdafitinib', 'pemigatinib', 'futibatinib', 'nintedanib'] },
  { label: 'PDGFR', aliases: ['pdgfr'], agents: ['nintedanib', 'avapritinib'] },
  { label: 'VEGF/VEGFR', aliases: ['vegf', 'vegfr', 'vegfa', 'vegf-a', 'vegfr2'], agents: VEGF },
  { label: 'angiopoietin-2', aliases: ['ang2', 'ang-2', 'angiopoietin'], agents: ['faricimab'] },
  { label: 'JAK', aliases: ['jak', 'jak1', 'jak2', 'jak3', 'tyk2', 'janus kinase'], agents: ['tofacitinib', 'baricitinib', 'upadacitinib', 'filgotinib', 'abrocitinib', 'ritlecitinib', 'ruxolitinib', 'fedratinib', 'momelotinib', 'pacritinib', 'deucravacitinib', 'delgocitinib'] },
  { label: 'TEC kinase', aliases: ['tec'], agents: ['ritlecitinib'] },
  { label: 'TNF', aliases: ['tnf', 'tnfa', 'tnf-alpha', 'tnfalpha', 'tumour necrosis factor', 'tumor necrosis factor'], agents: ['adalimumab', 'etanercept', 'infliximab', 'golimumab', 'certolizumab'] },
  { label: 'IL-17', aliases: ['il17', 'il-17', 'il17a', 'il-17a', 'interleukin 17', 'interleukin-17'], agents: ['secukinumab', 'ixekizumab', 'bimekizumab', 'brodalumab'] },
  { label: 'IL-23', aliases: ['il23', 'il-23', 'interleukin 23', 'interleukin-23', 'il1223', 'il-12/23'], agents: ['guselkumab', 'risankizumab', 'tildrakizumab', 'mirikizumab', 'ustekinumab'] },
  { label: 'IL-12', aliases: ['il12', 'il-12', 'interleukin 12'], agents: ['ustekinumab'] },
  { label: 'IL-6', aliases: ['il6', 'il-6', 'il6r', 'il-6r', 'interleukin 6', 'interleukin-6'], agents: ['tocilizumab', 'sarilumab', 'siltuximab', 'satralizumab'] },
  { label: 'IL-4', aliases: ['il4', 'il-4', 'interleukin 4'], agents: ['dupilumab'] },
  { label: 'IL-13', aliases: ['il13', 'il-13', 'interleukin 13'], agents: ['dupilumab', 'tralokinumab', 'lebrikizumab'] },
  { label: 'IL-5', aliases: ['il5', 'il-5', 'interleukin 5'], agents: ['mepolizumab', 'reslizumab', 'benralizumab', 'depemokimab'] },
  { label: 'IL-31', aliases: ['il31', 'il-31'], agents: ['nemolizumab'] },
  { label: 'IgE', aliases: ['ige'], agents: ['omalizumab'] },
  { label: 'TSLP', aliases: ['tslp'], agents: ['tezepelumab'] },
  { label: 'type I interferon receptor', aliases: ['ifnar'], agents: ['anifrolumab'] },
  { label: 'BLyS/BAFF', aliases: ['blys', 'baff'], agents: ['belimumab'] },
  { label: 'CD20', aliases: ['cd20'], agents: ['rituximab', 'obinutuzumab', 'ofatumumab', 'ocrelizumab', 'ublituximab', 'mosunetuzumab', 'glofitamab', 'epcoritamab', 'odronextamab'] },
  { label: 'CD19', aliases: ['cd19'], agents: ['tafasitamab', 'loncastuximab', 'blinatumomab', 'inebilizumab', 'tisagenlecleucel', 'axicabtagene', 'brexucabtagene', 'lisocabtagene', 'obecabtagene'] },
  { label: 'CD38', aliases: ['cd38'], agents: ['daratumumab', 'isatuximab'] },
  { label: 'BCMA', aliases: ['bcma'], agents: ['teclistamab', 'elranatamab', 'linvoseltamab', 'belantamab', 'idecabtagene', 'ciltacabtagene'] },
  { label: 'CD3 (bispecific T-cell engager)', aliases: ['cd3', 'bispecific', 'bite', 't-cell engager', 'tcell engager'], agents: CD3_BISPECIFIC },
  { label: 'GPRC5D', aliases: ['gprc5d'], agents: ['talquetamab'] },
  { label: 'CD79b', aliases: ['cd79b'], agents: ['polatuzumab'] },
  { label: 'CD52', aliases: ['cd52'], agents: ['alemtuzumab'] },
  { label: 'SLAMF7', aliases: ['slamf7'], agents: ['elotuzumab'] },
  { label: 'XPO1', aliases: ['xpo1'], agents: ['selinexor'] },
  { label: 'EZH2', aliases: ['ezh2'], agents: ['tazemetostat'] },
  { label: 'DLL3', aliases: ['dll3'], agents: ['tarlatamab'] },
  { label: 'TROP-2', aliases: ['trop2', 'trop-2'], agents: ['sacituzumab', 'datopotamab'] },
  { label: 'Nectin-4', aliases: ['nectin4', 'nectin-4', 'nectin'], agents: ['enfortumab'] },
  { label: 'claudin 18.2', aliases: ['claudin', 'cldn182', 'cldn18.2', 'claudin 18.2', 'claudin182'], agents: ['zolbetuximab'] },
  { label: 'tissue factor', aliases: ['tissue factor', 'tissuefactor'], agents: ['tisotumab'] },
  { label: 'PSMA', aliases: ['psma'], agents: ['vipivotide'] },
  { label: 'proteasome', aliases: ['proteasome'], agents: ['bortezomib', 'carfilzomib', 'ixazomib'] },
  { label: 'HDAC', aliases: ['hdac'], agents: ['givinostat', 'panobinostat', 'vorinostat'] },
  { label: 'topoisomerase I', aliases: ['topoisomerase', 'topoisomerase i', 'topoisomerase 1'], agents: ['topotecan', 'irinotecan'] },
  { label: 'androgen receptor', aliases: ['ar', 'androgen receptor', 'androgenreceptor', 'androgen'], agents: ['enzalutamide', 'apalutamide', 'darolutamide'] },
  { label: 'CYP17', aliases: ['cyp17'], agents: ['abiraterone'] },
  { label: 'GLP-1', aliases: ['glp1', 'glp-1', 'glp1r', 'incretin'], agents: ['semaglutide', 'liraglutide', 'dulaglutide', 'exenatide', 'lixisenatide', 'tirzepatide'] },
  { label: 'GIP', aliases: ['gip'], agents: ['tirzepatide'] },
  { label: 'SGLT2', aliases: ['sglt2', 'sglt-2'], agents: ['dapagliflozin', 'empagliflozin', 'canagliflozin', 'ertugliflozin', 'sotagliflozin'] },
  { label: 'DPP-4', aliases: ['dpp4', 'dpp-4', 'dppiv', 'dpp-iv'], agents: ['sitagliptin', 'saxagliptin', 'linagliptin', 'vildagliptin', 'alogliptin'] },
  { label: 'MC4R', aliases: ['mc4r'], agents: ['setmelanotide'] },
  { label: 'PCSK9', aliases: ['pcsk9'], agents: ['evolocumab', 'alirocumab', 'inclisiran'] },
  { label: 'ANGPTL3', aliases: ['angptl3'], agents: ['evinacumab'] },
  { label: 'ATP citrate lyase', aliases: ['atp citrate lyase', 'atpcitratelyase', 'acl'], agents: ['bempedoic'] },
  { label: 'factor Xa', aliases: ['fxa', 'factor xa', 'factorxa', 'xa'], agents: ['rivaroxaban', 'apixaban', 'edoxaban'] },
  { label: 'thrombin (factor IIa)', aliases: ['thrombin', 'factor iia', 'factoriia', 'iia'], agents: ['dabigatran'] },
  { label: 'factor VIII', aliases: ['factor viii', 'factorviii', 'fviii'], agents: ['efanesoctocog', 'emicizumab'] },
  { label: 'TFPI', aliases: ['tfpi'], agents: ['marstacimab', 'concizumab'] },
  { label: 'complement C5', aliases: ['c5', 'complement c5'], agents: COMPLEMENT_C5 },
  { label: 'complement C3', aliases: ['c3', 'complement c3'], agents: ['pegcetacoplan'] },
  { label: 'complement factor B', aliases: ['factor b', 'factorb'], agents: ['iptacopan'] },
  { label: 'complement factor D', aliases: ['factor d', 'factord'], agents: ['danicopan'] },
  { label: 'C5a receptor', aliases: ['c5a', 'c5ar'], agents: ['avacopan'] },
  { label: 'complement', aliases: ['complement'], agents: [...COMPLEMENT_C5, 'pegcetacoplan', 'iptacopan', 'danicopan', 'avacopan'] },
  { label: 'FcRn', aliases: ['fcrn'], agents: ['efgartigimod', 'rozanolixizumab', 'nipocalimab'] },
  { label: 'S1P receptor', aliases: ['s1p', 's1p1', 's1pr'], agents: ['fingolimod', 'siponimod', 'ozanimod', 'ponesimod', 'etrasimod'] },
  { label: 'integrin', aliases: ['integrin', 'a4b7', 'alpha4'], agents: ['natalizumab', 'vedolizumab'] },
  { label: 'CGRP', aliases: ['cgrp'], agents: ['erenumab', 'fremanezumab', 'galcanezumab', 'eptinezumab', 'atogepant', 'rimegepant', 'ubrogepant'] },
  { label: 'RANKL', aliases: ['rankl'], agents: ['denosumab'] },
  { label: 'sclerostin', aliases: ['sclerostin'], agents: ['romosozumab'] },
  { label: 'PTH receptor', aliases: ['pth', 'pth1r', 'parathyroid'], agents: ['teriparatide', 'abaloparatide'] },
  { label: 'transthyretin', aliases: ['ttr', 'transthyretin'], agents: ['tafamidis', 'patisiran', 'vutrisiran', 'eplontersen', 'inotersen', 'acoramidis'] },
  { label: 'amyloid beta', aliases: ['amyloid beta', 'amyloidbeta', 'abeta', 'amyloid'], agents: ['lecanemab', 'donanemab', 'aducanumab'] },
  { label: 'SMN', aliases: ['smn', 'smn1', 'smn2'], agents: ['nusinersen', 'risdiplam', 'onasemnogene'] },
  { label: 'CFTR', aliases: ['cftr'], agents: ['ivacaftor', 'lumacaftor', 'tezacaftor', 'elexacaftor', 'vanzacaftor'] },
  { label: 'endothelin receptor', aliases: ['endothelin', 'era', 'eta', 'etb'], agents: ['macitentan', 'ambrisentan', 'bosentan', 'sparsentan', 'aprocitentan'] },
  { label: 'PDE5', aliases: ['pde5', 'pde-5'], agents: ['sildenafil', 'tadalafil'] },
  { label: 'prostacyclin receptor', aliases: ['prostacyclin', 'ip receptor'], agents: ['selexipag', 'iloprost', 'treprostinil'] },
  { label: 'soluble guanylate cyclase', aliases: ['sgc', 'guanylate cyclase'], agents: ['riociguat', 'vericiguat'] },
  { label: 'activin', aliases: ['activin', 'activin receptor'], agents: ['sotatercept'] },
  { label: 'thrombopoietin receptor', aliases: ['tpo', 'thrombopoietin', 'tpo-ra'], agents: ['eltrombopag', 'romiplostim', 'avatrombopag', 'lusutrombopag'] },
  { label: 'SYK', aliases: ['syk'], agents: ['fostamatinib'] },
  { label: 'kallikrein', aliases: ['kallikrein', 'plasma kallikrein'], agents: ['lanadelumab', 'berotralstat', 'ecallantide', 'sebetralstat'] },
  { label: 'bradykinin B2 receptor', aliases: ['bradykinin', 'b2 receptor', 'b2receptor'], agents: ['icatibant'] },
  { label: 'factor XIIa', aliases: ['factor xiia', 'factorxiia', 'fxiia'], agents: ['garadacimab'] },
  { label: 'mineralocorticoid receptor', aliases: ['mineralocorticoid', 'mr', 'mra'], agents: ['finerenone', 'spironolactone', 'eplerenone'] },
  { label: 'neprilysin', aliases: ['neprilysin', 'arni'], agents: ['sacubitril'] },
  { label: 'If channel', aliases: ['if channel', 'ifchannel', 'funny channel'], agents: ['ivabradine'] },
  { label: 'cardiac myosin', aliases: ['myosin', 'cardiac myosin', 'cardiacmyosin'], agents: ['mavacamten', 'aficamten'] },
  { label: 'HIV integrase', aliases: ['integrase', 'insti'], agents: ['bictegravir', 'dolutegravir', 'cabotegravir', 'raltegravir', 'elvitegravir'] },
  { label: 'HIV capsid', aliases: ['capsid'], agents: ['lenacapavir'] },
  { label: 'HIV protease', aliases: ['hiv protease'], agents: ['darunavir', 'atazanavir', 'lopinavir'] },
  { label: 'reverse transcriptase', aliases: ['reverse transcriptase', 'reversetranscriptase', 'nrti', 'nnrti'], agents: ['tenofovir', 'emtricitabine', 'lamivudine', 'abacavir', 'zidovudine', 'rilpivirine', 'doravirine', 'efavirenz', 'etravirine'] },
  { label: 'HCV NS5A', aliases: ['ns5a'], agents: ['velpatasvir', 'pibrentasvir', 'ledipasvir', 'elbasvir', 'daclatasvir'] },
  { label: 'HCV NS5B polymerase', aliases: ['ns5b', 'polymerase'], agents: ['sofosbuvir'] },
  { label: 'HCV NS3/4A protease', aliases: ['ns3', 'ns34a', 'ns3/4a'], agents: ['glecaprevir', 'voxilaprevir', 'grazoprevir', 'simeprevir'] },
  { label: 'COMT', aliases: ['comt'], agents: ['opicapone', 'entacapone', 'tolcapone'] },
  { label: 'MAO-B', aliases: ['maob', 'mao-b'], agents: ['safinamide', 'rasagiline', 'selegiline'] },
  { label: 'histamine H3 receptor', aliases: ['h3', 'histamine h3', 'histamine'], agents: ['pitolisant'] },
  { label: 'orexin receptor', aliases: ['orexin'], agents: ['daridorexant', 'suvorexant', 'lemborexant'] },
  { label: 'NK3 receptor', aliases: ['nk3', 'nk-3', 'neurokinin', 'neurokinin 3'], agents: ['fezolinetant', 'elinzanetant'] },
  { label: 'THR-beta', aliases: ['thrb', 'thr-beta', 'thrbeta', 'thyroid hormone receptor', 'thyroidhormonereceptor'], agents: ['resmetirom'] },
  { label: 'PPAR', aliases: ['ppar', 'ppar-delta', 'ppardelta', 'ppar-alpha'], agents: ['elafibranor', 'seladelpar'] },
  { label: 'FXR', aliases: ['fxr'], agents: ['obeticholic'] },
  { label: 'APRIL', aliases: ['april'], agents: ['sibeprenlimab', 'atacicept'] },
];

// Words that describe the drug class rather than the target ("PD-1 inhibitor",
// "anti-TNF antibody"): dropped before the alias lookup.
const CLASS_WORDS = /\b(?:inhibitors?|antagonists?|agonists?|blockers?|antibod(?:y|ies)|modulators?|targeted|therapy|therapies|drugs?|agents?|anti|mab|mabs|tki|tkis)\b/g;
const norm = (s: string): string => s.toLowerCase().replace(CLASS_WORDS, ' ').replace(/[^a-z0-9]+/g, '');

const BY_ALIAS = new Map<string, TargetClass>();
for (const t of TARGET_CLASSES) for (const a of t.aliases) BY_ALIAS.set(norm(a), t);

/** The target class a query names ("PD-L1", "anti-PD-1 antibody", "VEGFR TKI"), if any. */
export const resolveTarget = (query: string): TargetClass | undefined => BY_ALIAS.get(norm(query));

/** True when the agent (INN, possibly a combination "a / b") acts on the target. */
export const actsOn = (inn: string, target: TargetClass): boolean => {
  const words = inn.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return words.some((w) => target.agents.includes(w));
};
