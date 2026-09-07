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
import html, json, re, sys, datetime
import openpyxl

SRC = sys.argv[1] if len(sys.argv) > 1 else "/tmp/ema.xlsx"
OUT = sys.argv[2] if len(sys.argv) > 2 else "ema-medicines.json"

# 0-based column indices in the EMA report (header on row 8, data from row 9).
C_CATEGORY = 0
C_NAME = 1
C_STATUS = 3            # Authorised / Opinion / Withdrawn / Refused / ...
C_OPINION_STATUS = 4    # Positive / Negative (outcome of the CHMP opinion)
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
C_APP_WITHDRAWN_DATE = 30
C_MA_DATE = 31
C_REFUSAL_DATE = 32
C_MA_ENDED_DATE = 33   # withdrawal / expiry / revocation / lapse of MA
C_SUSPENDED_DATE = 34
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


# --- Drug-device combination flag (dev) --------------------------------------
# The EMA report has no pharmaceutical-form column, so the flag is inferred:
#   1. device-platform tokens inside the product name (inhaler families,
#      pre-filled pen suffixes) — covers most inhaled combos automatically;
#   2. a curated list of centrally authorised products whose device component
#      is integral (implants, delivery systems, on-body injectors).
# Deliberately conservative: only flag what is confidently a combination.
DEVICE_NAME_TOKENS = (
    # inhaler platforms (appear as the second word of the product name)
    "breezhaler", "ellipta", "respimat", "turbohaler", "turbuhaler",
    "spiromax", "genuair", "nexthaler", "diskus", "accuhaler", "aerosphere",
    "digihaler", "handihaler", "airmaster", "forspiro", "elpenhaler",
    # injector / pen platforms occasionally part of the EU trade name
    "solostar", "flextouch", "flexpen", "innolet", "kwikpen",
)
# Centrally authorised products whose device component is integral but whose
# name carries no platform token. Extend as new combos clear CHMP.
DEVICE_BRANDS = {
    "susvimo",   # ranibizumab ocular delivery system (refillable implant)
    "ozurdex",   # dexamethasone intravitreal implant
    "sixmo",     # buprenorphine subcutaneous implant
}


def is_device_combo(name):
    n = str(name or "").lower()
    words = n.replace("®", " ").split()
    if any(tok in words for tok in DEVICE_NAME_TOKENS):
        return True
    return bool(words) and words[0] in DEVICE_BRANDS


def detext(v):
    # EMA spreadsheet cells carry HTML remnants (&nbsp;, &lt;, &gt;, …). Decode
    # them and turn the non-breaking spaces they leave behind into plain spaces,
    # so the app never renders a literal "&nbsp;".
    return html.unescape(str(v or "")).replace("\xa0", " ")


def clean(v):
    return detext(v).strip()


def trunc(v, n=320):
    t = " ".join(detext(v).split())
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
by_name = {}       # EU brand (lower-case) -> record: product-identity lookups first
inn_products = {}  # INN key -> set of EU product names sharing it (ambiguity)
authorised = []
# EMA occasionally leaves the "Advanced therapy" flag empty on a product that
# plainly is one (Itvisma, June 2026; Tacquell). The WHO INN stems are
# unambiguous: "-cel" = cell therapy, "-vec" = gene-therapy vector. Any INN
# containing such a token counts as an ATMP, so the Advanced-therapy filter
# does not silently miss a CAT product.
ATMP_STEM = re.compile(r"\b[a-z]+(cel|vec)\b", re.I)

# Products whose INN carries no stem (descriptive names) but that are ATMPs.
ATMP_NAMES = {"Tacquell"}   # autologous tumour-infiltrating lymphocytes (TIL)

def looks_like_atmp(*fields):
    return any(ATMP_STEM.search(clean(f) or "") for f in fields)

