"""Fixture tests for label-reconciliation.py — the approval → label hand-over queue.

Everything runs OFFLINE (no --probe): the queue is built from a small fixture
frontend/ folder (US recent approvals, CDER novel roster, CBER list, EMA
medicines, SmPC index + one extract) and openFDA answers are handed to
apply_us_records() as plain dicts. Covered: queue membership and start states,
the EU opinion → authorisation → SmPC-verified chain, the "never regress a
verified label" rule (gate G8), alert thresholds, retention, medicines leaving
the EMA catalogue, US label validation (application / brand / unharmonised
SPL records, an older label of another product), the Markdown report and one
end-to-end command-line run the way the daily job calls it.
"""
import hashlib
import json
import os
import shutil
import sys
import tempfile
import unittest
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _helpers import load_script, run_script, script_path  # noqa: E402

lr = load_script('label-reconciliation.py')

EPAR = 'https://www.ema.europa.eu/en/medicines/human/EPAR/'
TODAY = '2026-10-21'
THRESHOLDS = SimpleNamespace(us_pending_days=45, eu_pending_days=30, ingest_days=14, ec_decision_days=120)
LONG_INDICATION = ('ZETAVEX is a monoclonal antibody indicated for the treatment of adult patients with '
                   'relapsed or refractory test disease after at least two prior lines of therapy.')


def read_json(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)


def ema_authorised(name, num, d, **extra):
    return {'n': name, 'num': num, 'd': d, 'inn': name.lower() + 'mab', 'url': EPAR + name.lower(), 'op': '2026-06-25',
            'ind': f'{name} table wording', 'holder': f'{name} Holder', **extra}


def make_frontend(root):
    """Fixture snapshot folder: 3 US sources, EMA table, SmPC index + 1 complete extract."""
    write_json(os.path.join(root, 'us-recent.json'), {'items': [
        {'orig': '20260915', 'application_number': 'NDA210001', 'sponsor_name': 'ACME PHARMA',
         'products': [{'brand_name': 'ZETAVEX', 'active_ingredients': [{'name': 'ZETAMAB'}]}]},
        {'orig': '20250101', 'application_number': 'NDA200000', 'sponsor_name': 'OLD INC',   # outside the window
         'products': [{'brand_name': 'OLDBRAND', 'active_ingredients': [{'name': 'OLDMAB'}]}]},
    ]})
    write_json(os.path.join(root, 'novel-approvals.json'), {'2026': [
        {'no': 47, 'brandName': 'Hibsago', 'genericName': 'bepirovirsen', 'approvalDate': '2026-10-20',
         'indication': 'To treat chronic hepatitis B virus infection'},
        {'no': 40, 'brandName': 'Zetavex', 'genericName': 'zetamab', 'approvalDate': '2026-09-15',
         'indication': 'To treat relapsed test disease'},
    ]})
    write_json(os.path.join(root, 'cgt-products.json'), {
        'BLA125999': {'n': 'Cellgen', 'g': 'celgenlecleucel', 'd': '2026-10-01', 'i': 'CAR-T for test lymphoma'},
    })
    write_json(os.path.join(root, 'ema-medicines.json'), {
        'pipeline': [
            {'n': 'Gammaflu', 'num': 'EMEA/H/C/006003', 'inn': 'gammavir', 'url': EPAR + 'gammaflu', 'op': '2026-09-18',
             'ind': 'Gammaflu table wording', 'holder': 'Gamma Holder', 'outcome': 'positive'},
            {'n': 'Unknownop', 'num': 'EMEA/H/C/006009', 'inn': 'x', 'url': EPAR + 'unknownop', 'op': '2026-09-18',
             'ind': '', 'holder': '', 'outcome': 'unknown'},                 # outcome not recorded: not tracked
        ],
        'authorised': [
            ema_authorised('Alphazon', 'EMEA/H/C/006001', '2026-09-01', indSrc='smpc', indRet='2026-09-20'),
            ema_authorised('Betarix', 'EMEA/H/C/006002', '2026-10-01', ec='register'),
            ema_authorised('Oldmed', 'EMEA/H/C/005000', '2024-01-01'),     # outside the window
        ],
        'gone': [],
    })
    write_json(os.path.join(root, 'smpc-index.json'), {'drugs': {'alphazon': {'sha': 'index-sha'}}, 'failed': ['betarix']})
    write_json(os.path.join(root, 'smpc-data', 'alphazon.json'), {
        'retrieved': '2026-09-20', 'url': 'https://www.ema.europa.eu/en/documents/product-information/alphazon-epar-product-information_en.pdf',
        'sections': {'4.1': {'text': 'Alphazon is indicated for the treatment of adults with test disease.'},
                     '4.2': {'text': 'The recommended dose is 10 mg once daily.'}},
    })


