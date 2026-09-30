#!/usr/bin/env python3
"""Build us-recent.json — the US tab's "Recent Approvals" list.

Why a build-time list: openFDA cannot answer "which products were FIRST approved
recently" in one query. Its search matches each condition against ANY submission
of an application, and its sort key is the date of ANY submission — so the old
live query (ORIG + AP, sorted by submission date) listed decades-old drugs whose
latest labeling supplement was recent (Verzenio 2017, Meloxicam 2006 …). It also
required openfda.pharm_class_epc, which openFDA fills in weeks after approval, so
the newest drugs were missing altogether.

Here every Drugs@FDA application with any submission inside the window is
downloaded (a few thousand records, a handful of requests), and the ORIGINAL
approval date is read per application.

Kept: NDA / BLA applications with a prescription product whose original
application (ORIG, status AP) was approved inside the window. Dropped: ANDA
generics, OTC-only products, medical gases, and NDA chemistry type 5
(new formulation or new manufacturer of an existing drug — e.g. a sodium
bicarbonate injection from another company).

Output (frontend/us-recent.json):
  { "generated": "YYYY-MM-DD", "windowDays": int,
    "source": { "url", "openfdaLastUpdated", "records", "sha256", "retrievedAt" },
    "items": [ { "orig": "YYYYMMDD", "cls": str, <trimmed Drugs@FDA record> } ] }
newest first. Refuses to write when the result looks broken (too few items,
newest approval implausibly old), so the previous file stays in place.

Only python3 stdlib. Usage: build-us-recent.py [outfile]
"""
import hashlib
import json
import sys
import time
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

WINDOW_DAYS = 365
MAX_ITEMS = 150
MIN_ITEMS = 20          # a normal year has ~100; fewer means a broken download
MAX_NEWEST_AGE = 45     # days — FDA approves new NDAs/BLAs every few weeks
API = 'https://api.fda.gov/drug/drugsfda.json'
PAGE = 1000


def fetch(url, tries=3):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'DrugRadar-refresh'}), timeout=60) as r:
                return r.read()
        except Exception:  # noqa: BLE001
            if i == tries - 1:
                raise
            time.sleep(3 * (i + 1))


def main():
    out = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / 'us-recent.json')
    today = date.today()
    since = (today - timedelta(days=WINDOW_DAYS)).strftime('%Y%m%d')
    search = f'submissions.submission_status_date:[{since}+TO+{(today + timedelta(days=7)).strftime("%Y%m%d")}]'

    records, raw_hash, skip, total, last_updated = [], hashlib.sha256(), 0, None, None
    while total is None or skip < total:
        url = f'{API}?search={search}&limit={PAGE}&skip={skip}'
        body = fetch(url)
        raw_hash.update(body)
        d = json.loads(body)
        total = d['meta']['results']['total']
        last_updated = d['meta'].get('last_updated')
        records += d.get('results', [])
        skip += PAGE
        if skip >= 25000:  # openFDA's skip ceiling — far above a year's volume
            break
    if len(records) < total:
        sys.exit(f'build-us-recent: got {len(records)} of {total} records — incomplete download, keeping the old file')

    by_app = {}
    for r in records:
        app = r.get('application_number', '')
        if not app.startswith(('NDA', 'BLA')):
            continue
        products = r.get('products') or []
        if not any(p.get('marketing_status') == 'Prescription' for p in products):
            continue
        if products and all((p.get('dosage_form') or '').upper() == 'GAS' for p in products):
            continue
        origs = [s for s in r.get('submissions') or []
                 if s.get('submission_type') == 'ORIG' and s.get('submission_status') == 'AP' and s.get('submission_status_date')]
        if not origs:
            continue
        first = min(origs, key=lambda s: s['submission_status_date'])  # the approval, not a later ORIG re-listing
        if first['submission_status_date'] < since:
            continue
        cls = (first.get('submission_class_code') or '').upper()
        if app.startswith('NDA') and cls == 'TYPE 5':
            continue
        of = r.get('openfda') or {}
        by_app[app] = {
            'orig': first['submission_status_date'],
            'cls': cls,
            'application_number': app,
            'sponsor_name': r.get('sponsor_name'),
            # mapResult() reads ORIG (approval date) and BIOSIMILAR class codes
            'submissions': [{k: s.get(k) for k in ('submission_type', 'submission_status', 'submission_status_date', 'submission_class_code')}
                            for s in r.get('submissions') or []
                            if s.get('submission_type') == 'ORIG' or (s.get('submission_class_code') or '').upper() == 'BIOSIMILAR'],
            'products': [{k: p.get(k) for k in ('brand_name', 'reference_drug', 'dosage_form', 'route', 'marketing_status')}
                         | {'active_ingredients': [{'name': a.get('name')} for a in p.get('active_ingredients') or []]}
                         for p in products[:3]],
            'openfda': {k: of[k][:2] for k in ('generic_name', 'brand_name', 'substance_name', 'pharm_class_epc', 'pharm_class_moa', 'manufacturer_name') if of.get(k)},
        }

    items = sorted(by_app.values(), key=lambda x: (x['orig'], x['application_number']), reverse=True)[:MAX_ITEMS]
    if len(items) < MIN_ITEMS:
        sys.exit(f'build-us-recent: only {len(items)} approvals in {WINDOW_DAYS} days — implausible, keeping the old file')
    newest_age = (today - datetime.strptime(items[0]['orig'], '%Y%m%d').date()).days
    if newest_age > MAX_NEWEST_AGE:
        sys.exit(f'build-us-recent: newest approval is {newest_age} days old — openFDA looks stale, keeping the old file')

    doc = {
        'generated': today.isoformat(),
        'windowDays': WINDOW_DAYS,
        'source': {
            'url': f'{API}?search={search}',
            'openfdaLastUpdated': last_updated,
            'records': len(records),
            'sha256': raw_hash.hexdigest(),
            'retrievedAt': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        },
        'items': items,
    }
    out.write_text(json.dumps(doc, separators=(',', ':')), encoding='utf-8')
    print(f'build-us-recent: {len(items)} original NDA/BLA approvals since {since} '
          f'(newest {items[0]["orig"]} {items[0]["products"][0].get("brand_name") if items[0]["products"] else ""}), '
          f'openFDA data of {last_updated} -> {out}')


if __name__ == '__main__':
    main()
