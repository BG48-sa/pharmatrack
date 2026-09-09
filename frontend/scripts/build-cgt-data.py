#!/usr/bin/env python3
"""Build the bundled CBER cell & gene therapy snapshot (cgt-products.json).

WHY THIS EXISTS
  Drugs@FDA (the openFDA drugsfda endpoint the app searches) covers CDER
  products only. CBER-regulated cell & gene therapies — CAR-T, gene-edited and
  AAV/lentiviral gene therapies (Casgevy, Kymriah, Zolgensma, …) — are NOT in
  Drugs@FDA. They DO appear in the openFDA drug label endpoint, but those label
  records carry no approval date (effective_time is the label-revision date) and
  usually no pharm_class. This snapshot supplies the official FDA approval date
  and a descriptive class, keyed by BLA application number so it joins cleanly
  onto the label-search results in services/geminiService.ts.

SOURCE
  FDA "Approved Cellular and Gene Therapy Products":
  https://www.fda.gov/vaccines-blood-biologics/cellular-gene-therapy-products/approved-cellular-and-gene-therapy-products

  CBER has no live query API, so this is a manual snapshot. Approval dates are
  historical and stable; refresh when the FDA adds new approvals.

  Each product's identity (brand, generic, BLA number, sponsor) is verifiable
  against the openFDA label endpoint, e.g.:
    curl -G 'https://api.fda.gov/drug/label.json' \
      --data-urlencode 'search=openfda.brand_name:"Casgevy"' --data-urlencode 'limit=1'

OUTPUT
  cgt-products.json — { "<BLA number>": { "d": "YYYY-MM-DD", "c": "<class>",
                         "n": "<brand>", "g": "<generic>", "m": "<manufacturer>", "i": "<indication>" } }
  "n"/"g"/"m"/"i" let the US tab list products that have no openFDA label record.

To add a product: confirm its BLA number via the label endpoint above, then add
a row to PRODUCTS with the FDA approval date and a short class label, and re-run.
"""
import json, sys

OUT = sys.argv[1] if len(sys.argv) > 1 else "cgt-products.json"