def run_queue(fe, today, previous=None, probe=False):
    q = lr.Queue(previous or {}, today)
    lr.reconcile_us(q, fe, today, 180, probe, lambda m: None)
    lr.reconcile_eu(q, fe, today, 180, probe, lambda m: None)
    lr.apply_alerts_and_retention(q, today, 180, THRESHOLDS)
    return q, lr.build_output(q, today, 180, THRESHOLDS, probe)


def by_id(out):
    return {e['id']: e for e in out['entries']}


class HelperTests(unittest.TestCase):
    def test_iso_accepts_openfda_and_iso_dates(self):
        self.assertEqual(lr.iso('20260928'), '2026-09-28')
        self.assertEqual(lr.iso('2026-09-28T10:00:00'), '2026-09-28')
        self.assertIsNone(lr.iso(''))
        self.assertIsNone(lr.iso('Sept 2026'))

    def test_norm_title_and_brand_term(self):
        self.assertEqual(lr.norm('Zétavex® (zetamab)'), 'zetavex zetamab')
        self.assertEqual(lr.title('ACME PHARMA INC'), 'Acme Pharma Inc')
        self.assertEqual(lr.title('Novo Nordisk'), 'Novo Nordisk')
        self.assertEqual(lr.brand_query_term('Bixlenvo Sunlenca Starter Pack (copackaged)'), 'Bixlenvo Sunlenca Starter')
        self.assertEqual(lr.slug_of(EPAR + 'Alphazon-previously-oldname'), 'alphazonoldname')


class QueueBuildTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.fe = self.tmp.name
        make_frontend(self.fe)

    def tearDown(self):
        self.tmp.cleanup()

    def test_first_run_membership_and_start_states(self):
        q, out = run_queue(self.fe, TODAY)
        e = by_id(out)
        self.assertEqual(set(e), {'FDA:zetavex', 'FDA:hibsago', 'FDA:cellgen',
                                  'EMA:EMEA/H/C/006003', 'EMA:EMEA/H/C/006001', 'EMA:EMEA/H/C/006002'})
        z = e['FDA:zetavex']
        self.assertEqual(z['status'], lr.S_AWAITING_USPI)
        self.assertEqual(z['drug'], 'Zetavex')                           # the roster's spelling wins over ZETAVEX
        self.assertEqual(z['applicationNumber'], 'NDA210001')
        self.assertEqual(z['sources'], ['drugsfda', 'novel'])
        self.assertEqual(z['summary'], 'To treat relapsed test disease')
        self.assertEqual(z['sponsor'], 'Acme Pharma')
        self.assertEqual(e['FDA:cellgen']['applicationNumber'], 'BLA125999')
        self.assertEqual(e['FDA:cellgen']['sources'], ['cber'])
        self.assertEqual(e['EMA:EMEA/H/C/006003']['status'], lr.S_AWAITING_EC)
        self.assertEqual(e['EMA:EMEA/H/C/006003']['opinionDate'], '2026-09-18')
        beta = e['EMA:EMEA/H/C/006002']
        self.assertEqual(beta['status'], lr.S_AWAITING_SMPC)
        self.assertEqual(beta['decisionSource'], 'EU Union Register')
        self.assertIn('could not download', beta['note'])                  # slug listed in smpc-index failed
        alpha = e['EMA:EMEA/H/C/006001']
        self.assertEqual(alpha['status'], lr.S_VERIFIED)
        self.assertEqual(alpha['label']['retrieved'], '2026-09-20')
        self.assertTrue(alpha['label']['url'].endswith('alphazon-epar-product-information_en.pdf'))
        with open(os.path.join(self.fe, 'smpc-data', 'alphazon.json'), 'rb') as f:
            self.assertEqual(alpha['label']['sha256'], hashlib.sha256(f.read()).hexdigest())
        self.assertEqual(out['alerts'], [])
        self.assertEqual(out['summary']['unresolved'], 5)
        self.assertEqual(out['summary']['byStatus'][lr.S_VERIFIED], 1)
        self.assertEqual(len(out['summary']['transitions']), 7)           # 6 × new + Alphazon → VERIFIED
        self.assertTrue(all(e['firstSeen'] == TODAY and e['lastChecked'] == TODAY for e in out['entries']))

    def test_second_run_moves_opinion_to_authorised_and_never_regresses_verified(self):
        _, first = run_queue(self.fe, TODAY)
        ema = read_json(os.path.join(self.fe, 'ema-medicines.json'))
        ema['pipeline'] = [m for m in ema['pipeline'] if m['n'] != 'Gammaflu']
        ema['authorised'].insert(0, ema_authorised('Gammaflu', 'EMEA/H/C/006003', '2026-11-10', ec='register'))
        for m in ema['authorised']:                                       # Alphazon's extract vanished
            if m['n'] == 'Alphazon':
                m.pop('indSrc'); m.pop('indRet')
        write_json(os.path.join(self.fe, 'ema-medicines.json'), ema)
        os.remove(os.path.join(self.fe, 'smpc-data', 'alphazon.json'))

        later = '2026-11-15'
        q, out = run_queue(self.fe, later, previous=first)
        e = by_id(out)
        g = e['EMA:EMEA/H/C/006003']
        self.assertEqual(g['status'], lr.S_AWAITING_SMPC)
        self.assertEqual(g['decisionDate'], '2026-11-10')
        self.assertEqual(g['statusSince'], later)
        self.assertEqual(g['firstSeen'], TODAY)
        self.assertIn({'id': 'EMA:EMEA/H/C/006003', 'drug': 'Gammaflu', 'from': lr.S_AWAITING_EC, 'to': lr.S_AWAITING_SMPC,
                       'note': 'authorised 2026-11-10 (EU Union Register)'}, out['summary']['transitions'])
        alpha = e['EMA:EMEA/H/C/006001']
        self.assertEqual(alpha['status'], lr.S_VERIFIED)                  # gate G8: terminal state
        self.assertIn('lost its SmPC wording', alpha['alert'])
        self.assertEqual(alpha['label']['sha256'], first['entries'][[x['id'] for x in first['entries']].index('EMA:EMEA/H/C/006001')]['label']['sha256'])
        # thresholds: Zetavex approved 2026-09-15 (61 d > 45), Betarix authorised 2026-10-01 (45 d > 30), Gammaflu fresh
        alerts = {a['drug']: a['message'] for a in out['alerts']}
        self.assertIn('61 days after approval', alerts['Zetavex'])
        self.assertIn('45 days after the EU authorisation', alerts['Betarix'])
        self.assertIn('Alphazon', alerts)
        self.assertNotIn('Gammaflu', alerts)
        self.assertNotIn('Hibsago', alerts)                               # 26 days: below the threshold

    def test_set_status_records_history_and_refuses_to_leave_verified(self):
        q = lr.Queue({}, TODAY)
        e = q.ensure('FDA:test', jurisdiction='FDA', drug='Test', status=lr.S_AWAITING_USPI)
        q.set_status(e, lr.S_AVAILABLE, 'found')
        q.set_status(e, lr.S_VERIFIED, 'verified')
        q.set_status(e, lr.S_AWAITING_USPI, 'vanished')
        self.assertEqual(e['status'], lr.S_VERIFIED)
        self.assertEqual(e['alert'], 'vanished')
        self.assertEqual([h['status'] for h in e['history']], [lr.S_AWAITING_USPI, lr.S_AVAILABLE, lr.S_VERIFIED])
        self.assertEqual(len(q.transitions), 3)

    def test_retention_and_catalogue_exits(self):
        _, first = run_queue(self.fe, TODAY)
        ema = read_json(os.path.join(self.fe, 'ema-medicines.json'))
        ema['authorised'] = [m for m in ema['authorised'] if m['n'] != 'Betarix']
        ema['gone'] = [{'n': 'Betarix', 'num': 'EMEA/H/C/006002', 'st': 'Withdrawn', 'e': '2027-01-10'}]
        ema['pipeline'] = []                                              # Gammaflu left the opinion list without an MA record
        write_json(os.path.join(self.fe, 'ema-medicines.json'), ema)
        q, out = run_queue(self.fe, '2027-05-01', previous=first)
        closed = {c['drug']: c['why'] for c in out['summary']['closed']}
        self.assertIn('Withdrawn', closed['Betarix'])
        self.assertIn('without an authorisation record', closed['Gammaflu'])
        self.assertIn('older than 180 days', closed['Alphazon'])          # verified + aged out: covered by the label corpus
        self.assertNotIn('EMA:EMEA/H/C/006001', by_id(out))
        # unresolved US hand-overs stay in the queue (with alerts), whatever their age
        self.assertEqual(by_id(out)['FDA:zetavex']['status'], lr.S_AWAITING_USPI)
        self.assertIn('days after approval', by_id(out)['FDA:zetavex']['alert'])


