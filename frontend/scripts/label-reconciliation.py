#!/usr/bin/env python3
"""Approval-to-label reconciliation queue (frontend/pending-labels.json).

WHY THIS EXISTS
  DrugRadar can show a medicine the day it is approved — before the official
  product information exists. The US "Recent Approvals" list carries a one-line
  indication SUMMARY from CDER's novel-drug roster until openFDA has the
  prescribing information (USPI); an EU medicine shows the wording of EMA's
  medicine table until its SmPC (Annex I, section 4.1) has been extracted; a
  positive CHMP opinion waits for the Commission decision and then for the
  final product information. Each of those is an unfinished hand-over from a
  regulatory EVENT to the authoritative DOCUMENT — and nothing in the daily
  refresh used to track it: a provisional record could sit in the app for
  weeks after the real label was published, and a successful run would never
  say so.

  This script keeps a small persistent queue of every medicine whose official
  labeling is still outstanding and checks it at every refresh:

    FDA  AWAITING_USPI ──► LABEL_AVAILABLE ──► LABEL_VERIFIED
         (approved, no   (a label record     (application number / name
          USPI at openFDA)  found, failed      verified, Indications and Usage
                            validation)        present, hash + set ID recorded)

    EMA  AWAITING_EC_DECISION ──► AWAITING_SMPC ──► LABEL_AVAILABLE ──► LABEL_VERIFIED
         (positive CHMP     (authorised, no   (EMA publishes the     (SmPC extract has
          opinion)           SmPC extract)     product information    4.1 + 4.2, hash
                                               PDF — detected by      from smpc-index)
                                               HEAD probe)

  A verified entry never regresses (validate-release.py gate G8). Every
  transition is dated and kept in the entry's history, with the source
  document's identifiers (application number, SPL set ID / version, EMA
  product number, URL) and a SHA-256 of the ingested text, so the step from
  "approved" to "labelled" is traceable for every medicine.

  Hand-overs that stay open beyond a threshold raise an ALERT (GitHub warning
  annotation + run summary; `alerts=N` in $GITHUB_OUTPUT): a US approval with
  no USPI after --us-pending-days, an EU authorisation with no SmPC after
  --eu-pending-days, a document detected but not ingested after --ingest-days,
  a verified label that openFDA no longer returns. Alerts never block a
  release — the data is right, only incomplete — unless --fail-on-alert.

WHAT THE APP DOES WITH IT
  pending-labels.json is published with every release (copy-data.mjs hashes
  it into release.json like the other snapshots). services/labelQueue.ts
  reads it: a VERIFIED US entry supplies the official Indications and Usage
  text when openFDA is unreachable or the app would otherwise show the
  summary; every tracked medicine shows its state ("label pending", "label
  found", "label verified <date>") in the list card, the detail sheet and the
  PDF export — identical in the web app and the native app.

INPUTS (frontend/)       us-recent.json, novel-approvals.json, cgt-products.json,
                         ema-medicines.json, smpc-index.json, smpc-data/<slug>.json,
                         and the previous pending-labels.json (state carried over)
NETWORK (--probe)        openFDA drug/label (batches of application numbers,
                         brand-name lookups for roster-only drugs); HTTP HEAD of
                         EMA's product-information PDF for EU medicines awaiting
                         their SmPC. A handful of requests per run.
OUTPUT                   --json (the queue), --md (report for the run summary /
                         weekly report), $GITHUB_OUTPUT alerts=N unresolved=N.

Only python3 stdlib. Usage:
  python3 frontend/scripts/label-reconciliation.py --probe --json frontend/pending-labels.json --md /tmp/labels.md
  python3 frontend/scripts/label-reconciliation.py            # offline: state from files only
"""
import argparse
import datetime as dt
import hashlib
import json
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
FRONTEND = os.path.dirname(HERE)

LABEL_API = 'https://api.fda.gov/drug/label.json'
EMA_PI_URL = 'https://www.ema.europa.eu/en/documents/product-information/{slug}-epar-product-information_en.pdf'
DAILYMED_URL = 'https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid={setid}'
UA = 'DrugRadar-refresh (label reconciliation)'

