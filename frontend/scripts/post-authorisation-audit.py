#!/usr/bin/env python3
"""Post-authorisation audit — does every approved label change show up in our labels?

The label refresh asks the LABEL sources what changed (EMA's EPAR document list,
openFDA's current version of each set ID). This audit starts from the other end,
the REGULATORY EVENT, and checks that a label which ought to have changed has:

  EU  EMA's post-authorisation list (extensions of indication): a positive CHMP
      opinion is followed by an EC decision (legal limit 67 days) and then a new
      SmPC. For every such opinion on a medicine we hold an SmPC for, the audit
      states where the hand-over stands:
        PENDING_EC           inside the 67-day EC window — nothing to expect yet
        PENDING_PUBLICATION  EC window over, grace period for EMA's publication
        PENDING_INGEST       EMA published a newer product information within the last
                             --eu-ingest-days; the next weekly refresh takes it
        VERIFIED             EMA's product information is dated after the opinion and ours is
                             at least that new (or our 4.1 text moved)
        BEHIND_EMA           EMA's current product information is newer than ours
        OVERDUE              neither EMA's product information nor ours is newer than
                             the opinion, long after the EC window — an EC decision
                             or EMA publication to look at, which the label drift
                             report (it only compares with EMA's own list) cannot see
        UNVERIFIABLE         EMA's date unknown and our SmPC carries no EMA-side date
        NO_SMPC              a medicine without an SmPC extract (the approval → label
                             queue / drift report own that)
  US  Drugs@FDA submissions: an approved EFFICACY supplement (new indication,
      population, dosage) or LABELING supplement on an application whose label we
      hold. The label's effective date must not be older than the supplement.
        PENDING        approved less than --us-pending-days ago
        VERIFIED       label effective on/after the supplement
        LABEL_OLDER    approved long ago, label still older — review
      Only EFFICACY supplements raise an alert; LABELING supplements are counted
      (many only touch administrative text, and sponsors date SPLs loosely).

Section hashes (SHA-256 of whitespace-normalised text) of the clinically important
sections — EU 4.1-4.4, US indications / dosage / contraindications / boxed warning /
warnings — are recorded per event; with --previous the first-seen hashes are carried
so a later run can see that 4.1 / Indications moved (TEXT_CHANGED counts as VERIFIED).

REPORT ONLY: never changes a label or the app, never stops a run (--fail-on-alert
is opt-in). Output: --json (events + hashes), --md (run summary), ::warning::
annotations and `alerts=N` in $GITHUB_OUTPUT.

An EMA positive opinion is NOT an EC decision; the audit never treats it as one.
Only python3 stdlib. Usage:
  python3 frontend/scripts/post-authorisation-audit.py --md /tmp/post-auth.md --json /tmp/post-auth.json
"""
import argparse
import hashlib
import json
import os
import re
import sys
import time
import urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path

FRONTEND = Path(__file__).resolve().parent.parent
EMA_POSTAUTH_URL = 'https://www.ema.europa.eu/en/documents/report/medicines-output-post_authorisation_json-report_en.json'
EMA_EPAR_URL = 'https://www.ema.europa.eu/en/documents/report/documents-output-epar_documents_json-report_en.json'
OPENFDA = 'https://api.fda.gov/drug/drugsfda.json'
UA = {'User-Agent': 'Mozilla/5.0 (DrugRadar post-authorisation audit)'}
EU_SECTIONS = ['4.1', '4.2', '4.3', '4.4']
US_SECTIONS = ['indications', 'dosage', 'contraindications', 'boxed_warning', 'warnings']
EC_WINDOW_DAYS = 67          # Regulation 726/2004: EC decision within 67 days of the opinion
PDF_SLUG = re.compile(r'/en/documents/product-information/(.+?)(?:-epar)?-product-information_en\.pdf$')


def fetch(url, tries=3, timeout=120):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
                return r.read()
        except Exception:  # noqa: BLE001
            if i == tries - 1:
                raise
            time.sleep(3 * (i + 1))


def dmy(s):
    """EMA dates are dd/mm/yyyy."""
    try:
        return datetime.strptime(str(s).strip(), '%d/%m/%Y').date()
    except ValueError:
        return None


def ymd(s):
    s = str(s or '').strip()
    for fmt in ('%Y-%m-%d', '%Y%m%d'):
        try:
            return datetime.strptime(s[:10] if fmt == '%Y-%m-%d' else s[:8], fmt).date()
        except ValueError:
            pass
    return None


