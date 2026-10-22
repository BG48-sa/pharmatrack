"""Fixture tests for build-novel-approvals.py — the CDER "Novel Drug Approvals" roster parser.

The FDA pages' "Export Excel" sheets have a title row, a header row and one row
per drug; brand/use cells carry glued link labels ("Drug Trials Snapshot",
"Press Release") and M/D/YYYY dates. The parser must clean those up and sort
newest-first, because the app's Novel tab and the label-reconciliation queue
both read the resulting JSON.
"""
import json
import os
import sys
import tempfile
import unittest

import openpyxl

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _helpers import load_script  # noqa: E402

novel = load_script('build-novel-approvals.py')


def write_roster(path, rows, title='Novel Drug Approvals for 2026'):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append([title])
    ws.append(['No.', 'Drug Name', 'Active Ingredient', 'Approval Date', 'FDA-approved use on approval date*'])
    for r in rows:
        ws.append(list(r))
    wb.save(path)


class NormDateTests(unittest.TestCase):
    def test_us_slash_dates_become_iso(self):
        self.assertEqual(novel.norm_date('10/20/2026'), '2026-10-20')
        self.assertEqual(novel.norm_date('1/5/2026'), '2026-01-05')

    def test_iso_and_unknown_pass_through(self):
        self.assertEqual(novel.norm_date('2026-01-05'), '2026-01-05')
        self.assertEqual(novel.norm_date(None), '')
        self.assertEqual(novel.norm_date('Pending'), 'Pending')


class CleanTests(unittest.TestCase):
    def test_link_labels_and_nbsp_are_removed(self):
        self.assertEqual(novel.clean('Hibsago\xa0Drug Trials Snapshot Press Release'), 'Hibsago')
        self.assertEqual(novel.clean('  To treat   X  External Link Disclaimer'), 'To treat X')
        self.assertEqual(novel.clean(None), '')


class ParseYearTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.tmp.name, 'novel-2026.xlsx')
        write_roster(self.path, [
            ('1.', 'Alphazon Drug Trials Snapshot', 'alphamab', '1/5/2026', 'To treat disease A Press Release'),
            ('2', 'Komzifti', 'komzimab', '3/14/2026', 'To treat disease K'),
            # a stray brand anchor glued into another drug's use text
            ('3', 'Hibsago\xa0Drug Trials Snapshot', 'bepirovirsen', '10/20/2026',
             'To treat chronic hepatitis B, used as an Komziftiadd-on therapy'),
            (None, 'ignored: blank No.', '', '', ''),
            ('Total', 'ignored: not a number', '', '', ''),
        ])

    def tearDown(self):
        self.tmp.cleanup()

    def test_rows_are_cleaned_and_sorted_newest_first(self):
        drugs = novel.parse_year(self.path)
        self.assertEqual([d['no'] for d in drugs], [3, 2, 1])
        hib, kom, alpha = drugs
        self.assertEqual(hib['brandName'], 'Hibsago')
        self.assertEqual(hib['genericName'], 'bepirovirsen')
        self.assertEqual(hib['approvalDate'], '2026-10-20')
        self.assertEqual(hib['indication'], 'To treat chronic hepatitis B, used as an add-on therapy')
        self.assertEqual(alpha['brandName'], 'Alphazon')
        self.assertEqual(alpha['approvalDate'], '2026-01-05')
        self.assertEqual(alpha['indication'], 'To treat disease A')
        self.assertEqual(kom['indication'], 'To treat disease K')

    def test_main_writes_years_newest_first_and_skips_unknown_files(self):
        write_roster(os.path.join(self.tmp.name, 'novel-2025.xlsx'),
                     [('1', 'Oldrug', 'oldmab', '2/2/2025', 'To treat disease O')], title='Novel Drug Approvals for 2025')
        write_roster(os.path.join(self.tmp.name, 'novel-draft.xlsx'), [('1', 'Nope', 'x', '1/1/2030', 'ignored')])
        out = os.path.join(self.tmp.name, 'novel-approvals.json')
        novel.DATA_DIR, novel.OUT = self.tmp.name, out
        novel.main()
        with open(out, encoding='utf-8') as f:
            data = json.load(f)
        self.assertEqual(list(data), ['2026', '2025'])
        self.assertEqual(len(data['2026']), 3)
        self.assertEqual(data['2025'][0]['brandName'], 'Oldrug')
        self.assertEqual(data['2025'][0]['approvalDate'], '2025-02-02')
        # every record carries the five fields the app and the label queue read
        for year in data.values():
            for d in year:
                self.assertEqual(set(d), {'no', 'brandName', 'genericName', 'approvalDate', 'indication'})


if __name__ == '__main__':
    unittest.main()