# Statuses, in the order of the hand-over. VERIFIED is terminal.
S_AWAITING_USPI = 'AWAITING_USPI'
S_AWAITING_EC = 'AWAITING_EC_DECISION'
S_AWAITING_SMPC = 'AWAITING_SMPC'
S_AVAILABLE = 'LABEL_AVAILABLE'
S_VERIFIED = 'LABEL_VERIFIED'
STATUSES = [S_AWAITING_USPI, S_AWAITING_EC, S_AWAITING_SMPC, S_AVAILABLE, S_VERIFIED]
OPEN = [s for s in STATUSES if s != S_VERIFIED]

MIN_INDICATION_CHARS = 40     # an Indications and Usage section shorter than this is not a label
INDICATION_CAP = 6000         # characters of the verified text carried in the queue (the app shows it)
HISTORY_CAP = 20
APP_BATCH = 20                # application numbers per openFDA query


# --------------------------------------------------------------------------- helpers
def today_iso():
    return dt.date.today().isoformat()


def iso(d):
    """'20260928' / '2026-09-28' / '2026-09-28T..' -> '2026-09-28' (or None)."""
    if not d:
        return None
    s = str(d)
    if re.fullmatch(r'\d{8}', s):
        return f'{s[:4]}-{s[4:6]}-{s[6:]}'
    m = re.match(r'(\d{4}-\d{2}-\d{2})', s)
    return m.group(1) if m else None


def days_between(a, b):
    try:
        return (dt.date.fromisoformat(b) - dt.date.fromisoformat(a)).days
    except Exception:  # noqa: BLE001
        return None


def norm(s):
    s = unicodedata.normalize('NFKD', str(s or '')).encode('ascii', 'ignore').decode()
    return re.sub(r'[^a-z0-9]+', ' ', s.lower()).strip()


def title(s):
    s = str(s or '').strip()
    if not s:
        return s
    if s.isupper():
        return ' '.join(w.capitalize() for w in s.lower().split())
    return s


def read_json(path, default=None):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except Exception:  # noqa: BLE001
        return default