pipeline = []
# --- ATMP classification -----------------------------------------------------
# EMA's report only carries a yes/no "Advanced therapy" flag. For the CAT
# audience the class matters: gene therapy (in vivo), gene-modified cell therapy
# (ex vivo gene therapy incl. CAR-T), somatic-cell therapy, tissue-engineered
# product. Reviewed assignments first; the WHO INN stems only as a fallback.
ATMP_CLASS = {
    # CAR-T (genetically modified autologous T cells)
    "kymriah": "CAR-T cell therapy (gene-modified T cells)", "yescarta": "CAR-T cell therapy (gene-modified T cells)",
    "tecartus": "CAR-T cell therapy (gene-modified T cells)", "breyanzi": "CAR-T cell therapy (gene-modified T cells)",
    "abecma": "CAR-T cell therapy (gene-modified T cells)", "carvykti": "CAR-T cell therapy (gene-modified T cells)",
    "aucatzyl": "CAR-T cell therapy (gene-modified T cells)",
    # in vivo gene therapy (viral vectors)
    "luxturna": "gene therapy (AAV, in vivo)", "zolgensma": "gene therapy (AAV, in vivo)", "itvisma": "gene therapy (AAV, in vivo, intrathecal)",
    "upstaza": "gene therapy (AAV, in vivo)", "hemgenix": "gene therapy (AAV, in vivo)", "roctavian": "gene therapy (AAV, in vivo)",
    "beqvez": "gene therapy (AAV, in vivo)", "elevidys": "gene therapy (AAV, in vivo)", "glybera": "gene therapy (AAV, in vivo)",
    "imlygic": "oncolytic viral gene therapy (HSV-1)", "adstiladrin": "gene therapy (adenoviral vector, intravesical)",
    "vyjuvek": "gene therapy (HSV-1 vector, topical)",
    # ex vivo gene therapy (gene-modified stem cells / cells)
    "strimvelis": "ex vivo gene therapy (gene-modified CD34+ cells)", "zynteglo": "ex vivo gene therapy (gene-modified CD34+ cells)",
    "skysona": "ex vivo gene therapy (gene-modified CD34+ cells)", "libmeldy": "ex vivo gene therapy (gene-modified CD34+ cells)",
    "casgevy": "ex vivo gene-edited cell therapy (CRISPR/Cas9 CD34+ cells)", "waskyra": "ex vivo gene therapy (gene-modified CD34+ cells)",
    "lumevoq": "gene therapy (AAV, in vivo)",
    # somatic-cell therapy
    "ebvallo": "somatic-cell therapy (allogeneic EBV-specific T cells)", "zalmoxis": "somatic-cell therapy (gene-modified donor T cells)",
    "zemcelpro": "somatic-cell therapy (expanded cord-blood CD34+ cells)", "provenge": "somatic-cell therapy (autologous cellular immunotherapy)",
    "alofisel": "somatic-cell therapy (allogeneic adipose-derived stem cells)", "tacquell": "somatic-cell therapy (autologous tumour-infiltrating lymphocytes)",
    "amtagvi": "somatic-cell therapy (autologous tumour-infiltrating lymphocytes)",
    # tissue-engineered
    "holoclar": "tissue-engineered product (autologous corneal epithelial cells)", "spherox": "tissue-engineered product (autologous chondrocyte spheroids)",
    "maci": "tissue-engineered product (autologous chondrocytes on membrane)", "chondrocelect": "tissue-engineered product (autologous chondrocytes)",
}
def atmp_class(slug, inn):
    if slug in ATMP_CLASS:
        return ATMP_CLASS[slug]
    s = str(inn or "").lower()
    if "cabtagene" in s or "tisagenlecleucel" in s:
        return "CAR-T cell therapy (gene-modified T cells)"
    if re.search(r"\bvec\b|parvovec|firadenovec|geperpavec|laherparepvec", s):
        return "gene therapy (viral vector)"
    if re.search(r"temcel\b", s):
        return "ex vivo gene therapy (gene-modified cells)"
    if re.search(r"\bcel\b|cells", s):
        return "cell therapy"
    return "advanced therapy (class not assigned)"

