#!/usr/bin/env python3
"""Build the EMA dataset bundled with the app.

Source: official EMA "Download medicine data" human-medicines report (xlsx).
  https://www.ema.europa.eu/en/documents/report/medicines-output-medicines-report_en.xlsx

EMA has no live, CORS-friendly query API, so we snapshot the authoritative
dataset into JSON. The report carries everything an EU-focused user needs:
marketing-authorisation date, CHMP opinion date (the "MA expected" signal),
therapeutic area / indication (disease search), ATC code, and the regulatory
flags that matter most to an EMA committee member — Advanced therapy (ATMP),
Orphan, PRIME, Conditional approval, Exceptional circumstances, Accelerated
assessment, Biosimilar, Generic.

Output shape (ema-medicines.json):
  {
    "generated": "YYYY-MM-DD",          # report generation date
    "byInn":      { "<inn key>": {d,n,u,b}, ... },   # INN -> earliest MA, for FDA-tab enrichment
    "authorised": [ EmaMedicine, ... ],  # all authorised human medicines, MA date desc
    "pipeline":   [ EmaPipelineItem, ...]# positive CHMP opinion, MA pending (EC decision imminent)
  }

EmaMedicine / EmaPipelineItem fields:
  n=name, inn, sub=active substance, d=MA date (or null), op=opinion date,
  area=therapeutic area (MeSH), atc, ind=therapeutic indication (truncated),
  url, atmp, orphan, prime, cond(itional), exc(eptional), acc(elerated),
  bio(similar), gen(eric), holder=MA holder/applicant.

Usage:
  curl -sL -A "Mozilla/5.0" -o /tmp/ema.xlsx <url-above>
  python3 scripts/build-ema-data.py /tmp/ema.xlsx ema-medicines.json
"""
import json, sys, datetime
import openpyxl

SRC = sys.argv[1] if len(sys.argv) > 1 else "/tmp/ema.xlsx"
OUT = sys.argv[2] if len(sys.argv) > 2 else "ema-medicines.json"

# 0-based column indices in the EMA report (header on row 8, data from row 9).
C_CATEGORY = 0
C_NAME = 1
C_STATUS = 3            # Authorised / Opinion / Withdrawn / Refused / ...
C_INN = 6
C_SUBSTANCE = 7
C_AREA = 8             # Therapeutic area (MeSH)
C_ATC = 11
C_INDICATION = 15
C_ACCELERATED = 16
C_ATMP = 18            # Advanced therapy
C_BIOSIMILAR = 19
C_CONDITIONAL = 20
C_EXCEPTIONAL = 21
C_GENERIC = 22
C_ORPHAN = 23
C_PRIME = 24
C_HOLDER = 25
C_EC_DATE = 26
C_OPINION_DATE = 29
C_MA_DATE = 31
C_URL = 38


def fmt_date(v):
    if v is None or v == "":
        return None
    if isinstance(v, (datetime.datetime, datetime.date)):
        return v.strftime("%Y-%m-%d")
    s = str(v).strip()
    for f in ("%d/%m/%Y", "%Y-%m-%d", "%d.%m.%Y"):
        try:
            return datetime.datetime.strptime(s[:10], f).strftime("%Y-%m-%d")
        except ValueError:
            pass
    return s[:10] or None


def yes(v):
    return str(v or "").strip().lower() == "yes"


def clean(v):
    return str(v or "").strip()


def trunc(v, n=320):
    t = " ".join(str(v or "").split())
    return (t[:n].rsplit(" ", 1)[0] + "…") if len(t) > n else t


def norm_keys(inn, substance):
    keys = set()
    for raw in (inn, substance):
        if not raw:
            continue
        for part in str(raw).lower().replace("/", ";").split(";"):
            p = part.strip()
            if p:
                keys.add(p)
                keys.add(p.split()[0])  # first token (drops salt forms)
    return keys


wb = openpyxl.load_workbook(SRC, read_only=True)
ws = wb["Medicine"]
rows = list(ws.iter_rows(values_only=True))

generated = fmt_date(rows[0][3]) if len(rows) > 0 else None

by_inn = {}
authorised = []
pipeline = []

for i, row in enumerate(rows):
    if i <= 8:
        continue
    if clean(row[C_CATEGORY]) != "Human":
        continue
    status = clean(row[C_STATUS])

    ma_date = fmt_date(row[C_MA_DATE])
    op_date = fmt_date(row[C_OPINION_DATE])

    base = {
        "n": clean(row[C_NAME]),
        "inn": clean(row[C_INN]) or clean(row[C_SUBSTANCE]),
        "sub": clean(row[C_SUBSTANCE]),
        "area": clean(row[C_AREA]),
        "atc": clean(row[C_ATC]),
        "ind": trunc(row[C_INDICATION]),
        "url": clean(row[C_URL]),
        "atmp": yes(row[C_ATMP]),
        "orphan": yes(row[C_ORPHAN]),
        "prime": yes(row[C_PRIME]),
        "cond": yes(row[C_CONDITIONAL]),
        "exc": yes(row[C_EXCEPTIONAL]),
        "acc": yes(row[C_ACCELERATED]),
        "bio": yes(row[C_BIOSIMILAR]),
        "gen": yes(row[C_GENERIC]),
        "holder": clean(row[C_HOLDER]),
    }

    if status == "Authorised" and ma_date:
        authorised.append({**base, "d": ma_date, "op": op_date})
        # INN index (earliest MA wins) — keeps FDA-tab enrichment working.
        rec = {"d": ma_date, "n": base["n"], "u": base["url"], "b": base["bio"]}
        for k in norm_keys(row[C_INN], row[C_SUBSTANCE]):
            if k not in by_inn or ma_date < by_inn[k]["d"]:
                by_inn[k] = rec

    elif status in ("Opinion", "Opinion under re-examination") and op_date:
        # Positive CHMP opinion adopted, MA not yet granted: EC decision is the
        # single most useful "MA expected very soon" signal for an EU user.
        pipeline.append({**base, "op": op_date, "reexam": status != "Opinion"})

authorised.sort(key=lambda r: r["d"], reverse=True)
pipeline.sort(key=lambda r: r["op"], reverse=True)

out = {
    "generated": generated,
    "byInn": by_inn,
    "authorised": authorised,
    "pipeline": pipeline,
}

with open(OUT, "w") as f:
    json.dump(out, f, separators=(",", ":"), ensure_ascii=False)

print(
    f"generated {generated} | authorised {len(authorised)} | "
    f"pipeline {len(pipeline)} | inn keys {len(by_inn)} | "
    f"ATMP {sum(1 for r in authorised if r['atmp'])} authorised + "
    f"{sum(1 for r in pipeline if r['atmp'])} pending"
)