def sha256(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def http(url, method='GET', tries=3, timeout=60):
    """Return (status, headers, body-bytes). 404 is a normal answer, not an error."""
    for i in range(tries):
        try:
            req = urllib.request.Request(url, method=method, headers={'User-Agent': UA if 'fda.gov' in url else 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.status, dict(r.headers), (r.read() if method == 'GET' else b'')
        except urllib.error.HTTPError as e:
            if e.code in (404, 400):
                return e.code, dict(e.headers or {}), b''
            if i == tries - 1:
                raise
        except Exception:  # noqa: BLE001
            if i == tries - 1:
                raise
        time.sleep(2 * (i + 1))
    return None, {}, b''


def slug_of(url):
    s = (url or '').split('/EPAR/')
    return (s[1].strip() if len(s) > 1 else '').replace('-previously-', '').lower()


# --------------------------------------------------------------------------- queue model
class Queue:
    def __init__(self, previous, today):
        self.today = today
        self.by_id = {}
        self.transitions = []     # (id, drug, from, to, note) this run
        self.closed = []          # entries dropped this run (withdrawn / aged out)
        self.probed = False
        for e in (previous or {}).get('entries') or []:
            if e.get('id'):
                self.by_id[e['id']] = e

    def get(self, id_):
        return self.by_id.get(id_)

    def ensure(self, id_, **fields):
        """Create the entry if new (status taken from fields['status']), else refresh static fields."""
        e = self.by_id.get(id_)
        if e is None:
            status = fields.pop('status')
            e = {'id': id_, **fields, 'status': status, 'firstSeen': self.today, 'statusSince': self.today,
                 'history': [{'date': self.today, 'status': status, 'note': 'entered the queue'}]}
            self.by_id[id_] = e
            self.transitions.append((id_, e.get('drug'), None, status, 'new'))
        else:
            fields.pop('status', None)
            for k, v in fields.items():
                if v not in (None, '', []):
                    e[k] = v
        e['lastChecked'] = self.today
        return e

    def set_status(self, e, status, note=''):
        if e.get('status') == status:
            return
        if e.get('status') == S_VERIFIED:
            # Terminal: never regress. Record the observation as an alert instead.
            e['alert'] = note or f'would move from {S_VERIFIED} to {status}'
            return
        self.transitions.append((e['id'], e.get('drug'), e.get('status'), status, note))
        e['status'] = status
        e['statusSince'] = self.today
        e.setdefault('history', []).append({'date': self.today, 'status': status, **({'note': note} if note else {})})
        e['history'] = e['history'][-HISTORY_CAP:]

    def drop(self, id_, why):
        e = self.by_id.pop(id_, None)
        if e:
            self.closed.append((id_, e.get('drug'), e.get('status'), why))


# --------------------------------------------------------------------------- US side
def us_candidates(fe, today, window):
    """{norm brand: candidate} from Drugs@FDA recent list, CDER novel roster, CBER list."""
    since = (dt.date.fromisoformat(today) - dt.timedelta(days=window)).isoformat()
    cands = {}
    us_recent = read_json(os.path.join(fe, 'us-recent.json'), {}) or {}
    for it in us_recent.get('items') or []:
        d = iso(it.get('orig'))
        if not d or d < since:
            continue
        prods = it.get('products') or []
        brand = next((p.get('brand_name') for p in prods if p.get('brand_name')), None) or (it.get('openfda') or {}).get('brand_name', [None])[0]
        if not brand:
            continue
        inn = ', '.join(a.get('name') for p in prods[:1] for a in (p.get('active_ingredients') or []) if a.get('name'))
        c = cands.setdefault(norm(brand), {'drug': title(brand), 'inn': inn.lower() or None, 'approvalDate': d, 'sources': []})
        c['applicationNumber'] = it.get('application_number')
        c['sources'].append('drugsfda')
        c['sponsor'] = title(it.get('sponsor_name'))
    novel = read_json(os.path.join(fe, 'novel-approvals.json'), {}) or {}
    for rows in novel.values():
        for n in rows or []:
            d = iso(n.get('approvalDate'))
            if not d or d < since or not n.get('brandName'):
                continue
            c = cands.setdefault(norm(n['brandName']), {'drug': n['brandName'], 'inn': n.get('genericName'), 'approvalDate': d, 'sources': []})
            c['drug'] = n['brandName']                         # the roster spells the brand properly
            c['inn'] = c.get('inn') or n.get('genericName')
            c['summary'] = n.get('indication')
            c['sources'].append('novel')
    cgt = read_json(os.path.join(fe, 'cgt-products.json'), {}) or {}
    for bla, r in cgt.items():
        d = iso(r.get('d'))
        if not d or d < since or not r.get('n'):
            continue
        c = cands.setdefault(norm(r['n']), {'drug': r['n'], 'inn': r.get('g'), 'approvalDate': d, 'sources': []})
        c['applicationNumber'] = c.get('applicationNumber') or (bla if bla.startswith(('BLA', 'NDA')) else None)
        c['summary'] = c.get('summary') or r.get('i')
        c['sources'].append('cber')
    return cands


def validate_us_label(rec, app, brand, inn):
    """(ok, checks) for one openFDA label record against the queue entry."""
    of = rec.get('openfda') or {}
    apps = [a.upper() for a in of.get('application_number') or []]
    brands = [norm(b) for b in of.get('brand_name') or []]
    generics = [norm(g) for g in (of.get('generic_name') or []) + (of.get('substance_name') or [])]
    # Labels openFDA has not harmonised yet have no `openfda` block at all; the
    # SPL product data elements ("BRAND generic INGREDIENT …") still name them.
    pde = norm((rec.get('spl_product_data_elements') or [''])[0])
    text = '\n\n'.join(t for t in rec.get('indications_and_usage') or [] if t).strip()
    nb, ni = norm(brand), norm(inn)
    ni_first = ni.split(' ')[0] if ni else ''
    name_ok = bool(nb and any(nb == b or nb in b or b in nb for b in brands)) \
        or bool(ni and any(ni == g or ni in g or g in ni for g in generics)) \
        or bool(nb and pde and (pde.startswith(nb) or f' {nb} ' in f' {pde} ')) \
        or bool(ni_first and len(ni_first) > 5 and pde and ni_first in pde)
    checks = {
        'applicationMatch': (app.upper() in apps) if app and apps else None,   # None = openFDA has not linked the label to an application yet
        'nameMatch': name_ok,
        'indicationsPresent': len(text) >= MIN_INDICATION_CHARS,
        'prescription': 'HUMAN PRESCRIPTION DRUG' in (of.get('product_type') or []) if of else None,
        'harmonised': bool(of),
    }
    ok = checks['indicationsPresent'] and checks['nameMatch'] and checks['applicationMatch'] is not False
    return ok, checks, text


def brand_query_term(brand):
    """Search term for a brand: letters/digits only, at most three words ("Bixlenvo Sunlenca Starter Pack (copackaged)" → "Bixlenvo Sunlenca Starter")."""
    words = re.sub(r'[^A-Za-z0-9 -]', ' ', str(brand or '')).split()
    return ' '.join(words[:3])


def openfda_lookup_apps(apps):
    """One query for up to APP_BATCH application numbers -> {app: [records]}."""
    clause = ' '.join(f'"{a}"' for a in apps)
    q = urllib.parse.urlencode({'search': f'openfda.application_number:({clause})', 'limit': '100'})
    status, _, body = http(f'{LABEL_API}?{q}')
    out = {}
    if status != 200 or not body:
        return out
    for r in json.loads(body).get('results') or []:
        for a in (r.get('openfda') or {}).get('application_number') or []:
            out.setdefault(a.upper(), []).append(r)
    return out


def openfda_lookup_brand(brand):
    """Tier 2: harmonised label of that brand under another application number
    (a new formulation sharing the brand's label); tier 3: a label openFDA has
    not harmonised yet (no `openfda` block) — searched in the SPL product data."""
    term = brand_query_term(brand)
    if not term:
        return []
    for field in ('openfda.brand_name', 'spl_product_data_elements'):
        q = urllib.parse.urlencode({'search': f'{field}:"{term}"', 'limit': '10'})
        status, _, body = http(f'{LABEL_API}?{q}')
        recs = json.loads(body).get('results') or [] if status == 200 and body else []
        if recs:
            return recs
        time.sleep(0.3)
    return []


def reconcile_us(q, fe, today, window, probe, log):
    cands = us_candidates(fe, today, window)
    for key, c in cands.items():
        id_ = f'FDA:{key}'
        e = q.ensure(id_, jurisdiction='FDA', drug=c['drug'], inn=c.get('inn'), applicationNumber=c.get('applicationNumber'),
                     approvalDate=c['approvalDate'], sources=sorted(set(c['sources'])), summary=c.get('summary'),
                     sponsor=c.get('sponsor'), status=S_AWAITING_USPI)
        e.pop('alert', None)
    if not probe:
        return
    entries = [e for e in q.by_id.values() if e.get('jurisdiction') == 'FDA']
    # Every US entry is re-asked each run: pending ones to move forward, verified
    # ones to notice a revised label (version/effective date) or a vanished one.
    with_app = [e for e in entries if e.get('applicationNumber')]
    found = {}
    for i in range(0, len(with_app), APP_BATCH):
        batch = [e['applicationNumber'].upper() for e in with_app[i:i + APP_BATCH]]
        try:
            found.update(openfda_lookup_apps(batch))
        except Exception as ex:  # noqa: BLE001
            log(f'openFDA label query failed for {len(batch)} applications: {ex}')
            return
    for e in entries:
        app = (e.get('applicationNumber') or '').upper()
        recs = found.get(app, []) if app else []
        if not recs:
            try:
                recs = openfda_lookup_brand(e['drug'])
            except Exception as ex:  # noqa: BLE001
                log(f'openFDA brand lookup failed for {e["drug"]}: {ex}')
                continue
            time.sleep(0.3)
        apply_us_records(q, e, recs, today)


def apply_us_records(q, e, recs, today):
    best = None
    for rec in recs:
        ok, checks, text = validate_us_label(rec, e.get('applicationNumber'), e.get('drug'), e.get('inn'))
        if not checks['nameMatch']:
            continue                      # some other product that shares the search term
        # A label not linked to THIS application must be at least as new as the
        # approval (minus slack): an older label of the same name is another product.
        if checks['applicationMatch'] is not True and e.get('approvalDate'):
            eff = iso(rec.get('effective_time'))
            if eff and (days_between(eff, e['approvalDate']) or 0) > 60:
                continue
        # Prefer: valid > invalid, then a label linked to THIS application, then the newest version.
        cand = ((ok, checks['applicationMatch'] is True, rec.get('effective_time') or ''), rec, checks, text)
        if best is None or cand[0] > best[0]:
            best = cand
    if best is None:
        if e['status'] == S_VERIFIED:
            e['alert'] = 'openFDA no longer returns the verified label — check DailyMed'
        elif e['status'] == S_AVAILABLE:
            q.set_status(e, S_AWAITING_USPI, 'label record no longer returned by openFDA')
        return
    (ok, _, _), rec, checks, text = best
    of = rec.get('openfda') or {}
    e['checks'] = checks
    if not ok:
        q.set_status(e, S_AVAILABLE, 'label record found at openFDA but failed validation: '
                     + ', '.join(k for k, v in checks.items() if v is False))
        e['label'] = {'setId': rec.get('set_id'), 'effective': iso(rec.get('effective_time')), 'version': rec.get('version'),
                      'detected': (e.get('label') or {}).get('detected') or today,
                      'url': DAILYMED_URL.format(setid=rec.get('set_id')) if rec.get('set_id') else None}
        return
    new_sha = sha256(text)
    prev = e.get('label') or {}
    label = {
        'setId': rec.get('set_id'), 'splId': rec.get('id'), 'effective': iso(rec.get('effective_time')), 'version': rec.get('version'),
        'detected': prev.get('detected') or today, 'retrieved': today if prev.get('sha256') != new_sha else prev.get('retrieved', today),
        'url': DAILYMED_URL.format(setid=rec.get('set_id')) if rec.get('set_id') else None,
        'source': 'openFDA drug label (US Prescribing Information)',
        'usBrand': (of.get('brand_name') or [None])[0], 'usGeneric': (of.get('generic_name') or [None])[0],
        'applicationNumber': (of.get('application_number') or [None])[0],
        'harmonised': bool(of),           # False: openFDA has not yet linked this SPL to its application / brand fields
        'sha256': new_sha, 'indications': text[:INDICATION_CAP],
    }
    if not e.get('applicationNumber') and label['applicationNumber']:
        e['applicationNumber'] = label['applicationNumber']
    if checks.get('applicationMatch') is None and not of:
        label['note'] = 'label found in the SPL product data; openFDA has not yet linked it to the application number'
    elif checks.get('applicationMatch') is None and label['applicationNumber'] and e.get('applicationNumber') \
            and label['applicationNumber'].upper() != e['applicationNumber'].upper():
        label['note'] = f'label shared with application {label["applicationNumber"]} (same brand)'
    if e['status'] == S_VERIFIED and prev.get('sha256') and prev.get('sha256') != new_sha:
        e.setdefault('history', []).append({'date': today, 'status': S_VERIFIED, 'note': f'label revised (version {prev.get("version")} → {label["version"]})'})
        e['history'] = e['history'][-HISTORY_CAP:]
    e['label'] = label
    q.set_status(e, S_VERIFIED, f'USPI verified: set ID {label["setId"]}, label version {label["version"]} of {label["effective"]}')


# --------------------------------------------------------------------------- EU side
def smpc_extract_ok(fe, slug):
    """(ok, retrieved, url, sha, problems) for smpc-data/<slug>.json — 4.1 and 4.2 must be present.
    `sha` is the SHA-256 of the extract file, the same value copy-data.mjs writes into the
    published smpc-index.json, so the queue and the release manifest name the same bytes."""
    path = os.path.join(fe, 'smpc-data', f'{slug}.json')
    doc = read_json(path)
    if not doc:
        return False, None, None, None, ['no extract']
    with open(path, 'rb') as f:
        sha = hashlib.sha256(f.read()).hexdigest()
    secs = doc.get('sections') or {}
    problems = []
    for s in ('4.1', '4.2'):
        v = secs.get(s) or {}
        text = (v.get('text') or '').strip() if isinstance(v, dict) else ''
        if not text or (isinstance(v, dict) and v.get('missing')):
            problems.append(f'section {s} missing')
    return not problems, doc.get('retrieved'), doc.get('url'), sha, problems


def reconcile_eu(q, fe, today, window, probe, log):
    since = (dt.date.fromisoformat(today) - dt.timedelta(days=window)).isoformat()
    ema = read_json(os.path.join(fe, 'ema-medicines.json'), {}) or {}
    idx = read_json(os.path.join(fe, 'smpc-index.json'), {}) or {}
    idx_drugs = idx.get('drugs') or {}
    failed_last_run = set(idx.get('failed') or [])
    seen = set()

    for m in ema.get('pipeline') or []:
        if m.get('outcome') not in (None, 'positive') or not m.get('num'):
            continue
        id_ = f'EMA:{m["num"]}'
        seen.add(id_)
        e = q.ensure(id_, jurisdiction='EMA', drug=m.get('n'), inn=m.get('inn') or m.get('sub'), emaNumber=m['num'], slug=slug_of(m.get('url')),
                     emaUrl=m.get('url'), opinionDate=iso(m.get('op')), summary=m.get('ind'), holder=m.get('holder'), status=S_AWAITING_EC)
        e.pop('alert', None)

    for m in ema.get('authorised') or []:
        num = m.get('num')
        if not num:
            continue
        id_ = f'EMA:{num}'
        d = iso(m.get('d'))
        known = q.get(id_)
        if not known and (not d or d < since):
            continue
        seen.add(id_)
        slug = slug_of(m.get('url'))
        e = q.ensure(id_, jurisdiction='EMA', drug=m.get('n'), inn=m.get('inn') or m.get('sub'), emaNumber=num, slug=slug, emaUrl=m.get('url'),
                     opinionDate=iso(m.get('op')), decisionDate=d, holder=m.get('holder'),
                     decisionSource='EU Union Register' if m.get('ec') == 'register' else 'EMA medicines table',
                     status=S_AWAITING_SMPC)
        e.pop('alert', None)
        if e['status'] == S_AWAITING_EC:
            q.set_status(e, S_AWAITING_SMPC, f'authorised {d} ({e["decisionSource"]})')
        if not e.get('summary'):
            e['summary'] = m.get('ind')
        if m.get('indSrc') == 'smpc' and slug:
            ok, retrieved, url, sha, problems = smpc_extract_ok(fe, slug)
            if ok:
                sha = sha or (idx_drugs.get(slug) or {}).get('sha')
                prev = e.get('label') or {}
                if e['status'] == S_VERIFIED and prev.get('sha256') and sha and prev.get('sha256') != sha:
                    e.setdefault('history', []).append({'date': today, 'status': S_VERIFIED, 'note': f'SmPC extract revised (retrieved {retrieved})'})
                    e['history'] = e['history'][-HISTORY_CAP:]
                e['label'] = {'url': url or EMA_PI_URL.format(slug=slug), 'retrieved': retrieved or m.get('indRet'), 'detected': prev.get('detected') or retrieved or today,
                              'sha256': sha or prev.get('sha256'), 'source': 'EMA product information (Annex I, SmPC)', 'emaNumber': num}
                q.set_status(e, S_VERIFIED, f'SmPC extract verified (4.1 + 4.2), retrieved {e["label"]["retrieved"]}')
                continue
            q.set_status(e, S_AVAILABLE, 'SmPC extract incomplete: ' + ', '.join(problems))
            e['checks'] = {'smpc': problems}
            continue
        if e['status'] == S_VERIFIED:
            e['alert'] = 'EU record lost its SmPC wording (indSrc) — the extract may have been deleted'
            continue
        if slug in failed_last_run:
            e['note'] = 'weekly label refresh could not download the product information last run'
        elif e.get('note'):
            e.pop('note', None)
        if probe and slug:
            url = EMA_PI_URL.format(slug=slug)
            try:
                status, headers, _ = http(url, method='HEAD', tries=2, timeout=40)
            except Exception as ex:  # noqa: BLE001
                log(f'EMA HEAD failed for {slug}: {ex}')
                continue
            if status == 200:
                prev = e.get('label') or {}
                e['label'] = {'url': url, 'detected': prev.get('detected') or today, 'lastModified': headers.get('Last-Modified'),
                              'source': 'EMA product information (Annex I, SmPC)', 'emaNumber': num}
                q.set_status(e, S_AVAILABLE, 'product information published by EMA — awaiting the weekly label refresh')
            elif e['status'] == S_AVAILABLE and status == 404:
                q.set_status(e, S_AWAITING_SMPC, 'product-information PDF no longer found at EMA')
            time.sleep(0.5)

    gone_names = {g.get('num'): g for g in ema.get('gone') or [] if g.get('num')}
    for id_, e in list(q.by_id.items()):
        if e.get('jurisdiction') != 'EMA' or id_ in seen:
            continue
        num = e.get('emaNumber')
        if num in gone_names:
            q.drop(id_, f'no longer authorised / opinion outcome: {gone_names[num].get("st")}')
        elif e['status'] == S_AWAITING_EC:
            q.drop(id_, 'left the CHMP opinion list without an authorisation record')
        else:
            q.drop(id_, 'left the EMA catalogue')


# --------------------------------------------------------------------------- alerts, retention, report
def apply_alerts_and_retention(q, today, window, a):
    for id_, e in list(q.by_id.items()):
        st = e['status']
        since_date = e.get('statusSince') or e.get('firstSeen') or today
        if st == S_VERIFIED:
            ref = e.get('decisionDate') or e.get('approvalDate')
            if ref and (days_between(ref, today) or 0) > window:
                q.drop(id_, f'verified; approval older than {window} days — covered by the regular label corpus')
            continue
        if st == S_AWAITING_USPI:
            n = days_between(e.get('approvalDate') or since_date, today) or 0
            if n > a.us_pending_days:
                e['alert'] = f'no US prescribing information at openFDA {n} days after approval'
        elif st == S_AWAITING_SMPC:
            n = days_between(e.get('decisionDate') or since_date, today) or 0
            if n > a.eu_pending_days:
                e['alert'] = f'no SmPC extract {n} days after the EU authorisation'
        elif st == S_AVAILABLE:
            det = (e.get('label') or {}).get('detected') or since_date
            n = days_between(det, today) or 0
            if n > a.ingest_days:
                e['alert'] = f'official document detected {n} days ago but not ingested/validated'
        elif st == S_AWAITING_EC:
            n = days_between(e.get('opinionDate') or since_date, today) or 0
            if n > a.ec_decision_days:
                e['alert'] = f'no Commission decision {n} days after the CHMP opinion (legal period ≈67 days)'


def entry_sort_key(e):
    return (e.get('jurisdiction') or '', e.get('decisionDate') or e.get('approvalDate') or e.get('opinionDate') or '', e.get('drug') or '')


def build_output(q, today, window, a, probe):
    entries = sorted(q.by_id.values(), key=entry_sort_key, reverse=True)
    by_status = {s: sum(1 for e in entries if e['status'] == s) for s in STATUSES}
    alerts = [{'id': e['id'], 'drug': e.get('drug'), 'jurisdiction': e.get('jurisdiction'), 'status': e['status'], 'message': e['alert']}
              for e in entries if e.get('alert')]
    return {
        'generated': today,
        'checkedAt': dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'version': 1,
        'probe': probe,
        'windowDays': window,
        'thresholds': {'usPendingDays': a.us_pending_days, 'euPendingDays': a.eu_pending_days, 'ingestDays': a.ingest_days, 'ecDecisionDays': a.ec_decision_days},
        'summary': {
            'total': len(entries), 'unresolved': sum(by_status[s] for s in OPEN), 'byStatus': by_status, 'alerts': len(alerts),
            'transitions': [{'id': i, 'drug': d, 'from': f, 'to': t, 'note': n} for i, d, f, t, n in q.transitions],
            'closed': [{'id': i, 'drug': d, 'status': s, 'why': w} for i, d, s, w in q.closed],
        },
        'alerts': alerts,
        'entries': entries,
    }


def write_md(path, out, today):
    s = out['summary']
    L = [f'## Approval → label reconciliation ({today})', '']
    L.append(f'{s["total"]} medicines tracked · **{s["unresolved"]} unresolved** · {s["byStatus"][S_VERIFIED]} verified · '
             f'{"probed openFDA / EMA" if out["probe"] else "offline (state from files only)"}')
    L += ['', '| Status | Count | Meaning |', '|---|---:|---|']
    meaning = {
        S_AWAITING_USPI: 'FDA approval verified, prescribing information not yet at openFDA',
        S_AWAITING_EC: 'positive CHMP opinion, Commission decision pending',
        S_AWAITING_SMPC: 'EU authorisation, SmPC not yet published / extracted',
        S_AVAILABLE: 'official document detected, not yet ingested and validated',
        S_VERIFIED: 'official label ingested, validated and published',
    }
    for st in STATUSES:
        L.append(f'| {st} | {s["byStatus"][st]} | {meaning[st]} |')
    if out['alerts']:
        L += ['', f'### ⚠️ {len(out["alerts"])} alert(s)', '']
        for al in out['alerts']:
            L.append(f'- **{al["drug"]}** ({al["jurisdiction"]}, {al["status"]}): {al["message"]}')
    if s['transitions']:
        L += ['', '### Transitions this run', '']
        for t in s['transitions']:
            L.append(f'- {t["drug"]}: {t["from"] or "—"} → **{t["to"]}**' + (f' — {t["note"]}' if t.get('note') else ''))
    if s['closed']:
        L += ['', '### Left the queue', '']
        for c in s['closed']:
            L.append(f'- {c["drug"]} ({c["status"]}): {c["why"]}')
    open_entries = [e for e in out['entries'] if e['status'] != S_VERIFIED]
    if open_entries:
        L += ['', '### Unresolved hand-overs', '', '| Medicine | Jurisdiction | Event | Status | Since | Days | Note |', '|---|---|---|---|---|---:|---|']
        for e in open_entries:
            ev = e.get('decisionDate') and f'MA {e["decisionDate"]}' or e.get('approvalDate') and f'approved {e["approvalDate"]}' or e.get('opinionDate') and f'opinion {e["opinionDate"]}' or ''
            ref = e.get('decisionDate') or e.get('approvalDate') or e.get('opinionDate') or e.get('statusSince')
            days = days_between(ref, today) if ref else ''
            note = e.get('alert') or e.get('note') or ((e.get('label') or {}).get('detected') and f'document detected {e["label"]["detected"]}') or ''
            L.append(f'| {e["drug"]} | {e["jurisdiction"]} | {ev} | {e["status"]} | {e.get("statusSince", "")} | {days} | {note} |')
    recent = [e for e in out['entries'] if e['status'] == S_VERIFIED and (days_between(e.get('statusSince') or today, today) or 0) <= 14]
    if recent:
        L += ['', '### Verified in the last 14 days', '']
        for e in recent:
            lb = e.get('label') or {}
            ref = lb.get('setId') and f'DailyMed set ID {lb["setId"]}, version {lb.get("version")} of {lb.get("effective")}' or lb.get('url') or ''
            L.append(f'- {e["drug"]} ({e["jurisdiction"]}): verified {e.get("statusSince")} — {ref}')
    L.append('')
    with open(path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(L))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--frontend', default=FRONTEND)
    ap.add_argument('--json', default=None, help='write the queue here (default: frontend/pending-labels.json)')
    ap.add_argument('--previous', default=None, help='previous queue to carry state from (default: the --json path)')
    ap.add_argument('--md', default=None, help='write the Markdown report here')
    ap.add_argument('--probe', action='store_true', help='ask openFDA / EMA for the current documents')
    ap.add_argument('--window', type=int, default=180, help='days after approval a medicine is tracked')
    ap.add_argument('--us-pending-days', type=int, default=45)
    ap.add_argument('--eu-pending-days', type=int, default=30)
    ap.add_argument('--ingest-days', type=int, default=14)
    ap.add_argument('--ec-decision-days', type=int, default=120)
    ap.add_argument('--fail-on-alert', action='store_true')
    ap.add_argument('--today', default=today_iso())
    a = ap.parse_args()

    fe = a.frontend
    out_path = a.json or os.path.join(fe, 'pending-labels.json')
    prev_path = a.previous or out_path
    previous = read_json(prev_path, {}) if os.path.exists(prev_path) else {}
    logs = []
    log = lambda m: (logs.append(m), print('  ! ' + m, file=sys.stderr))  # noqa: E731

    q = Queue(previous, a.today)
    reconcile_us(q, fe, a.today, a.window, a.probe, log)
    reconcile_eu(q, fe, a.today, a.window, a.probe, log)
    apply_alerts_and_retention(q, a.today, a.window, a)
    out = build_output(q, a.today, a.window, a, a.probe)
    if logs:
        out['warnings'] = logs

    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write('\n')
    if a.md:
        write_md(a.md, out, a.today)

    s = out['summary']
    print(f'label-reconciliation: {s["total"]} tracked, {s["unresolved"]} unresolved, {s["byStatus"][S_VERIFIED]} verified, '
          f'{len(q.transitions)} transition(s), {len(q.closed)} closed, {s["alerts"]} alert(s) → {out_path}')
    for t in q.transitions:
        print(f'  {t[1]}: {t[2] or "—"} → {t[3]}' + (f' ({t[4]})' if t[4] else ''))
    for al in out['alerts']:
        print(f'::warning::Label hand-over unresolved — {al["drug"]} ({al["jurisdiction"]}, {al["status"]}): {al["message"]}')
    gh = os.environ.get('GITHUB_OUTPUT')
    if gh:
        with open(gh, 'a', encoding='utf-8') as f:
            f.write(f'alerts={s["alerts"]}\nunresolved={s["unresolved"]}\n')
    if a.fail_on_alert and out['alerts']:
        sys.exit(1)


if __name__ == '__main__':
    main()
