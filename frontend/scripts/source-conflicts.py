#!/usr/bin/env python3
"""Cross-source conflict report: where do our upstream sources disagree about
the SAME medicine? Report only — never stops a run, changes no snapshot.

The release gates (validate-release.py) check our files against the previous
release, the freshness watchdog checks each source against its own clock, the
post-authorisation audit checks events against labels. None of them puts two
sources side by side for one medicine. This script does, offline, from the
snapshots in frontend/:

  us_approval_date   Drugs@FDA original approval (us-recent.json) vs CDER's novel
                     roster (novel-approvals.json) vs CBER's list (cgt-products.json)
                     for the same brand: more than one day apart.
  us_inn             the same brand with a different active ingredient at
                     Drugs@FDA and on the CDER roster (salts and 'and' ignored).
  us_announcement    an FDA announcement / press mirror (announcements.json)
                     dated BEFORE the Drugs@FDA approval date it reports.
  us_label_date      the US label we hold for a recent application is dated
                     before that application's original approval
                     (uspi-index.json + uspi-data/<slug>.json → effective).
  eu_decision_date   EMA's authorisation date (ema-medicines.json → d) vs the
                     Commission's decision date in the Union Register
                     (eu-register-decisions.json, joined on the product number).
  eu_opinion_order   a recent EMA record whose CHMP opinion date is after its
                     authorisation date (EMA keeps only the latest opinion, so
                     older products are not compared).
  queue_vs_source    an approval date the label queue (pending-labels.json)
                     recorded when the medicine first appeared that the source
                     has since changed.
  eu_indication      INFO only: EU records whose SmPC and EMA table disagree on
                     the indication wording (indT) — resolved in favour of the SmPC
                     by build-ema-data.py, counted here so the number is visible.

Each finding names both sources and both values; `severity` is "conflict" (two
sources contradict each other) or "note" (odd but explainable). Exit code is 0
unless --fail-on-conflict. Run:

  python3 frontend/scripts/source-conflicts.py --md /tmp/conflicts.md
"""
import argparse
import importlib.util
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def _load_reconciliation():
    spec = importlib.util.spec_from_file_location('label_reconciliation', os.path.join(HERE, 'label-reconciliation.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


lr = _load_reconciliation()
iso, norm, inn_key, days_between, read_json, title = lr.iso, lr.norm, lr.inn_key, lr.days_between, lr.read_json, lr.title

CHECKS = ('us_approval_date', 'us_inn', 'us_announcement', 'us_label_date',
          'eu_decision_date', 'eu_opinion_order', 'queue_vs_source', 'eu_indication')


def finding(check, drug, a_source, a_value, b_source, b_value, note='', severity='conflict', **extra):
    f = {'check': check, 'severity': severity, 'drug': drug,
         'a': {'source': a_source, 'value': a_value}, 'b': {'source': b_source, 'value': b_value}}
    if note:
        f['note'] = note
    f.update(extra)
    return f


# --------------------------------------------------------------------------- US
def drugsfda_by_brand(us_recent, since):
    """{norm brand: {'drug','inn','approvalDate','application'}} from Drugs@FDA's recent list."""
    out = {}
    for it in us_recent.get('items') or []:
        d = iso(it.get('orig'))
        if not d or d < since:
            continue
        prods = it.get('products') or []
        brand = next((p.get('brand_name') for p in prods if p.get('brand_name')), None) \
            or (it.get('openfda') or {}).get('brand_name', [None])[0]
        if not brand:
            continue
        inn = ', '.join(a.get('name') for p in prods[:1] for a in (p.get('active_ingredients') or []) if a.get('name'))
        out.setdefault(norm(brand), {'drug': title(brand), 'inn': inn.lower() or None, 'approvalDate': d,
                                     'application': it.get('application_number')})
    return out


def check_us(us_recent, novel, cgt, announcements, since):
    fda = drugsfda_by_brand(us_recent, since)
    out = []
    for rows in (novel or {}).values():
        for n in rows or []:
            d = iso(n.get('approvalDate'))
            if not d or d < since or not n.get('brandName'):
                continue
            f = fda.get(norm(n['brandName']))
            if not f:
                continue
            gap = days_between(f['approvalDate'], d)
            if gap is not None and abs(gap) > 1:
                out.append(finding('us_approval_date', n['brandName'], 'Drugs@FDA', f['approvalDate'], 'CDER novel roster', d,
                                   f'{abs(gap)} days apart', application=f.get('application')))
            kf, kn = inn_key(f.get('inn')), inn_key(n.get('genericName'))
            if kf and kn and kf != kn:
                out.append(finding('us_inn', n['brandName'], 'Drugs@FDA', f.get('inn'), 'CDER novel roster', n.get('genericName'),
                                   'same brand, different active ingredient', application=f.get('application')))
    for bla, r in (cgt or {}).items():
        d = iso(r.get('d'))
        if not d or d < since or not r.get('n'):
            continue
        f = fda.get(norm(r['n']))
        if not f:
            continue
        gap = days_between(f['approvalDate'], d)
        if gap is not None and abs(gap) > 1:
            out.append(finding('us_approval_date', r['n'], 'Drugs@FDA', f['approvalDate'], 'CBER list', d,
                               f'{abs(gap)} days apart', application=bla))
    for a in (announcements or {}).get('items') or []:
        ad = iso(a.get('date'))
        if not ad or ad < since:
            continue
        for name in a.get('names') or []:
            f = fda.get(norm(name))
            if f and ad < f['approvalDate'] and (days_between(ad, f['approvalDate']) or 0) > 1:
                out.append(finding('us_announcement', f['drug'], a.get('source') or 'announcement', ad, 'Drugs@FDA', f['approvalDate'],
                                   'announced before the recorded approval date', application=f.get('application'), url=a.get('url')))
                break
    return out, fda


def check_us_labels(fda, uspi_index, uspi_dir):
    """A stored US label dated before the original approval of a recent application."""
    out = []
    by_app = {f['application']: f for f in fda.values() if f.get('application')}
    for slug, meta in (uspi_index.get('drugs') or {}).items():
        rec = read_json(os.path.join(uspi_dir, f'{slug}.json'), None) or {}
        app = (rec.get('usApplication') or '').upper()
        f = by_app.get(app)
        if not f:
            continue
        eff = iso(rec.get('effective'))
        if eff and eff < f['approvalDate']:
            lead = days_between(eff, f['approvalDate']) or 0
            out.append(finding('us_label_date', f['drug'], 'stored US label (effective)', eff, 'Drugs@FDA approval', f['approvalDate'],
                               f'label of {rec.get("usBrand") or meta.get("brand")} dated {lead} days before the application\'s approval'
                               + (' — manufacturers date the SPL before the approval letter' if lead <= LABEL_LEAD_NOTE_DAYS
                                  else ' — another product under this application or an older set'),
                               severity='note' if lead <= LABEL_LEAD_NOTE_DAYS else 'conflict',
                               application=app, slug=slug, setId=rec.get('splSetId')))
    return out


# --------------------------------------------------------------------------- EU
LABEL_LEAD_NOTE_DAYS = 30     # an SPL dated up to this long before the approval letter is routine


def check_eu(ema, register, since):
    out = []
    decisions = (register or {}).get('decisions') or {}
    for r in ema.get('authorised') or []:
        num = (r.get('num') or '').strip()
        d, op = iso(r.get('d')), iso(r.get('op'))
        if not d or d < since:
            continue                                            # EMA keeps only the LATEST opinion per product
        reg = decisions.get(num)
        if reg and d and iso(reg.get('d')) and iso(reg['d']) != d:
            gap = abs(days_between(d, iso(reg['d'])) or 0)
            out.append(finding('eu_decision_date', r.get('n'), 'EMA table', d, 'Union Register', iso(reg['d']),
                               f'{gap} day(s) apart' + (' (authorised via the register)' if r.get('ec') == 'register' else ''),
                               severity='conflict' if gap > 1 else 'note', num=num))
        if d and op and op > d:
            out.append(finding('eu_opinion_order', r.get('n'), 'CHMP opinion', op, 'authorisation', d,
                               'opinion dated after the authorisation', num=num))
    info = sum(1 for r in ema.get('authorised') or [] if r.get('indT'))
    return out, info


# --------------------------------------------------------------------------- queue
def check_queue(queue, fda, ema):
    out = []
    ema_by_name = {norm(r.get('n')): r for r in ema.get('authorised') or []}
    for e in (queue or {}).get('entries') or []:
        qd = iso(e.get('approvalDate'))
        if not qd:
            continue
        if e.get('jurisdiction') == 'FDA':
            f = fda.get(norm(e.get('drug')))
            if f and f['approvalDate'] != qd:
                out.append(finding('queue_vs_source', e.get('drug'), 'label queue', qd, 'Drugs@FDA', f['approvalDate'],
                                   'the source changed the approval date after the queue entry was created', id=e.get('id')))
        elif e.get('jurisdiction') == 'EMA':
            r = ema_by_name.get(norm(e.get('drug')))
            if r and iso(r.get('d')) and iso(r['d']) != qd:
                out.append(finding('queue_vs_source', e.get('drug'), 'label queue', qd, 'EMA table', iso(r['d']),
                                   'the source changed the authorisation date after the queue entry was created', id=e.get('id')))
    return out


# --------------------------------------------------------------------------- report
def build(fe, today, window):
    import datetime as dt
    since = (dt.date.fromisoformat(today) - dt.timedelta(days=window)).isoformat()
    us_recent = read_json(os.path.join(fe, 'us-recent.json'), {}) or {}
    novel = read_json(os.path.join(fe, 'novel-approvals.json'), {}) or {}
    cgt = read_json(os.path.join(fe, 'cgt-products.json'), {}) or {}
    ann = read_json(os.path.join(fe, 'announcements.json'), {}) or {}
    ema = read_json(os.path.join(fe, 'ema-medicines.json'), {}) or {}
    register = read_json(os.path.join(fe, 'eu-register-decisions.json'), {}) or {}
    queue = read_json(os.path.join(fe, 'pending-labels.json'), {}) or {}
    uspi_index = read_json(os.path.join(fe, 'uspi-index.json'), {}) or {}

    findings, fda = check_us(us_recent, novel, cgt, ann, since)
    findings += check_us_labels(fda, uspi_index, os.path.join(fe, 'uspi-data'))
    eu, ind_info = check_eu(ema, register, since)
    findings += eu
    findings += check_queue(queue, fda, ema)
    findings.sort(key=lambda f: (f['severity'] != 'conflict', f['check'], f['drug'] or ''))
    counts = {c: sum(1 for f in findings if f['check'] == c) for c in CHECKS}
    counts['eu_indication'] = ind_info
    return {
        'generated': today,
        'windowDays': window,
        'conflicts': sum(1 for f in findings if f['severity'] == 'conflict'),
        'notes': sum(1 for f in findings if f['severity'] != 'conflict'),
        'counts': counts,
        'findings': findings,
    }


def markdown(rep):
    lines = [f'## Cross-source conflicts — {rep["generated"]}',
             '',
             f'{rep["conflicts"]} conflict(s), {rep["notes"]} note(s) among medicines of the last {rep["windowDays"]} days; '
             f'{rep["counts"]["eu_indication"]} EU indication wording(s) resolved in favour of the SmPC (info).',
             '']
    if rep['findings']:
        lines += ['| Check | Medicine | Source A | Source B | Note |', '|---|---|---|---|---|']
        for f in rep['findings']:
            sev = '' if f['severity'] == 'conflict' else ' (note)'
            lines.append(f'| {f["check"]}{sev} | {f["drug"]} | {f["a"]["source"]}: {f["a"]["value"]} | '
                         f'{f["b"]["source"]}: {f["b"]["value"]} | {f.get("note", "")} |')
    else:
        lines.append('No disagreement between the sources.')
    lines += ['', '_Two sources, one medicine, two values — this says which, not which is right. '
                  'Report only; nothing is changed or quarantined._']
    return '\n'.join(lines) + '\n'


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--frontend', default=os.path.dirname(HERE))
    ap.add_argument('--json')
    ap.add_argument('--md')
    ap.add_argument('--window', type=int, default=400, help='days back from today a medicine is compared (default 400)')
    ap.add_argument('--today', default=lr.today_iso())
    ap.add_argument('--fail-on-conflict', action='store_true')
    a = ap.parse_args(argv)
    rep = build(a.frontend, a.today, a.window)
    md = markdown(rep)
    if a.json:
        with open(a.json, 'w', encoding='utf-8') as f:
            json.dump(rep, f, ensure_ascii=False, indent=1)
    if a.md:
        with open(a.md, 'w', encoding='utf-8') as f:
            f.write(md)
    print(md if not a.md else f'[source-conflicts] {rep["conflicts"]} conflict(s), {rep["notes"]} note(s) → {a.md}')
    for f in rep['findings']:
        if f['severity'] == 'conflict':
            print(f'::warning::Source conflict — {f["drug"]} ({f["check"]}): {f["a"]["source"]} {f["a"]["value"]} vs '
                  f'{f["b"]["source"]} {f["b"]["value"]}')
    out = os.environ.get('GITHUB_OUTPUT')
    if out:
        with open(out, 'a', encoding='utf-8') as fh:
            fh.write(f'conflicts={rep["conflicts"]}\n')
    return 1 if a.fail_on_conflict and rep['conflicts'] else 0


if __name__ == '__main__':
    sys.exit(main())