class UsLabelValidationTests(unittest.TestCase):
    def setUp(self):
        self.q = lr.Queue({}, TODAY)
        self.e = self.q.ensure('FDA:zetavex', jurisdiction='FDA', drug='Zetavex', inn='zetamab', applicationNumber='NDA210001',
                               approvalDate='2026-09-15', status=lr.S_AWAITING_USPI)

    def harmonised(self, **over):
        rec = {'set_id': 'set-1', 'id': 'spl-1', 'version': '2', 'effective_time': '20261001',
               'indications_and_usage': ['1 INDICATIONS AND USAGE ' + LONG_INDICATION],
               'openfda': {'application_number': ['NDA210001'], 'brand_name': ['ZETAVEX'], 'generic_name': ['ZETAMAB'],
                           'product_type': ['HUMAN PRESCRIPTION DRUG']}}
        rec.update(over)
        return rec

    def test_matching_label_verifies_with_hash_and_identifiers(self):
        lr.apply_us_records(self.q, self.e, [self.harmonised()], TODAY)
        e = self.e
        self.assertEqual(e['status'], lr.S_VERIFIED)
        lb = e['label']
        self.assertEqual((lb['setId'], lb['version'], lb['effective']), ('set-1', '2', '2026-10-01'))
        self.assertEqual(lb['sha256'], lr.sha256('1 INDICATIONS AND USAGE ' + LONG_INDICATION))
        self.assertTrue(lb['harmonised'])
        self.assertEqual(lb['url'], 'https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=set-1')
        self.assertEqual(e['checks'], {'applicationMatch': True, 'nameMatch': True, 'indicationsPresent': True,
                                       'prescription': True, 'harmonised': True})
        self.assertIn('set ID set-1', e['history'][-1]['note'])

    def test_short_indications_section_is_found_but_not_verified(self):
        lr.apply_us_records(self.q, self.e, [self.harmonised(indications_and_usage=['see label'])], TODAY)
        self.assertEqual(self.e['status'], lr.S_AVAILABLE)
        self.assertFalse(self.e['checks']['indicationsPresent'])
        self.assertEqual(self.e['label']['detected'], TODAY)
        self.assertNotIn('sha256', self.e['label'])

    def test_other_products_and_older_labels_are_ignored(self):
        other = self.harmonised(openfda={'application_number': ['NDA999999'], 'brand_name': ['OTHERDRUG'], 'generic_name': ['OTHERMAB']})
        old = self.harmonised(effective_time='20240101', openfda={'brand_name': ['ZETAVEX'], 'generic_name': ['ZETAMAB']})  # same name, approved 2 years earlier
        lr.apply_us_records(self.q, self.e, [other, old], TODAY)
        self.assertEqual(self.e['status'], lr.S_AWAITING_USPI)
        self.assertNotIn('label', self.e)

    def test_unharmonised_spl_record_verifies_via_product_data_elements(self):
        rec = self.harmonised(effective_time='20260920')
        del rec['openfda']
        rec['spl_product_data_elements'] = ['ZETAVEX zetamab ZETAMAB injection intravenous']
        lr.apply_us_records(self.q, self.e, [rec], TODAY)
        self.assertEqual(self.e['status'], lr.S_VERIFIED)
        self.assertFalse(self.e['label']['harmonised'])
        self.assertIsNone(self.e['checks']['applicationMatch'])
        self.assertIn('not yet linked', self.e['label']['note'])

    def test_label_linked_to_this_application_beats_other_application_and_stays_verified(self):
        other_app = self.harmonised(set_id='set-other', effective_time='20261015',
                                    openfda={'application_number': ['NDA210777'], 'brand_name': ['ZETAVEX'], 'generic_name': ['ZETAMAB'],
                                             'product_type': ['HUMAN PRESCRIPTION DRUG']})
        lr.apply_us_records(self.q, self.e, [other_app, self.harmonised()], TODAY)
        self.assertEqual(self.e['status'], lr.S_VERIFIED)
        self.assertEqual(self.e['label']['setId'], 'set-1')                # the label of THIS application wins
        # next run openFDA only returns the other application's label: a verified
        # entry never regresses (gate G8) — the observation becomes an alert
        lr.apply_us_records(self.q, self.e, [other_app], TODAY)
        self.assertEqual(self.e['status'], lr.S_VERIFIED)
        self.assertIn('applicationMatch', self.e['alert'])

    def test_verified_label_that_vanishes_raises_an_alert_only(self):
        lr.apply_us_records(self.q, self.e, [self.harmonised()], TODAY)
        lr.apply_us_records(self.q, self.e, [], TODAY)
        self.assertEqual(self.e['status'], lr.S_VERIFIED)
        self.assertIn('no longer returns', self.e['alert'])