# (BLA number, FDA approval date, drug class, brand, proper/generic name, manufacturer,
#  short indication) — BLA numbers and dates from the FDA product pages / approval letters.
PRODUCTS = [
    ("BLA125197", "2010-04-29", "Autologous cellular immunotherapy (prostate cancer)", "Provenge", "sipuleucel-T", "Dendreon", "Asymptomatic or minimally symptomatic metastatic castrate-resistant prostate cancer."),
    ("BLA125348", "2011-06-21", "Autologous cultured fibroblast therapy", "Laviv", "azficel-T", "Fibrocell Technologies", "Improvement of the appearance of moderate to severe nasolabial fold wrinkles in adults."),
    ("BLA125397", "2011-11-10", "HPC, cord blood (allogeneic transplant)", "Hemacord", "HPC, cord blood", "New York Blood Center", "Unrelated-donor hematopoietic progenitor cell transplantation, with an appropriate preparative regimen, for hematopoietic and immunologic reconstitution in inherited, acquired or treatment-related disorders of the hematopoietic system."),
    ("BLA125400", "2012-03-09", "Allogeneic cellularized scaffold (keratinocytes/fibroblasts)", "Gintuit", "allogeneic cultured keratinocytes and fibroblasts in bovine collagen", "Organogenesis", "Topical application to a surgically created vascular wound bed in the treatment of mucogingival conditions in adults."),
    ("BLA125391", "2012-05-24", "HPC, cord blood (allogeneic transplant)", "HPC, Cord Blood (Clinimmune Labs)", "HPC, cord blood", "Clinimmune Labs, University of Colorado Cord Blood Bank", "Unrelated-donor hematopoietic progenitor cell transplantation, with an appropriate preparative regimen, for hematopoietic and immunologic reconstitution in inherited, acquired or treatment-related disorders of the hematopoietic system."),
    ("BLA125407", "2012-10-04", "HPC, cord blood (allogeneic transplant)", "Ducord", "HPC, cord blood", "Duke University School of Medicine", "Unrelated-donor hematopoietic progenitor cell transplantation, with an appropriate preparative regimen, for hematopoietic and immunologic reconstitution in inherited, acquired or treatment-related disorders of the hematopoietic system."),
    ("BLA125413", "2013-05-30", "HPC, cord blood (allogeneic transplant)", "Allocord", "HPC, cord blood", "SSM Cardinal Glennon Children's Medical Center", "Unrelated-donor hematopoietic progenitor cell transplantation, with an appropriate preparative regimen, for hematopoietic and immunologic reconstitution in inherited, acquired or treatment-related disorders of the hematopoietic system."),
    ("BLA125432", "2013-06-13", "HPC, cord blood (allogeneic transplant)", "HPC, Cord Blood (LifeSouth)", "HPC, cord blood", "LifeSouth Community Blood Centers", "Unrelated-donor hematopoietic progenitor cell transplantation, with an appropriate preparative regimen, for hematopoietic and immunologic reconstitution in inherited, acquired or treatment-related disorders of the hematopoietic system."),
    ("BLA125518", "2015-10-27", "Oncolytic HSV-1 gene therapy", "Imlygic", "talimogene laherparepvec", "BioVex (Amgen)", "Local treatment of unresectable cutaneous, subcutaneous and nodal lesions in melanoma recurrent after initial surgery."),
    ("BLA125585", "2016-01-28", "HPC, cord blood (allogeneic transplant)", "HPC, Cord Blood (Bloodworks)", "HPC, cord blood", "Bloodworks", "Unrelated-donor hematopoietic progenitor cell transplantation, with an appropriate preparative regimen, for hematopoietic and immunologic reconstitution in inherited, acquired or treatment-related disorders of the hematopoietic system."),
    ("BLA125594", "2016-09-01", "HPC, cord blood (allogeneic transplant)", "Clevecord", "HPC, cord blood", "Cleveland Cord Blood Center", "Unrelated-donor hematopoietic progenitor cell transplantation, with an appropriate preparative regimen, for hematopoietic and immunologic reconstitution in inherited, acquired or treatment-related disorders of the hematopoietic system."),
    ("BLA125603", "2016-12-13", "Autologous cultured chondrocyte implant", "MACI", "autologous cultured chondrocytes on porcine collagen membrane", "Vericel", "Repair of symptomatic, single or multiple full-thickness cartilage defects of the knee in adults."),
    ("BLA125646", "2017-08-30", "CD19-directed CAR-T cell therapy", "Kymriah", "tisagenlecleucel", "Novartis", "Relapsed/refractory B-cell acute lymphoblastic leukemia in patients up to 25 years; relapsed/refractory large B-cell lymphoma and follicular lymphoma in adults."),
    ("BLA125643", "2017-10-18", "CD19-directed CAR-T cell therapy", "Yescarta", "axicabtagene ciloleucel", "Kite Pharma (Gilead)", "Relapsed/refractory large B-cell lymphoma and relapsed/refractory follicular lymphoma in adults."),
    ("BLA125610", "2017-12-19", "AAV2 gene therapy (RPE65)", "Luxturna", "voretigene neparvovec-rzyl", "Spark Therapeutics", "Confirmed biallelic RPE65 mutation-associated retinal dystrophy with viable retinal cells."),
    ("BLA125657", "2018-06-14", "HPC, cord blood (allogeneic transplant)", "HPC, Cord Blood (MD Anderson)", "HPC, cord blood", "MD Anderson Cord Blood Bank", "Unrelated-donor hematopoietic progenitor cell transplantation, with an appropriate preparative regimen, for hematopoietic and immunologic reconstitution in inherited, acquired or treatment-related disorders of the hematopoietic system."),
    ("BLA125694", "2019-05-24", "AAV9 gene therapy (SMN1)", "Zolgensma", "onasemnogene abeparvovec-xioi", "Novartis Gene Therapies", "Spinal muscular atrophy in patients under 2 years with bi-allelic SMN1 mutations."),
    ("BLA125703", "2020-07-24", "CD19-directed CAR-T cell therapy", "Tecartus", "brexucabtagene autoleucel", "Kite Pharma (Gilead)", "Relapsed/refractory mantle cell lymphoma and relapsed/refractory B-cell acute lymphoblastic leukemia in adults."),
    ("BLA125714", "2021-02-05", "CD19-directed CAR-T cell therapy", "Breyanzi", "lisocabtagene maraleucel", "Juno Therapeutics (Bristol Myers Squibb)", "Relapsed/refractory large B-cell lymphoma, CLL/SLL, follicular lymphoma and mantle cell lymphoma in adults."),
    ("BLA125736", "2021-03-26", "BCMA-directed CAR-T cell therapy", "Abecma", "idecabtagene vicleucel", "Celgene (Bristol Myers Squibb)", "Relapsed or refractory multiple myeloma after two or more prior lines including an immunomodulator, a proteasome inhibitor and an anti-CD38 antibody."),
    ("BLA125730", "2021-06-15", "Allogeneic cultured skin substitute (keratinocytes/fibroblasts)", "Stratagraft", "allogeneic cultured keratinocytes and dermal fibroblasts in murine collagen-dsat", "Stratatech (Mallinckrodt)", "Deep partial-thickness thermal burns with intact dermal elements in adults."),
    ("BLA125685", "2021-10-08", "Allogeneic processed thymus tissue", "Rethymic", "allogeneic processed thymus tissue-agdc", "Enzyvant Therapeutics (Sumitomo Pharma)", "Immune reconstitution in pediatric patients with congenital athymia."),
    ("BLA125746", "2022-02-28", "BCMA-directed CAR-T cell therapy", "Carvykti", "ciltacabtagene autoleucel", "Janssen Biotech", "Relapsed or refractory multiple myeloma after at least one prior line including a proteasome inhibitor and an immunomodulator, refractory to lenalidomide."),
    ("BLA125717", "2022-08-17", "Lentiviral ex-vivo gene therapy", "Zynteglo", "betibeglogene autotemcel", "bluebird bio", "Transfusion-dependent beta-thalassemia in adults and children."),
    ("BLA125755", "2022-09-16", "Lentiviral ex-vivo gene therapy", "Skysona", "elivaldogene autotemcel", "bluebird bio", "Slowing of neurologic dysfunction in boys 4-17 years with early, active cerebral adrenoleukodystrophy."),
    ("BLA125772", "2022-11-22", "AAV5 gene therapy (Factor IX)", "Hemgenix", "etranacogene dezaparvovec-drlb", "CSL Behring", "Hemophilia B in adults on factor IX prophylaxis or with life-threatening or repeated serious spontaneous bleeding."),
    ("BLA125700", "2022-12-16", "Adenoviral vector gene therapy", "Adstiladrin", "nadofaragene firadenovec-vcng", "Ferring Pharmaceuticals", "BCG-unresponsive non-muscle-invasive bladder cancer with carcinoma in situ, with or without papillary tumours."),
    ("BLA125738", "2023-04-17", "Expanded allogeneic cord-blood cell therapy", "Omisirge", "omidubicel-onlv", "Gamida Cell", "Hematologic malignancies planned for umbilical cord blood transplantation after myeloablative conditioning, to reduce time to neutrophil recovery and infections."),
    ("BLA125774", "2023-05-19", "HSV-1 vector gene therapy", "Vyjuvek", "beremagene geperpavec-svdt", "Krystal Biotech", "Wounds in patients 6 months and older with dystrophic epidermolysis bullosa with COL7A1 mutations."),
    ("BLA125781", "2023-06-22", "AAVrh74 gene therapy (microdystrophin)", "Elevidys", "delandistrogene moxeparvovec-rokl", "Sarepta Therapeutics", "Duchenne muscular dystrophy with a confirmed DMD gene mutation in ambulatory patients 4 years and older."),
    ("BLA125734", "2023-06-28", "Allogeneic pancreatic islet cell therapy", "Lantidra", "donislecel", "CellTrans", "Type 1 diabetes in adults unable to approach target HbA1c because of repeated severe hypoglycemia despite intensive management."),
    ("BLA125720", "2023-06-29", "AAV5 gene therapy (Factor VIII)", "Roctavian", "valoctocogene roxaparvovec-rvox", "BioMarin Pharmaceutical", "Severe hemophilia A in adults without pre-existing antibodies to AAV5. Marketed status: discontinued by the company."),
    ("BLA125788", "2023-12-08", "Lentiviral ex-vivo gene therapy", "Lyfgenia", "lovotibeglogene autotemcel", "bluebird bio", "Sickle cell disease in patients 12 years and older with a history of vaso-occlusive events."),
    ("BLA125787", "2023-12-08", "CRISPR/Cas9 gene-edited cell therapy", "Casgevy", "exagamglogene autotemcel", "Vertex Pharmaceuticals", "Sickle cell disease with recurrent vaso-occlusive crises (BLA 125787, approved 8 Dec 2023) and transfusion-dependent beta-thalassemia (BLA 125785, approved 16 Jan 2024), in patients 2 years and older per the current US label (July 2026; originally 12 years and older)."),
    ("BLA125773", "2024-02-16", "Autologous tumor-infiltrating lymphocyte (TIL) therapy", "Amtagvi", "lifileucel", "Iovance Biotherapeutics", "Unresectable or metastatic melanoma previously treated with a PD-1 antibody and, if BRAF V600-positive, a BRAF inhibitor."),
    ("BLA125758", "2024-03-18", "Lentiviral ex-vivo gene therapy", "Lenmeldy", "atidarsagene autotemcel", "Orchard Therapeutics", "Pre-symptomatic late infantile, pre-symptomatic early juvenile or early symptomatic early juvenile metachromatic leukodystrophy in children."),
    ("BLA125786", "2024-04-25", "AAVRh74var gene therapy (Factor IX)", "Beqvez", "fidanacogene elaparvovec-dzkt", "Pfizer", "Moderate to severe hemophilia B in adults on factor IX prophylaxis or with serious bleeding, without AAVRh74var antibodies. Marketed status: discontinued by the company."),
    ("BLA125789", "2024-08-01", "MAGE-A4-directed TCR T-cell therapy", "Tecelra", "afamitresgene autoleucel", "Adaptimmune", "Unresectable or metastatic synovial sarcoma in adults who have received prior chemotherapy, are HLA-A*02:01P, -A*02:02P, -A*02:03P or -A*02:06P positive (HLA-A*02:05P excluded) and whose tumour expresses MAGE-A4 (FDA-approved companion diagnostics)."),
    ("BLA125813", "2024-11-08", "CD19-directed CAR-T cell therapy", "Aucatzyl", "obecabtagene autoleucel", "Autolus", "Relapsed or refractory B-cell precursor acute lymphoblastic leukemia in adults."),
    ("BLA125722", "2024-11-13", "AAV2 gene therapy (AADC, intraputaminal)", "Kebilidi", "eladocagene exuparvovec-tneq", "PTC Therapeutics", "Aromatic L-amino acid decarboxylase (AADC) deficiency in adults and children."),
    ("BLA125764", "2024-11-20", "HPC, cord blood (allogeneic transplant)", "Regenecyte", "HPC, cord blood", "StemCyte", "Unrelated-donor hematopoietic progenitor cell transplantation, with an appropriate preparative regimen, for hematopoietic and immunologic reconstitution in inherited, acquired or treatment-related disorders of the hematopoietic system."),
    ("BLA125706", "2024-12-18", "Allogeneic mesenchymal stromal cell (MSC) therapy", "Ryoncil", "remestemcel-L-rknd", "Mesoblast", "Steroid-refractory acute graft-versus-host disease in pediatric patients 2 months and older."),
    ("BLA125812", "2024-12-19", "Acellular tissue-engineered vessel", "Symvess", "acellular tissue engineered vessel-tyod", "Humacyte Global", "Vascular conduit for extremity arterial injury in adults when urgent revascularization is needed and autologous vein graft is not feasible."),
    ("BLA125798", "2025-03-05", "Encapsulated cell therapy (CNTF-secreting)", "Encelto", "revakinagene taroretcel-lwey", "Neurotech Pharmaceuticals", "Macular telangiectasia type 2 in adults."),
    ("BLA125807", "2025-04-28", "Retroviral COL7A1 gene-corrected keratinocyte sheets", "Zevaskyn", "prademagene zamikeracel", "Abeona Therapeutics", "Wounds in adults and children with recessive dystrophic epidermolysis bullosa."),
    ("BLA125832", "2025-08-14", "Adenoviral vector immunotherapy (HPV 6/11)", "Papzimeos", "zopapogene imadenovec-drba", "Precigen", "Recurrent respiratory papillomatosis in adults."),
    ("BLA125856", "2025-11-24", "AAV9 gene therapy (SMN1, intrathecal)", "Itvisma", "onasemnogene abeparvovec-brve", "Novartis Gene Therapies", "Spinal muscular atrophy in patients 2 years and older with a confirmed SMN1 mutation (intrathecal)."),
    ("BLA125846", "2025-12-09", "Lentiviral ex-vivo gene therapy (WAS)", "Waskyra", "etuvetidigene autotemcel", "Fondazione Telethon", "Wiskott-Aldrich syndrome in patients 6 months and older with a WAS gene mutation, for whom haematopoietic stem cell transplantation is appropriate and no suitable HLA-matched related donor is available."),
    ("BLA125806", "2026-03-26", "Lentiviral ex-vivo gene therapy (ITGB2 / LAD-I)", "Kresladi", "marnetegragene autotemcel", "Rocket Pharmaceuticals", "Severe leukocyte adhesion deficiency-I (biallelic ITGB2 variants) in pediatric patients without an HLA-matched sibling donor."),
    ("BLA125874", "2026-04-23", "AAV gene therapy (OTOF, intracochlear)", "Otarmeni", "lunsotogene parvec-cwha", "Regeneron Pharmaceuticals", "Severe-to-profound sensorineural hearing loss due to biallelic OTOF variants, without a prior cochlear implant in the same ear."),
    ("BLA125868", "2026-06-30", "Allogeneic Treg-cell-engineered transplant graft therapy", "Tregzi", "allogeneic regulatory T cell immunotherapy with HSPC and T cells-vldq", "Orca Bio", "Adults with hematologic malignancies undergoing allogeneic hematopoietic stem cell transplant, to reduce graft-versus-host disease (Orca-T)."),
    ("BLA125827", "2026-08-06", "Oncolytic HSV-1 gene therapy (melanoma)", "Tudriqev", "vusolimogene oderparepvec-wtpg", "Replimune", "With nivolumab for unresectable advanced cutaneous melanoma after progression on a PD-1 antibody regimen (accelerated approval)."),
    ("BLA125858", "2026-08-19", "AAV8 gene therapy (G6PC, GSDIa)", "Genglycos", "pariglasgene brecaparvovec-opnr", "Ultragenyx Pharmaceutical", "Reduction of daily cornstarch intake in glycogen storage disease type Ia, patients 8 years and older (accelerated approval)."),
]

data = {
    bla: {"d": d, "c": c, "n": n, "g": g, "m": m, "i": i}
    for bla, d, c, n, g, m, i in PRODUCTS
}

with open(OUT, "w") as f:
    json.dump(data, f, indent=2, ensure_ascii=False)
    f.write("\n")

print(f"cell & gene therapy products: {len(data)}")