# Regulatory facts EMA's table does not carry or carries incompletely — each
# with its source. Keep this list short and sourced.
COND_CONVERTED = {           # conditional MA converted to a full MA (EMA overview page)
    "zolgensma": "2022-05-17",
}
MA_END_DATES = {             # withdrawal date missing in the table (EMA medicine page)
    "zalmoxis": "2019-10-09",
}
# Medicines that are no longer (or never became) authorised: withdrawn, expired,
# lapsed, revoked, suspended, refused, or application withdrawn. Shown on the
# Europe tab's "Withdrawn" view so the history of a product (e.g. Beqvez,
# Elevidys, Zynteglo) is one tap away instead of silently absent.
GONE_STATUSES = {
    "Withdrawn", "Expired", "Lapsed", "Revoked", "Suspended", "Refused",
    "Application withdrawn", "Withdrawn from rolling review",
}
gone = []

for i, row in enumerate(rows):
    if i <= 8:
        continue
    if clean(row[C_CATEGORY]) != "Human":
        continue
    status = clean(row[C_STATUS])

    ma_date = fmt_date(row[C_MA_DATE])
    op_date = fmt_date(row[C_OPINION_DATE])
    # Some authorised medicines leave the "Marketing authorisation date" column
    # empty but carry a "European Commission decision date" — the EC decision IS
    # the act that grants the centralised MA, so it's the correct authorisation
    # date to show. Without this fallback these drugs (e.g. Lyvdelzi/seladelpar,
    # Zurzuvae/zuranolone, Jeraygo/aprocitentan) vanish from the app entirely.
    if not ma_date:
        ma_date = fmt_date(row[C_EC_DATE])

    base = {
        "n": clean(row[C_NAME]),
        "inn": clean(row[C_INN]) or clean(row[C_SUBSTANCE]),
        "sub": clean(row[C_SUBSTANCE]),
        "area": clean(row[C_AREA]),
        "atc": clean(row[C_ATC]),
        "ind": trunc(row[C_INDICATION], 4000),
        "url": clean(row[C_URL]),
        "atmp": yes(row[C_ATMP]) or looks_like_atmp(row[C_INN], row[C_SUBSTANCE])
                or clean(row[C_NAME]) in ATMP_NAMES,
        "orphan": yes(row[C_ORPHAN]),
        "prime": yes(row[C_PRIME]),
        "cond": yes(row[C_CONDITIONAL]),
        "exc": yes(row[C_EXCEPTIONAL]),
        "acc": yes(row[C_ACCELERATED]),
        "bio": yes(row[C_BIOSIMILAR]),
        "gen": yes(row[C_GENERIC]),
        "dev": is_device_combo(row[C_NAME]),
        "holder": clean(row[C_HOLDER]),
    }
    slug_now = (clean(row[C_URL]).split("/EPAR/")[1] if "/EPAR/" in clean(row[C_URL]) else "").replace("-previously-", "").lower()
    if base["atmp"]:
        base["cls"] = atmp_class(slug_now, row[C_INN] or row[C_SUBSTANCE])
    if slug_now in COND_CONVERTED:
        base["cond"] = False
        base["condFull"] = COND_CONVERTED[slug_now]

    if status == "Authorised" and ma_date:
        authorised.append({**base, "d": ma_date, "op": op_date})
        # INN index (earliest MA wins) — keeps FDA-tab enrichment working.
        rec = {"d": ma_date, "n": base["n"], "u": base["url"], "b": base["bio"]}
        by_name[base["n"].lower()] = rec
        for k in norm_keys(row[C_INN], row[C_SUBSTANCE]):
            inn_products.setdefault(k, set()).add(base["n"])
            if k not in by_inn or ma_date < by_inn[k]["d"]:
                by_inn[k] = rec

    elif status in ("Opinion", "Opinion under re-examination") and op_date:
        outcome = clean(row[C_OPINION_STATUS]).lower()
        if outcome == "negative":
            # A negative CHMP opinion (recommendation to refuse) is NOT a pending
            # authorisation. Show it with the no-longer/never-authorised records.
            gone.append({**base, "st": "Negative CHMP opinion" + (" (re-examination)" if status != "Opinion" else ""), "e": op_date, "op": op_date})
        else:
            # Positive CHMP opinion adopted, MA not yet granted: EC decision is the
            # single most useful "MA expected very soon" signal for an EU user.
            # An unrecorded outcome stays unknown (no expected date is derived).
            pipeline.append({**base, "op": op_date, "reexam": status != "Opinion", "outcome": "positive" if outcome == "positive" else "unknown"})

    elif status in GONE_STATUSES:
        if status == "Refused":
            ev = fmt_date(row[C_REFUSAL_DATE])
        elif status in ("Application withdrawn", "Withdrawn from rolling review"):
            ev = fmt_date(row[C_APP_WITHDRAWN_DATE])
        elif status == "Suspended":
            ev = fmt_date(row[C_SUSPENDED_DATE]) or fmt_date(row[C_MA_ENDED_DATE])
        else:
            ev = fmt_date(row[C_MA_ENDED_DATE])
        # EMA sometimes leaves the withdrawal column empty (e.g. Zalmoxis,
        # Skysona). The latest European Commission decision date is then the
        # best available signal for when the MA ended — but only if it is not
        # before the authorisation itself. Never fall back to the CHMP opinion
        # date: that always precedes the MA and would read as nonsense.
        approx = False
        if slug_now in MA_END_DATES:
            ev = MA_END_DATES[slug_now]
        # Guard against a recorded end date that precedes the authorisation
        # (data-entry slips in the EMA table, e.g. Xevudy): treat as missing.
        if ev and ma_date and ev < ma_date:
            ev = ""
        if not ev:
            ec = fmt_date(row[C_EC_DATE])
            if ec and (not ma_date or ec >= ma_date):
                ev, approx = ec, True
        item = {**base, "st": status, "e": ev or ""}
        if approx:
            item["ex"] = True
        # A refused application never had an MA; EMA sometimes stores the
        # refusal decision date in the MA-date column, so don't show it as one.
        # A refused or withdrawn application never had an MA; EMA sometimes
        # stores other decision dates in the MA-date column for these rows, so
        # don't present them as an authorisation.
        if ma_date and status not in ("Refused", "Application withdrawn", "Withdrawn from rolling review"):
            item["d"] = ma_date
        if op_date:
            item["op"] = op_date
        gone.append(item)

