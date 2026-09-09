#!/usr/bin/env python3
"""Quality gates for a DrugRadar data release.

WHY THIS EXISTS
  The nightly refresh rebuilds the bundled snapshots and deploys them. A build
  that FINISHES is not a build that is RIGHT: an upstream layout change, an
  error page saved as data, or a parser bug can produce a smaller, emptier or
  shifted dataset that still deploys. This script compares the CANDIDATE data
  (the working tree: frontend/*.json, smpc-data/, uspi-data/) with the
  PUBLISHED release (the data/ folder of the gh-pages branch — exactly what
  users see) and fails when the candidate would be a regression. The Action
  runs it BEFORE anything is committed or deployed, so a failing candidate
  never reaches users: the previous release simply stays live, on the web and
  in the native apps alike (they download the same files).

  Run it locally before committing a manual label extraction:
    python3 scripts/validate-release.py --published-ref origin/gh-pages

GATES (each is recorded in the report; any FAIL exits 1)
  G1 every snapshot parses and stays within a size band of the published copy
  G2 EMA catalogue: counts do not collapse, no product vanishes, the EMA report
     date does not move backwards
  G3 EMA records: required fields present, dates plausible
  G4 CBER cell & gene therapy snapshot never shrinks
  G5 label corpora (SmPC / USPI): no file vanishes beyond a small allowance, no
     required section is lost, no catastrophic text shrink, US pairing counts
     do not drop
  G6 agreement across the app's views: every age limit in an extracted US label
     appears in the curated CBER row for that product; EU indications are
     sourced from the SmPC wherever an extract exists, and the share of records
     where EMA's table disagrees with the SmPC on age limits stays small

OUTPUT
  A JSON report (--report) listing every gate with its numbers, so a failure
  names the file, the rule and the values that tripped it.
"""
import argparse
import datetime
import json
import os
import re
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
FRONTEND = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from agephrases import age_thresholds  # noqa: E402

SNAPSHOTS = ['ema-medicines.json', 'novel-approvals.json', 'pdufa.json', 'critical-medicines.json',
             'cgt-products.json', 'disease-entities.json', 'biomarkers.json', 'fda-cdx.json', 'announcements.json']
# Allowed relative size change per snapshot (candidate vs published).
SIZE_BAND = {'ema-medicines.json': 0.15, 'announcements.json': 0.80}
SIZE_BAND_DEFAULT = 0.35

SMPC_REQUIRED = ['4.1', '4.2', '4.3', '4.4', '4.8']
USPI_REQUIRED = ['indications', 'dosage', 'contraindications', 'warnings', 'adverse_reactions']
ISO = re.compile(r'^\d{4}-\d{2}-\d{2}$')


