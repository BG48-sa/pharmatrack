"""Fixture tests for source-conflicts.py — two sources, one medicine, two values.

Offline: a small frontend/ folder is written into a temporary directory with
Drugs@FDA's recent list, the CDER roster, the CBER list, FDA announcements, one
stored US label, EMA's table, the Union Register cache and the label queue.
Covered: approval-date and INN disagreements between the US sources (salts
ignored), an announcement dated before the approval, a stored label older than
its application's approval (note within 30 days, conflict beyond), EMA vs Union
Register decision dates (note at one day, conflict beyond), opinion-after-
authorisation only for recent records, a queue entry whose source date moved,
the Markdown report and one command-line run with $GITHUB_OUTPUT.
"""
import json
import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _helpers import load_script, run_script, script_path  # noqa: E402

sc = load_script('source-conflicts.py')

TODAY = '2026-10-26'
SINCE = '2025-09-21'


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f)


def fda_item(app, brand, inn, orig, cls='TYPE 1'):
    return {'application_number': app, 'orig': orig, 'sponsor_name': 'ACME',
            'submissions': [{'submission_type': 'ORIG', 'submission_class_code': cls}],
            'products': [{'brand_name': brand, 'active_ingredients': [{'name': inn}]}]}


class FixtureTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        fe = self.fe = os.path.join(self.dir, 'frontend')
        write_json(os.path.join(fe, 'us-recent.json'), {'items': [
            fda_item('NDA000001', 'ZETAVEX', 'ZETAVIR HYDROBROMIDE', '20260301'),      # agrees (salt differs only)
            fda_item('NDA000002', 'JASCAYD', 'NERANDOMILAST', '20251219', 'TYPE 9'),   # roster: 7 Oct
            fda_item('NDA000003', 'HOVILPRI', 'PRITELIVIR', '20261009'),               # roster: another INN
            fda_item('BLA000004', 'OLDLAB', 'OLDUMAB', '20260601'),                    # label 2 months older
            fda_item('BLA000005', 'NEWLAB', 'NEWUMAB', '20260610'),                    # label 3 days older
            fda_item('NDA000006', 'ANCIENT', 'ANCIENTIN', '20200101'),                 # outside the window
        ]})
        write_json(os.path.join(fe, 'novel-approvals.json'), {'2026': [
            {'brandName': 'Zetavex', 'genericName': 'zetavir', 'approvalDate': '2026-03-01'},
            {'brandName': 'Hovilpri', 'genericName': 'pritelivir sodium', 'approvalDate': '2026-10-09'},
        ], '2025': [
            {'brandName': 'Jascayd', 'genericName': 'nerandomilast', 'approvalDate': '2025-10-07'},
            {'brandName': 'Hovilpri', 'genericName': 'something else', 'approvalDate': '2026-10-09'},
        ]})
        write_json(os.path.join(fe, 'cgt-products.json'), {
            'BLA000004': {'n': 'Oldlab', 'g': 'oldumab', 'd': '2026-06-15'},             # 14 days from Drugs@FDA
        })
        write_json(os.path.join(fe, 'announcements.json'), {'items': [
            {'title': 'FDA approves Zetavex', 'date': '2026-02-20', 'source': 'FDA', 'names': ['zetavex'], 'url': 'u1'},
            {'title': 'FDA approves Newlab', 'date': '2026-06-11', 'source': 'FDA', 'names': ['newlab'], 'url': 'u2'},
        ]})
        write_json(os.path.join(fe, 'uspi-index.json'), {'drugs': {'oldlab': {'brand': 'Oldlab'}, 'newlab': {'brand': 'Newlab'}}})
        write_json(os.path.join(fe, 'uspi-data', 'oldlab.json'), {'usBrand': 'OLDLAB', 'usApplication': 'BLA000004', 'effective': '2026-04-01', 'splSetId': 's1'})
        write_json(os.path.join(fe, 'uspi-data', 'newlab.json'), {'usBrand': 'NEWLAB', 'usApplication': 'BLA000005', 'effective': '2026-06-07', 'splSetId': 's2'})
        write_json(os.path.join(fe, 'ema-medicines.json'), {'authorised': [
            {'n': 'Eumed', 'inn': 'eumedine', 'num': 'EMEA/H/C/000001', 'd': '2026-07-15', 'op': '2026-05-20', 'indT': ['adults']},
            {'n': 'Eutwo', 'inn': 'eutwoine', 'num': 'EMEA/H/C/000002', 'd': '2026-07-15', 'op': '2026-05-20'},
            {'n': 'Euthree', 'inn': 'euthreeine', 'num': 'EMEA/H/C/000003', 'd': '2026-08-01', 'op': '2026-08-05'},
            {'n': 'Arixtra', 'inn': 'fondaparinux', 'num': 'EMEA/H/C/000403', 'd': '2002-03-20', 'op': '2010-07-22'},
        ]})
        write_json(os.path.join(fe, 'eu-register-decisions.json'), {'decisions': {
            'EMEA/H/C/000001': {'d': '2026-07-16', 'id': '1'},
            'EMEA/H/C/000002': {'d': '2026-07-20', 'id': '2'},
        }})
        write_json(os.path.join(fe, 'pending-labels.json'), {'entries': [
            {'id': 'FDA:zetavex', 'jurisdiction': 'FDA', 'drug': 'Zetavex', 'approvalDate': '2026-03-01'},
            {'id': 'FDA:jascayd', 'jurisdiction': 'FDA', 'drug': 'Jascayd', 'approvalDate': '2025-10-07'},
            {'id': 'EMA:eumed', 'jurisdiction': 'EMA', 'drug': 'Eumed', 'approvalDate': '2026-07-10'},
        ]})
        self.rep = sc.build(fe, TODAY, 400)
        self.by = {}
        for f in self.rep['findings']:
            self.by.setdefault(f['check'], {})[f['drug']] = f

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def test_us_approval_dates(self):
        f = self.by['us_approval_date']
        self.assertEqual(f['Jascayd']['a']['value'], '2025-12-19')
        self.assertEqual(f['Jascayd']['b']['value'], '2025-10-07')
        self.assertEqual(f['Jascayd']['severity'], 'conflict')
        self.assertEqual(f['Oldlab']['b']['source'], 'CBER list')
        self.assertNotIn('Zetavex', f)
        self.assertNotIn('Ancient', f)                           # outside the window

    def test_us_inn_ignores_salts_but_not_other_ingredients(self):
        f = self.by.get('us_inn', {})
        self.assertNotIn('Zetavex', f)                           # hydrobromide vs none
        self.assertIn('Hovilpri', f)                             # 'something else'
        self.assertEqual(f['Hovilpri']['a']['value'], 'pritelivir')

    def test_announcement_before_approval(self):
        f = self.by['us_announcement']
        self.assertEqual(f['Zetavex']['a']['value'], '2026-02-20')
        self.assertNotIn('Newlab', f)                            # announced the day after: fine

    def test_stored_label_older_than_approval(self):
        f = self.by['us_label_date']
        self.assertEqual(f['Oldlab']['severity'], 'conflict')    # 61 days
        self.assertEqual(f['Newlab']['severity'], 'note')        # 3 days
        self.assertEqual(f['Oldlab']['setId'], 's1')

    def test_eu_decision_dates(self):
        f = self.by['eu_decision_date']
        self.assertEqual(f['Eumed']['severity'], 'note')         # one day
        self.assertEqual(f['Eutwo']['severity'], 'conflict')     # five days
        self.assertEqual(f['Eutwo']['b']['source'], 'Union Register')

    def test_opinion_after_authorisation_only_for_recent_records(self):
        f = self.by['eu_opinion_order']
        self.assertIn('Euthree', f)
        self.assertNotIn('Arixtra', f)                           # 2002 product with a 2010 (latest) opinion

    def test_queue_vs_source(self):
        f = self.by['queue_vs_source']
        self.assertEqual(f['Jascayd']['b']['value'], '2025-12-19')
        self.assertEqual(f['Eumed']['b']['value'], '2026-07-15')
        self.assertNotIn('Zetavex', f)

    def test_counts_and_markdown(self):
        self.assertEqual(self.rep['counts']['eu_indication'], 1)
        self.assertEqual(self.rep['conflicts'], sum(1 for x in self.rep['findings'] if x['severity'] == 'conflict'))
        md = sc.markdown(self.rep)
        self.assertIn('| us_approval_date | Jascayd |', md)
        self.assertIn('eu_decision_date (note) | Eumed', md)
        self.assertIn('Report only', md)
        # conflicts first, then notes
        kinds = [x['severity'] for x in self.rep['findings']]
        self.assertEqual(kinds, sorted(kinds, key=lambda s: s != 'conflict'))

    def test_empty_folder_reports_nothing(self):
        empty = os.path.join(self.dir, 'empty')
        os.makedirs(empty)
        rep = sc.build(empty, TODAY, 400)
        self.assertEqual(rep['findings'], [])
        self.assertIn('No disagreement', sc.markdown(rep))

    def test_command_line_run(self):
        out_json = os.path.join(self.dir, 'c.json')
        out_md = os.path.join(self.dir, 'c.md')
        gh = os.path.join(self.dir, 'gh.txt')
        env = dict(os.environ, GITHUB_OUTPUT=gh)
        r = run_script(script_path('source-conflicts.py'), '--frontend', self.fe, '--today', TODAY, '--json', out_json, '--md', out_md, env=env)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn('::warning::Source conflict — Jascayd', r.stdout)
        with open(gh, encoding='utf-8') as f:
            self.assertIn(f'conflicts={self.rep["conflicts"]}', f.read())
        with open(out_json, encoding='utf-8') as f:
            self.assertEqual(json.load(f)['conflicts'], self.rep['conflicts'])
        r = run_script(script_path('source-conflicts.py'), '--frontend', self.fe, '--today', TODAY, '--fail-on-conflict', env=env, check=False)
        self.assertEqual(r.returncode, 1)


if __name__ == '__main__':
    unittest.main()