authorised.sort(key=lambda r: r["d"], reverse=True)
pipeline.sort(key=lambda r: r["op"], reverse=True)
gone.sort(key=lambda r: r["e"] or "", reverse=True)

# Mark INN keys shared by several EU products: a substance-level match must never
# be presented as a specific product's authorisation (Itvisma vs Zolgensma).
for k, rec in by_inn.items():
    n = len(inn_products.get(k, ()))
    if n > 1:
        rec["k"] = n
# First-seen dates: the day DrugRadar first imported each record, kept across
# daily rebuilds. "New since your last visit" uses this, not the regulatory
# date, so a late import still shows as new. Records seen before this field
# existed are floored to their own regulatory date.
def _key(kind, r):
    return f"{kind}|{r['n']}|{r.get('d') or r.get('op') or r.get('e') or ''}"
prev_fs = {}
try:
    with open(OUT) as _f:
        _prev = json.load(_f)
    for kind, lst in (("a", _prev.get("authorised", [])), ("p", _prev.get("pipeline", [])), ("g", _prev.get("gone", []))):
        for r in lst:
            if r.get("fs"):
                prev_fs[_key(kind, r)] = r["fs"]
except Exception:
    pass
today = datetime.date.today().isoformat()
for kind, lst in (("a", authorised), ("p", pipeline), ("g", gone)):
    for r in lst:
        k = _key(kind, r)
        floor = r.get("d") or r.get("op") or r.get("e") or today
        r["fs"] = prev_fs.get(k) or (today if prev_fs else floor)

out = {
    "generated": generated,
    "byName": by_name,
    "byInn": by_inn,
    "authorised": authorised,
    "pipeline": pipeline,
    "gone": gone,
}

with open(OUT, "w") as f:
    json.dump(out, f, separators=(",", ":"), ensure_ascii=False)

print(
    f"generated {generated} | authorised {len(authorised)} | "
    f"pipeline {len(pipeline)} | gone {len(gone)} | inn keys {len(by_inn)} | "
    f"ATMP {sum(1 for r in authorised if r['atmp'])} authorised + "
    f"{sum(1 for r in pipeline if r['atmp'])} pending | "
    f"drug+device {sum(1 for r in authorised if r['dev'])} authorised + "
    f"{sum(1 for r in pipeline if r['dev'])} pending"
)