def section_text(v):
    if v is None:
        return ''
    if isinstance(v, str):
        return v
    if isinstance(v, dict):
        return '' if v.get('missing') else str(v.get('text') or '')
    return str(v)


def sha(v):
    txt = re.sub(r'\s+', ' ', section_text(v)).strip()
    return hashlib.sha256(txt.encode('utf-8')).hexdigest()[:16] if txt else ''


def hashes(doc, keys):
    secs = doc.get('sections') or {}
    return {k: sha(secs.get(k)) for k in keys if sha(secs.get(k))}


def load_json(path, default=None):
    try:
        return json.loads(Path(path).read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return default


def slug_of(m):
    tail = (m.get('url') or '').split('/EPAR/')[1:]
    return re.sub(r'-previously-.*$', '', tail[0].strip()) if tail else ''


# ------------------------------------------------------------------ EU
def epar_dates(path, no_epar):
    """EMA product number (first four segments) -> newest product-information last_updated_date."""
    if no_epar:
        return None
    try:
        if path and Path(path).exists():
            body = Path(path).read_bytes()
        else:
            body = fetch(EMA_EPAR_URL, timeout=300)
        j = json.loads(body)
        rows = j if isinstance(j, list) else j.get('data')
        out = {}
        for r in rows:
            if r.get('type') != 'product-information' or not r.get('last_updated_date'):
                continue
            if not PDF_SLUG.search(str(r.get('document_url') or '')):
                continue
            num = '/'.join(x.strip() for x in str(r.get('ema_product_number') or '').split('/')[:4]).upper()
            d = ymd(r['last_updated_date'])
            if num and d and (num not in out or d > out[num]):
                out[num] = d
        return out if len(out) > 1000 else None      # implausible list → do not judge by it
    except Exception as e:  # noqa: BLE001
        print(f'::notice::EMA EPAR document list unavailable ({e}) — EU events judged on our label date only')
        return None


def eu_events(a, today, prev):
    try:
        feed = json.loads(Path(a.ema_feed).read_bytes() if a.ema_feed else fetch(EMA_POSTAUTH_URL, timeout=300))
    except Exception as e:  # noqa: BLE001
        return None, f'EMA post-authorisation list unavailable: {e}'
    rows = feed.get('data') if isinstance(feed, dict) else feed
    if not isinstance(rows, list) or len(rows) < 5:
        return None, 'EMA post-authorisation list unreadable or implausibly small'
    stamp = (feed.get('meta') or {}).get('timestamp') if isinstance(feed, dict) else None

    meds = load_json(FRONTEND / 'ema-medicines.json', {}).get('authorised', [])
    by_num = {m.get('num'): m for m in meds if m.get('num')}
    epar = epar_dates(a.epar_file, a.no_epar)
    events = []
    since = today - timedelta(days=a.window)
    for r in rows:
        if r.get('category') != 'Human' or r.get('post_authorisation_procedure_status') != 'Opinion':
            continue
        if (r.get('post_authorisation_opinion_status') or '').lower() != 'positive':
            continue
        d = dmy(r.get('post_authorisation_opinion_date'))
        if not d or d < since:
            continue
        num = '/'.join(x.strip() for x in str(r.get('ema_product_number') or '').split('/')[:4]).upper()
        ev = {'agency': 'EMA', 'kind': 'extension of indication (positive CHMP opinion)', 'product': r.get('name_of_medicine'),
              'productId': num, 'opinionDate': d.isoformat(), 'daysSinceOpinion': (today - d).days,
              'listUpdated': (dmy(r.get('last_updated_date')) or date.min).isoformat()}
        m = by_num.get(num)
        slug = slug_of(m) if m else ''
        doc = load_json(FRONTEND / 'smpc-data' / f'{slug}.json') if slug else None
        if not m or not doc:
            ev['status'] = 'NO_SMPC'
            ev['note'] = 'not an authorised medicine in the app' if not m else 'authorised, no SmPC extract'
            events.append(ev)
            continue
        # Our SmPC's date on EMA's clock. The download date ('retrieved') is NOT evidence:
        # a fresh download of an unchanged, pre-opinion SmPC once passed as verified
        # (Palynziq, 21.10.2026: opinion 21.5.2026, EMA product information of 12.7.2024).
        label = ymd(doc.get('emaUpdated')) or ymd(doc.get('sourceModified'))
        got = ymd(doc.get('retrieved'))
        ema_pi = (epar or {}).get(num) if epar else None
        key = f'EMA:{num}:{d.isoformat()}'
        cur = hashes(doc, EU_SECTIONS)
        base = ((prev.get(key) or {}).get('baselineHashes')) or cur
        ev.update({'slug': slug, 'ourLabelDate': label.isoformat() if label else None, 'ourDownload': got.isoformat() if got else None,
                   'emaProductInfoDate': ema_pi.isoformat() if ema_pi else None,
                   'baselineHashes': base, 'currentHashes': cur, 'text41Changed': bool(base.get('4.1') and cur.get('4.1') != base.get('4.1'))})
        days = ev['daysSinceOpinion']
        if ema_pi:
            # EMA's own product-information date decides whether a new SmPC exists;
            # ours is current when it is at least that new (downloaded after it counts).
            have = max([x for x in (label, got) if x] or [date.min])
            if ema_pi >= d:
                if have >= ema_pi or ev['text41Changed']:
                    ev['status'] = 'VERIFIED' if days > EC_WINDOW_DAYS or ev['text41Changed'] else 'PENDING_EC'
                else:
                    behind = (today - ema_pi).days
                    ev['note'] = f'EMA product information dated {ema_pi}, ours {label or got}'
                    if behind <= a.eu_ingest_days:
                        ev['status'] = 'PENDING_INGEST'  # EMA published recently — the Monday refresh picks it up
                    else:
                        ev['status'] = 'BEHIND_EMA'
                        ev['note'] += f' ({behind} days)'
            elif days <= EC_WINDOW_DAYS:
                ev['status'] = 'PENDING_EC'
            elif days <= EC_WINDOW_DAYS + a.eu_publication_days:
                ev['status'] = 'PENDING_PUBLICATION'
            else:
                ev['status'] = 'OVERDUE'
                ev['note'] = (f'opinion {days} days ago; EMA product information still {ema_pi} (before the opinion) — '
                              'check the EC decision / EMA publication')
        else:
            # EMA's date unknown (list unavailable or product not in it): only our label's
            # own EMA-side date can verify; a download date alone cannot.
            if ev['text41Changed'] or (label and label >= d and days > EC_WINDOW_DAYS):
                ev['status'] = 'VERIFIED'
            elif days <= EC_WINDOW_DAYS:
                ev['status'] = 'PENDING_EC'
            elif days <= EC_WINDOW_DAYS + a.eu_publication_days:
                ev['status'] = 'PENDING_PUBLICATION'
            else:
                ev['status'] = 'UNVERIFIABLE'
                ev['note'] = (f'opinion {days} days ago; EMA product-information date unknown, our SmPC '
                              f'{label or "carries no EMA date (downloaded " + str(got) + ")"} — check by hand')
        events.append(ev)
    return {'events': events, 'listTimestamp': stamp, 'eparList': bool(epar)}, None


# ------------------------------------------------------------------ US
def us_labels():
    out = {}
    for f in sorted((FRONTEND / 'uspi-data').glob('*.json')):
        d = load_json(f)
        app = (d or {}).get('usApplication')
        if d and app:
            out.setdefault(app.upper(), []).append((f.stem, d))
    return out


def probe_us(set_id):
    """openFDA's current version of one set ID (effective date, version)."""
    try:
        r = json.loads(fetch(f'https://api.fda.gov/drug/label.json?search=set_id:"{set_id}"&limit=1', tries=2, timeout=30))['results'][0]
        return {'effective': r.get('effective_time'), 'version': r.get('version'),
                'labeler': ((r.get('openfda') or {}).get('manufacturer_name') or [None])[0]}
    except Exception as e:  # noqa: BLE001
        return {'error': str(e)[:80]}


def us_events(a, today, prev):
    labels = us_labels()
    since = today - timedelta(days=a.window)
    search = f'submissions.submission_status_date:[{since.strftime("%Y%m%d")}+TO+{(today + timedelta(days=7)).strftime("%Y%m%d")}]'
    records, skip, total, last_updated = [], 0, None, None
    try:
        while total is None or skip < total:
            d = json.loads(fetch(f'{OPENFDA}?search={search}&limit=1000&skip={skip}'))
            total = d['meta']['results']['total']
            last_updated = d['meta'].get('last_updated')
            records += d.get('results', [])
            skip += 1000
            if skip >= 25000:
                break
    except Exception as e:  # noqa: BLE001
        return None, f'Drugs@FDA unavailable: {e}'
    if total is None or len(records) < total:
        return None, f'Drugs@FDA incomplete ({len(records)} of {total})'
    events = []
    for r in records:
        app = (r.get('application_number') or '').upper()
        if app not in labels:
            continue
        subs = [s for s in r.get('submissions') or []
                if s.get('submission_type') == 'SUPPL' and s.get('submission_status') == 'AP'
                and (s.get('submission_class_code') or '').upper() in ('EFFICACY', 'LABELING')
                and ymd(s.get('submission_status_date')) and ymd(s['submission_status_date']) >= since]
        if not subs:
            continue
        for cls in ('EFFICACY', 'LABELING'):
            cs = [s for s in subs if (s.get('submission_class_code') or '').upper() == cls]
            if not cs:
                continue
            newest = max(cs, key=lambda s: s['submission_status_date'])
            d = ymd(newest['submission_status_date'])
            slug, doc = max(labels[app], key=lambda x: x[1].get('effective') or '')
            eff = ymd(doc.get('effective'))
            key = f'FDA:{app}:{cls}'
            cur = hashes(doc, US_SECTIONS)
            base = ((prev.get(key) or {}).get('baselineHashes')) or cur
            days = (today - d).days
            ev = {'agency': 'FDA', 'kind': f'{cls.lower()} supplement approved', 'product': doc.get('brand') or slug,
                  'productId': app, 'supplementNumber': newest.get('submission_number'), 'supplementDate': d.isoformat(),
                  'supplements': len(cs), 'daysSinceApproval': days, 'slug': slug, 'splSetId': doc.get('splSetId'),
                  'ourLabelEffective': eff.isoformat() if eff else None, 'baselineHashes': base, 'currentHashes': cur,
                  'textIndicationsChanged': bool(base.get('indications') and cur.get('indications') != base.get('indications'))}
            if ev['textIndicationsChanged'] or (eff and eff >= d - timedelta(days=a.us_slack_days)):
                ev['status'] = 'VERIFIED'
            elif days <= a.us_pending_days:
                ev['status'] = 'PENDING'
            else:
                ev['status'] = 'LABEL_OLDER'
                ev['note'] = f'{cls.lower()} supplement approved {d}, our label effective {eff or "date unknown"}'
                if cls == 'EFFICACY' and not a.no_probe and doc.get('splSetId'):
                    ev['openfdaCurrent'] = probe_us(doc['splSetId'])
                    cur_eff = ymd(ev['openfdaCurrent'].get('effective'))
                    if cur_eff and eff and cur_eff > eff:
                        ev['note'] += f'; openFDA already holds version {ev["openfdaCurrent"].get("version")} of {cur_eff} — OUR ingest is behind'
                    elif cur_eff:
                        who = ev['openfdaCurrent'].get('labeler') or doc.get('usLabeler') or 'unknown labeler'
                        ev['note'] += (f'; openFDA holds no newer version of this label ({who}, {cur_eff}) — a repackager copy, '
                                       "the manufacturer's label not yet updated, or the supplement sits on another label of the application")
            events.append(ev)
    return {'events': events, 'openfdaLastUpdated': last_updated, 'records': len(records)}, None


# ------------------------------------------------------------------ report
def alert_events(events):
    out = []
    for e in events:
        if e['agency'] == 'EMA' and e['status'] in ('OVERDUE', 'BEHIND_EMA', 'UNVERIFIABLE'):
            out.append(e)
        elif e['agency'] == 'FDA' and e['status'] == 'LABEL_OLDER' and 'efficacy' in e['kind']:
            out.append(e)
    return out


def count(events, agency, status):
    return sum(1 for e in events if e['agency'] == agency and e['status'] == status)


def markdown(doc):
    s, ev = doc['summary'], doc['events']
    L = [f'## Post-authorisation audit — {doc["generated"]} (report only)', '']
    for agency, label, statuses in (('EMA', 'EU — positive CHMP opinions (extension of indication)', ['PENDING_EC', 'PENDING_PUBLICATION', 'PENDING_INGEST', 'VERIFIED', 'BEHIND_EMA', 'OVERDUE', 'UNVERIFIABLE', 'NO_SMPC']),
                                    ('FDA', 'US — approved supplements on stored labels', ['PENDING', 'VERIFIED', 'LABEL_OLDER'])):
        src = doc['sources'].get(agency.lower(), {})
        if src.get('error'):
            L += [f'**{label}:** not audited — {src["error"]}', '']
            continue
        L += [f'**{label}** ({sum(1 for e in ev if e["agency"] == agency)} events)', '', '| status | events |', '|---|---:|']
        L += [f'| {st} | {count(ev, agency, st)} |' for st in statuses]
        L.append('')
    L += [f'**Result: {"REVIEW REQUIRED — " + str(s["alerts"]) + " item(s)" if s["alerts"] else "no unexplained discrepancy"}**', '']
    if s['alerts']:
        L += ['| agency | product | event | detail |', '|---|---|---|---|']
        for e in alert_events(ev):
            L.append(f'| {e["agency"]} | {e["product"]} | {e["kind"]} {e.get("opinionDate") or e.get("supplementDate")} | {e["status"]}: {e.get("note", "")} |')
        L.append('')
    L.append('_An EMA positive opinion is not an EC decision. PENDING_* and LABELING-only differences are informational. '
             'Verification here compares dates and section hashes; it does not prove clinical equivalence of the text._')
    return '\n'.join(L) + '\n'


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--json', default=None, help='write events + hashes here')
    ap.add_argument('--previous', default=None, help='earlier --json file to carry first-seen section hashes from')
    ap.add_argument('--md', default=None)
    ap.add_argument('--window', type=int, default=240, help='days of events considered')
    ap.add_argument('--eu-publication-days', type=int, default=14, help='grace after the 67-day EC window for EMA to publish')
    ap.add_argument('--eu-ingest-days', type=int, default=14, help='EMA published less than this ago = ingest latency, not an alert (as the drift report)')
    ap.add_argument('--us-pending-days', type=int, default=45)
    ap.add_argument('--no-probe', action='store_true', help='do not ask openFDA for the current version of flagged US set IDs')
    ap.add_argument('--us-slack-days', type=int, default=14, help='SPL effective dates can precede approval a little')
    ap.add_argument('--ema-feed', default=None, help='local copy of the EMA post-authorisation list')
    ap.add_argument('--epar-file', default=None, help='local copy of the EMA EPAR document list')
    ap.add_argument('--no-epar', action='store_true', help='skip the 28 MB EPAR list (judge on our label date only)')
    ap.add_argument('--skip-us', action='store_true')
    ap.add_argument('--skip-eu', action='store_true')
    ap.add_argument('--fail-on-alert', action='store_true')
    ap.add_argument('--today', default=date.today().isoformat())
    a = ap.parse_args()
    today = date.fromisoformat(a.today)
    prev_doc = load_json(a.previous or '', {}) or {}
    prev = {e['key']: e for e in prev_doc.get('events', []) if e.get('key')}

    events, sources = [], {}
    for agency, fn, skip in (('eu', eu_events, a.skip_eu), ('us', us_events, a.skip_us)):
        if skip:
            sources[agency] = {'error': 'skipped'}
            continue
        res, err = fn(a, today, prev)
        if err:
            sources[agency] = {'error': err}
            print(f'::warning::Post-authorisation audit — {agency.upper()} not audited: {err}')
            continue
        sources[agency] = {k: v for k, v in res.items() if k != 'events'}
        events += res['events']

    for e in events:
        e['key'] = (f'EMA:{e["productId"]}:{e["opinionDate"]}' if e['agency'] == 'EMA'
                    else f'FDA:{e["productId"]}:{e["kind"].split()[0].upper()}')
    alerts = alert_events(events)
    doc = {'generated': today.isoformat(), 'windowDays': a.window, 'sources': sources,
           'summary': {'events': len(events), 'alerts': len(alerts)}, 'events': events}
    if a.json:
        Path(a.json).write_text(json.dumps(doc, indent=1, ensure_ascii=False) + '\n', encoding='utf-8')
    md = markdown(doc)
    if a.md:
        Path(a.md).write_text(md, encoding='utf-8')
    print(md)
    for e in alerts:
        print(f'::warning::Post-authorisation audit — {e["product"]} ({e["agency"]}, {e["status"]}): {e.get("note", "")}')
    gh = os.environ.get('GITHUB_OUTPUT')
    if gh:
        with open(gh, 'a', encoding='utf-8') as f:
            f.write(f'alerts={len(alerts)}\nevents={len(events)}\n')
    if a.fail_on_alert and alerts:
        sys.exit(1)


if __name__ == '__main__':
    main()
