#!/usr/bin/env python3
"""Build the bundled CDER Novel Drug Approvals snapshot (novel-approvals.json).

WHY THIS EXISTS
  The app's main "Approvals" view is driven live by the openFDA Drugs@FDA query
  in services/geminiService.ts, which requires `_exists_:openfda.pharm_class_epc`.
  That openFDA field is populated by a label-harmonisation step that LAGS the
  actual approval, so the newest novel drugs are silently dropped from the live
  view for weeks/months after approval. CDER's curated "Novel Drug Therapy
  Approvals" lists are the authoritative new-drug rosters, so we bundle them
  directly and show them in their own "Novel" tab, grouped by year.

SOURCE
  FDA "Novel Drug Approvals" pages (one per year), e.g.:
    https://www.fda.gov/drugs/novel-drug-approvals-fda/novel-drug-approvals-2025
    https://www.fda.gov/drugs/novel-drug-approvals-fda/novel-drug-approvals-2026
  These pages are protected by Akamai bot detection and cannot be scraped, but
  each has an "Export Excel" button. Download that export for every year and
  drop the .xlsx files in scripts/data/ (named novel-<year>.xlsx). Re-run this
  script to refresh; commit the regenerated novel-approvals.json.

  The exported sheet has a title row, a header row
  (No., Drug Name, Active Ingredient, Approval Date, FDA-approved use ...),
  then one row per drug. Approval dates are M/D/YYYY strings.

OUTPUT
  novel-approvals.json — { "<year>": [ {no, brandName, genericName,
  approvalDate (YYYY-MM-DD), indication}, ... ] }, newest approval first.
"""
import glob
import json
import os
import re
import sys

import openpyxl

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(HERE, "data")
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "..", "novel-approvals.json")


def norm_date(raw):
    """'M/D/YYYY' (or 'YYYY-MM-DD') -> 'YYYY-MM-DD'; pass through anything else."""
    if raw is None:
        return ""
    s = str(raw).strip()
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})$", s)
    if m:
        mo, da, yr = m.groups()
        return f"{yr}-{int(mo):02d}-{int(da):02d}"
    return s


# The FDA "Export Excel" buttons concatenate the cells' hyperlink TEXT into the
# value, so brand/use cells pick up these standard link labels. Strip them.
LINK_LABELS = ["Drug Trials Snapshot", "Press Release", "External Link Disclaimer"]


def clean(s):
    if s is None:
        return ""
    t = str(s).replace("\xa0", " ")
    for label in LINK_LABELS:
        t = t.replace(label, " ")
    return re.sub(r"\s+", " ", t).strip()


def strip_embedded_brands(drugs):
    """A stray brand-name anchor can get glued into another drug's use text
    (e.g. '...as an Komziftiadd-on...'). Remove any same-year brand that appears
    glued directly before a lowercase letter inside an indication."""
    brands = [d["brandName"] for d in drugs if len(d["brandName"]) >= 5]
    for d in drugs:
        for b in brands:
            if b == d["brandName"]:
                continue
            d["indication"] = re.sub(rf"{re.escape(b)}(?=[a-z])", "", d["indication"])
        d["indication"] = re.sub(r"\s+", " ", d["indication"]).strip()
    return drugs


def parse_year(path):
    ws = openpyxl.load_workbook(path, read_only=True, data_only=True).active
    drugs = []
    for row in ws.iter_rows(values_only=True):
        if not row or row[0] is None:
            continue
        no_cell = str(row[0]).strip().rstrip(".")
        if not no_cell.isdigit():
            continue  # skip title / header / blank rows
        drugs.append({
            "no": int(no_cell),
            "brandName": clean(row[1]),
            "genericName": clean(row[2]),
            "approvalDate": norm_date(row[3]),
            "indication": clean(row[4]) if len(row) > 4 else "",
        })
    strip_embedded_brands(drugs)
    # Newest approval first (the FDA pages list it this way; No. descends).
    drugs.sort(key=lambda d: d["no"], reverse=True)
    return drugs


def main():
    files = sorted(glob.glob(os.path.join(DATA_DIR, "novel-*.xlsx")))
    if not files:
        sys.exit(f"No novel-<year>.xlsx exports found in {DATA_DIR}")

    out = {}
    for path in files:
        m = re.search(r"novel-(\d{4})\.xlsx$", os.path.basename(path))
        if not m:
            print(f"  skipping unrecognised file: {path}")
            continue
        year = m.group(1)
        out[year] = parse_year(path)
        print(f"  {year}: {len(out[year])} novel approvals")

    # Years newest-first so the default tab shows the current year.
    ordered = {y: out[y] for y in sorted(out, reverse=True)}

    with open(os.path.abspath(OUT), "w") as f:
        json.dump(ordered, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(f"wrote {os.path.abspath(OUT)} ({sum(len(v) for v in out.values())} drugs)")


if __name__ == "__main__":
    main()