def load(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def section_text(v):
    if v is None:
        return ''
    if isinstance(v, str):
        return v
    if isinstance(v, dict):
        return '' if v.get('missing') else str(v.get('text') or '')
    return str(v)


def label_profile(doc, required):
    secs = doc.get('sections') or {}
    have = {k for k in required if section_text(secs.get(k)).strip()}
    total = sum(len(section_text(v)) for v in secs.values()) if isinstance(secs, dict) else 0
    return have, total


class Report:
    def __init__(self):
        self.gates = []

    def add(self, gid, name, ok, detail, skipped=False):
        self.gates.append({'id': gid, 'name': name, 'status': 'skip' if skipped else ('pass' if ok else 'FAIL'), 'detail': detail})
        mark = 'skip' if skipped else ('pass' if ok else 'FAIL')
        print(f'[{mark:4}] {gid} {name}: {detail}')

    @property
    def failed(self):
        return [g for g in self.gates if g['status'] == 'FAIL']


def published_from_ref(ref):
    """Extract data/ of a git ref (e.g. origin/gh-pages) into a temp dir."""
    tmp = tempfile.mkdtemp(prefix='drugradar-published-')
    repo = os.path.dirname(FRONTEND)
    archive = subprocess.run(['git', 'archive', ref, 'data'], cwd=repo, capture_output=True)
    if archive.returncode != 0:
        raise SystemExit(f'cannot read {ref}: {archive.stderr.decode(errors="replace").strip()}')
    subprocess.run(['tar', '-x', '-C', tmp], input=archive.stdout, check=True)
    return os.path.join(tmp, 'data')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--candidate', default=FRONTEND, help='frontend/ directory holding the candidate data')
    ap.add_argument('--published', help='data/ directory of the currently published release')
    ap.add_argument('--published-ref', help='git ref whose data/ folder is the published release (e.g. origin/gh-pages)')
    ap.add_argument('--report', default=None, help='write the JSON report here')
    ap.add_argument('--max-vanished', type=int, default=3, help='EMA products / label files allowed to disappear')
    ap.add_argument('--max-label-regressions', type=int, default=0)
    ap.add_argument('--today', default=datetime.date.today().isoformat())
    a = ap.parse_args()

    if not a.published and not a.published_ref:
        ap.error('give --published DIR or --published-ref REF')
    pub = a.published or published_from_ref(a.published_ref)
    cand = a.candidate
    r = Report()

    # ---- G1: snapshots parse + size band -------------------------------------
    cand_json, pub_json = {}, {}
    for f in SNAPSHOTS:
        cp, pp = os.path.join(cand, f), os.path.join(pub, f)
        try:
            cand_json[f] = load(cp)
        except Exception as e:  # noqa: BLE001
            r.add('G1', f'{f} parses', False, f'candidate unreadable: {e}')
            continue
        if not os.path.exists(pp):
            r.add('G1', f'{f} size band', True, 'new file — no published copy to compare', skipped=True)
            continue
        try:
            pub_json[f] = load(pp)
        except Exception as e:  # noqa: BLE001
            r.add('G1', f'{f} size band', True, f'published copy unreadable ({e}) — skipped', skipped=True)
            continue
        cs, ps = os.path.getsize(cp), os.path.getsize(pp)
        band = SIZE_BAND.get(f, SIZE_BAND_DEFAULT)
        rel = (cs - ps) / ps if ps else 0.0
        r.add('G1', f'{f} size band ±{int(band * 100)}%', abs(rel) <= band, f'{ps} → {cs} bytes ({rel:+.1%})')

    # ---- G2 / G3: EMA catalogue ---------------------------------------------
    ce, pe = cand_json.get('ema-medicines.json'), pub_json.get('ema-medicines.json')
    if ce and pe:
        ca, cp_, cg = ce.get('authorised', []), ce.get('pipeline', []), ce.get('gone', [])
        pa, pp_, pg = pe.get('authorised', []), pe.get('pipeline', []), pe.get('gone', [])
        r.add('G2', 'EMA authorised count', len(ca) >= max(1000, len(pa) - 5), f'{len(pa)} → {len(ca)}')
        r.add('G2', 'EMA withdrawn/refused count', len(cg) >= len(pg) - 5, f'{len(pg)} → {len(cg)}')
        r.add('G2', 'EMA pending count plausible', 0 <= len(cp_) <= 80, f'{len(pp_)} → {len(cp_)}')
        names = lambda d: {x.get('n', '').lower() for x in d.get('authorised', []) + d.get('pipeline', []) + d.get('gone', [])}  # noqa: E731
        vanished = sorted(names(pe) - names(ce))
        r.add('G2', 'EMA products vanished', len(vanished) <= a.max_vanished, f'{len(vanished)} (max {a.max_vanished}): {", ".join(vanished[:10])}')
        r.add('G2', 'EMA report date not moving back', (ce.get('generated') or '') >= (pe.get('generated') or ''), f'{pe.get("generated")} → {ce.get("generated")}')
        limit = (datetime.date.fromisoformat(a.today) + datetime.timedelta(days=7)).isoformat()
        bad = [x.get('n') for x in ca if not (x.get('n') and x.get('url') and ISO.match(x.get('d') or '') and '1995-01-01' <= x['d'] <= limit)]
        r.add('G3', 'EMA authorised: name, URL, plausible MA date', not bad, f'{len(bad)} bad: {", ".join(str(b) for b in bad[:8])}')
        empty_inn = sum(1 for x in ca if not x.get('inn')) / max(1, len(ca))
        empty_ind = sum(1 for x in ca if not x.get('ind')) / max(1, len(ca))
        r.add('G3', 'EMA authorised: INN / indication filled', empty_inn <= 0.02 and empty_ind <= 0.05, f'empty INN {empty_inn:.1%}, empty indication {empty_ind:.1%}')
        bad_gone = [x.get('n') for x in cg if x.get('e') and x.get('d') and x['e'] < x['d']]
        r.add('G3', 'EMA withdrawn: end date not before MA', not bad_gone, f'{len(bad_gone)}: {", ".join(bad_gone[:8])}')
        bad_pipe = [x.get('n') for x in cp_ if not ISO.match(x.get('op') or '') or x.get('outcome') not in ('positive', 'unknown')]
        r.add('G3', 'EMA pending: opinion date + outcome', not bad_pipe, f'{len(bad_pipe)}: {", ".join(bad_pipe[:8])}')
    elif ce and not pe:
        r.add('G2', 'EMA catalogue comparison', True, 'no published copy', skipped=True)

    # ---- G4: CBER snapshot ----------------------------------------------------
    cc, pc = cand_json.get('cgt-products.json'), pub_json.get('cgt-products.json')
    if isinstance(cc, dict):
        bad = [k for k, v in cc.items() if not (isinstance(v, dict) and v.get('d') and v.get('n'))]
        prev_n = len(pc) if isinstance(pc, dict) else 0
        r.add('G4', 'CBER cell & gene therapy snapshot never shrinks', len(cc) >= prev_n and not bad, f'{prev_n} → {len(cc)} products, {len(bad)} malformed')

    # ---- G5: label corpora ----------------------------------------------------
    for corpus, cdir, required in (('smpc', 'smpc-data', SMPC_REQUIRED), ('uspi', 'uspi-data', USPI_REQUIRED)):
        cpath, ppath = os.path.join(cand, cdir), os.path.join(pub, corpus)
        if not os.path.isdir(ppath):
            r.add('G5', f'{corpus} corpus', True, 'no published corpus to compare', skipped=True)
            continue
        if not os.path.isdir(cpath):
            r.add('G5', f'{corpus} corpus present', False, f'{cpath} missing')
            continue
        cfiles = {f for f in os.listdir(cpath) if f.endswith('.json')}
        pfiles = {f for f in os.listdir(ppath) if f.endswith('.json')}
        vanished = sorted(pfiles - cfiles)
        r.add('G5', f'{corpus} files vanished', len(vanished) <= a.max_vanished, f'{len(pfiles)} → {len(cfiles)} files; vanished {len(vanished)} (max {a.max_vanished}): {", ".join(vanished[:8])}')
        regressions, shrunk, unreadable = [], [], []
        match_c, match_p = {}, {}
        for f in sorted(pfiles & cfiles):
            try:
                pd_, cd_ = load(os.path.join(ppath, f)), load(os.path.join(cpath, f))
            except Exception:  # noqa: BLE001
                unreadable.append(f)
                continue
            ph, pt = label_profile(pd_, required)
            ch, ct = label_profile(cd_, required)
            lost = ph - ch
            if lost:
                regressions.append(f'{f} lost {"/".join(sorted(lost))}')
            if pt >= 2000 and ct < 0.4 * pt:
                shrunk.append(f'{f} {pt}→{ct} chars')
            if corpus == 'uspi':
                match_p[pd_.get('match') or 'none'] = match_p.get(pd_.get('match') or 'none', 0) + 1
                match_c[cd_.get('match') or 'none'] = match_c.get(cd_.get('match') or 'none', 0) + 1
        r.add('G5', f'{corpus} files readable', not unreadable, f'{len(unreadable)} unreadable: {", ".join(unreadable[:8])}')
        r.add('G5', f'{corpus} required sections kept ({"/".join(required)})', len(regressions) <= a.max_label_regressions, f'{len(regressions)} regressions: {"; ".join(regressions[:8])}')
        r.add('G5', f'{corpus} no catastrophic text shrink (<40%)', not shrunk, f'{len(shrunk)}: {"; ".join(shrunk[:8])}')
        if corpus == 'uspi':
            paired_p = match_p.get('brand', 0) + match_p.get('substance', 0)
            paired_c = match_c.get('brand', 0) + match_c.get('substance', 0)
            r.add('G5', 'US label pairing not dropping', paired_c >= paired_p - 5, f'brand {match_p.get("brand", 0)}→{match_c.get("brand", 0)}, substance {match_p.get("substance", 0)}→{match_c.get("substance", 0)}')

    # ---- G6: agreement across views --------------------------------------------
    cc = cand_json.get('cgt-products.json')
    uspi_idx_path = os.path.join(cand, 'uspi-index.json')
    if isinstance(cc, dict) and os.path.exists(uspi_idx_path):
        try:
            by_brand = {str(v.get('brand') or '').lower(): slug for slug, v in (load(uspi_idx_path).get('drugs') or {}).items()}
        except Exception:  # noqa: BLE001
            by_brand = {}
        compared, bad = 0, []
        for bla, row in cc.items():
            slug = by_brand.get(str(row.get('n') or '').lower())
            path = os.path.join(cand, 'uspi-data', f'{slug}.json') if slug else None
            if not path or not os.path.exists(path):
                continue
            try:
                sec = (load(path).get('sections') or {}).get('indications') or {}
            except Exception:  # noqa: BLE001
                continue
            label_ages = age_thresholds(section_text(sec))
            curated_ages = age_thresholds(row.get('i') or '')
            if not label_ages or not curated_ages:
                continue
            compared += 1
            if not label_ages <= curated_ages:
                bad.append(f"{row.get('n')} label {sorted(label_ages)} vs curated {sorted(curated_ages)}")
        r.add('G6', 'CBER curated rows carry the age limits of the US label', not bad, f'{compared} compared, {len(bad)} disagree: {"; ".join(bad[:5])}')
    if ce:
        auth = ce.get('authorised', [])
        smpc_dir = os.path.join(cand, 'smpc-data')
        slugs_with_extract = 0
        for x in auth:
            slug = (str(x.get('url') or '').split('/EPAR/')[1] if '/EPAR/' in str(x.get('url') or '') else '').replace('-previously-', '').lower()
            slug = slug.split('-previously-')[0]
            if slug and os.path.exists(os.path.join(smpc_dir, f'{slug}.json')):
                slugs_with_extract += 1
        from_smpc = sum(1 for x in auth if x.get('indSrc') == 'smpc')
        disagree = [x.get('n') for x in auth if x.get('indT')]
        r.add('G6', 'EU indications sourced from the SmPC where an extract exists', from_smpc >= 0.95 * slugs_with_extract, f'{from_smpc} of {slugs_with_extract} records with an extract')
        r.add('G6', 'EMA table vs SmPC age-limit disagreements stay rare', len(disagree) <= max(10, 0.1 * max(1, from_smpc)), f'{len(disagree)} records: {", ".join(str(d) for d in disagree[:8])}')
        if pe and any(x.get('indSrc') for x in pe.get('authorised', [])):
            pub_from_smpc = sum(1 for x in pe.get('authorised', []) if x.get('indSrc') == 'smpc')
            r.add('G6', 'SmPC-sourced indications not dropping', from_smpc >= pub_from_smpc - 20, f'{pub_from_smpc} → {from_smpc}')

    status = 'FAIL' if r.failed else 'pass'
    report = {'checkedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds'), 'candidate': os.path.abspath(cand),
              'published': a.published_ref or os.path.abspath(pub), 'status': status, 'gates': r.gates}
    if a.report:
        with open(a.report, 'w', encoding='utf-8') as f:
            json.dump(report, f, indent=1)
    print(f'validation {status}: {len(r.failed)} failing of {len(r.gates)} gates')
    sys.exit(1 if r.failed else 0)


if __name__ == '__main__':
    main()
