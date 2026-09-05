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
  cgt-products.json — { "<BLA number>": { "d": "YYYY-MM-DD", "c": "<class>" } }

To add a product: confirm its BLA number via the label endpoint above, then add
a row to PRODUCTS with the FDA approval date and a short class label, and re-run.
"""
import json, sys

OUT = sys.argv[1] if len(sys.argv) > 1 else "cgt-products.json"

# (BLA number, FDA approval date, drug class) — verified against openFDA labels.
PRODUCTS = [
    ("BLA125197", "2010-04-29", "Autologous cellular immunotherapy (prostate cancer)"),  # Provenge
    ("BLA125348", "2011-06-21", "Autologous cultured fibroblast therapy"),  # Laviv
    ("BLA125400", "2012-03-09", "Allogeneic cellularized scaffold (keratinocytes/fibroblasts)"),  # Gintuit
    ("BLA125518", "2015-10-27", "Oncolytic HSV-1 gene therapy"),  # Imlygic
    ("BLA125603", "2016-12-13", "Autologous cultured chondrocyte implant"),  # MACI
    ("BLA125646", "2017-08-30", "CD19-directed CAR-T cell therapy"),  # Kymriah
    ("BLA125643", "2017-10-18", "CD19-directed CAR-T cell therapy"),  # Yescarta
    ("BLA125610", "2017-12-19", "AAV2 gene therapy (RPE65)"),  # Luxturna
    ("BLA125694", "2019-05-24", "AAV9 gene therapy (SMN1)"),  # Zolgensma
    ("BLA125703", "2020-07-24", "CD19-directed CAR-T cell therapy"),  # Tecartus
    ("BLA125714", "2021-02-05", "CD19-directed CAR-T cell therapy"),  # Breyanzi
    ("BLA125736", "2021-03-26", "BCMA-directed CAR-T cell therapy"),  # Abecma
    ("BLA125730", "2021-06-15", "Allogeneic cultured skin substitute (keratinocytes/fibroblasts)"),  # Stratagraft
    ("BLA125685", "2021-10-08", "Allogeneic processed thymus tissue"),  # Rethymic
    ("BLA125746", "2022-02-28", "BCMA-directed CAR-T cell therapy"),  # Carvykti
    ("BLA125717", "2022-08-17", "Lentiviral ex-vivo gene therapy"),  # Zynteglo
    ("BLA125755", "2022-09-16", "Lentiviral ex-vivo gene therapy"),  # Skysona
    ("BLA125772", "2022-11-22", "AAV5 gene therapy (Factor IX)"),  # Hemgenix
    ("BLA125700", "2022-12-16", "Adenoviral vector gene therapy"),  # Adstiladrin
    ("BLA125738", "2023-04-17", "Expanded allogeneic cord-blood cell therapy"),  # Omisirge
    ("BLA125774", "2023-05-19", "HSV-1 vector gene therapy"),  # Vyjuvek
    ("BLA125781", "2023-06-22", "AAVrh74 gene therapy (microdystrophin)"),  # Elevidys
    ("BLA125734", "2023-06-28", "Allogeneic pancreatic islet cell therapy"),  # Lantidra
    ("BLA125720", "2023-06-29", "AAV5 gene therapy (Factor VIII)"),  # Roctavian
    ("BLA125787", "2023-12-08", "CRISPR/Cas9 gene-edited cell therapy"),  # Casgevy
    ("BLA125788", "2023-12-08", "Lentiviral ex-vivo gene therapy"),  # Lyfgenia
    ("BLA125773", "2024-02-16", "Autologous tumor-infiltrating lymphocyte (TIL) therapy"),  # Amtagvi
    ("BLA125758", "2024-03-18", "Lentiviral ex-vivo gene therapy"),  # Lenmeldy
    ("BLA125786", "2024-04-25", "AAVRh74var gene therapy (Factor IX)"),  # Beqvez
    ("BLA125789", "2024-08-01", "MAGE-A4-directed TCR T-cell therapy"),  # Tecelra
    ("BLA125813", "2024-11-08", "CD19-directed CAR-T cell therapy"),  # Aucatzyl
    ("BLA125722", "2024-11-13", "AAV2 gene therapy (AADC, intraputaminal)"),  # Kebilidi
    ("BLA125706", "2024-12-18", "Allogeneic mesenchymal stromal cell (MSC) therapy"),  # Ryoncil
    ("BLA125812", "2024-12-19", "Acellular tissue-engineered vessel"),  # Symvess
    ("BLA125798", "2025-03-05", "Encapsulated cell therapy (CNTF-secreting)"),  # Encelto
    ("BLA125807", "2025-04-28", "Retroviral COL7A1 gene-corrected keratinocyte sheets"),  # Zevaskyn
    ("BLA125832", "2025-08-14", "Adenoviral vector immunotherapy (HPV 6/11)"),  # Papzimeos
    ("BLA125856", "2025-11-24", "AAV9 gene therapy (SMN1, intrathecal)"),  # Itvisma
    ("BLA125846", "2025-12-09", "Lentiviral ex-vivo gene therapy (WAS)"),  # Waskyra
    ("BLA125806", "2026-03-26", "Lentiviral ex-vivo gene therapy (ITGB2 / LAD-I)"),  # Kresladi
    ("BLA125874", "2026-04-23", "AAV gene therapy (OTOF, intracochlear)"),  # Otarmeni
    ("BLA125868", "2026-06-30", "Allogeneic Treg-cell-engineered transplant graft therapy"),  # Tregzi (Orca-T)
    ("BLA125827", "2026-08-06", "Oncolytic HSV-1 gene therapy (melanoma)"),  # Tudriqev
    ("BLA125858", "2026-08-19", "AAV8 gene therapy (G6PC, GSDIa)"),  # Genglycos
]

data = {bla: {"d": d, "c": c} for bla, d, c in PRODUCTS}

with open(OUT, "w") as f:
    json.dump(data, f, indent=2, ensure_ascii=False)
    f.write("\n")

print(f"cell & gene therapy products: {len(data)}")