class CommandLineTests(unittest.TestCase):
    def test_end_to_end_run_writes_queue_report_and_github_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            fe = os.path.join(tmp, 'frontend')
            make_frontend(fe)
            out, md, gh = (os.path.join(tmp, n) for n in ('pending-labels.json', 'labels.md', 'gh-output.txt'))
            res = run_script(script_path('label-reconciliation.py'), '--frontend', fe, '--json', out, '--md', md,
                             '--today', TODAY, env={'GITHUB_OUTPUT': gh})
            self.assertIn('6 tracked, 5 unresolved, 1 verified', res.stdout)
            data = read_json(out)
            self.assertEqual((data['generated'], data['probe'], data['windowDays']), (TODAY, False, 180))
            self.assertEqual(data['thresholds'], {'usPendingDays': 45, 'euPendingDays': 30, 'ingestDays': 14, 'ecDecisionDays': 120})
            self.assertEqual(data['summary']['total'], 6)
            with open(md, encoding='utf-8') as f:
                report = f.read()
            self.assertIn('## Approval → label reconciliation (2026-10-21)', report)
            self.assertIn('**5 unresolved**', report)
            self.assertIn('| Zetavex | FDA | approved 2026-09-15 | AWAITING_USPI |', report)
            self.assertIn('Alphazon (EMA): verified 2026-10-21', report)
            with open(gh, encoding='utf-8') as f:
                self.assertEqual(f.read(), 'alerts=0\nunresolved=5\n')

            # a second run on the same files is quiet: nothing moves, the state is carried over
            res2 = run_script(script_path('label-reconciliation.py'), '--frontend', fe, '--json', out, '--md', md, '--today', '2026-10-22')
            self.assertIn('0 transition(s), 0 closed, 0 alert(s)', res2.stdout)
            data2 = read_json(out)
            self.assertEqual({e['id']: e['firstSeen'] for e in data2['entries']}, {e['id']: TODAY for e in data['entries']})

    def test_fail_on_alert_exits_nonzero(self):
        with tempfile.TemporaryDirectory() as tmp:
            fe = os.path.join(tmp, 'frontend')
            make_frontend(fe)
            res = run_script(script_path('label-reconciliation.py'), '--frontend', fe, '--json', os.path.join(tmp, 'q.json'),
                             '--today', '2026-12-01', '--fail-on-alert', check=False)
            self.assertEqual(res.returncode, 1)
            self.assertIn('::warning::Label hand-over unresolved — Zetavex', res.stdout)


if __name__ == '__main__':
    unittest.main()
