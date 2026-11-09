"""Gate G7 of validate-release.py: source fingerprints, the verified ledger and coverage.

Each case builds a tiny published release and a tiny candidate (one EU and one US
label) and reads the G7 entries of the JSON report. The other gates fail on such
a skeleton (no snapshots) — only G7 is asserted here.
"""
import json
import os
import tempfile
import unittest

from _helpers import run_script, script_path

EU_SECTIONS = {k: {'title': k, 'text': f'Section {k} of Examplo. ' * 5} for k in ('4.1', '4.2', '4.3', '4.4', '4.8')}
US_SECTIONS = {k: {'text': f'{k} text of Examplo. ' * 5, 'tables': []} for k in ('indications', 'dosage', 'contraindications', 'warnings', 'adverse_reactions')}


def eu_doc(**kw):
    return {'slug': 'examplo', 'brand': 'Examplo', 'retrieved': '2026-07-03', 'sections': json.loads(json.dumps(EU_SECTIONS)), **kw}


def us_doc(**kw):
    return {'slug': 'examplo', 'brand': 'EXAMPLO', 'match': 'brand', 'splSetId': 'set-1', 'effective': '2026-05-01',
            'sections': json.loads(json.dumps(US_SECTIONS)), **kw}


EU_ENTRY = {'sha': 'e' * 64, 'retrieved': '2026-07-03', 'v': '2026-11-09'}
US_ENTRY = {'sha': 'u' * 64, 'setId': 'set-1', 'effective': '2026-05-01', 'splId': 'spl-1', 'v': '2026-11-09'}
LEDGER = {'smpc': {'examplo': EU_ENTRY}, 'uspi': {'examplo': US_ENTRY}}


def changed(doc, key):
    doc['sections'][key]['text'] = 'Examplo is now ALSO indicated for children from 2 years of age. ' * 3
    return doc


class FingerprintGate(unittest.TestCase):
    def run_gate(self, pub_eu, cand_eu, pub_us, cand_us, pub_ledger=LEDGER, cand_ledger=LEDGER):
        with tempfile.TemporaryDirectory() as tmp:
            pub, cand = os.path.join(tmp, 'pub'), os.path.join(tmp, 'cand')
            for base, eu_dir, us_dir, eu, us, ledger in ((pub, 'smpc', 'uspi', pub_eu, pub_us, pub_ledger), (cand, 'smpc-data', 'uspi-data', cand_eu, cand_us, cand_ledger)):
                for sub, doc in ((eu_dir, eu), (us_dir, us)):
                    os.makedirs(os.path.join(base, sub))
                    with open(os.path.join(base, sub, 'examplo.json'), 'w', encoding='utf-8') as f:
                        json.dump(doc, f)
                if ledger is not None:
                    with open(os.path.join(base, 'label-fingerprints.json'), 'w', encoding='utf-8') as f:
                        json.dump(ledger, f)
            report = os.path.join(tmp, 'report.json')
            run_script(script_path('validate-release.py'), '--candidate', cand, '--published', pub, '--report', report, check=False)
            with open(report, encoding='utf-8') as f:
                rep = json.load(f)
        gates = {g['name']: g for g in rep['gates'] if g['id'] == 'G7'}
        pick = lambda corpus, word: next(g for n, g in gates.items() if n.startswith(corpus) and word in n)  # noqa: E731
        return {c: {'drift': pick(c, 'parser drift'), 'fp': pick(c, 'source fingerprints')} for c in ('smpc', 'uspi')}, rep['changes']['labels']

    def test_unchanged_labels_covered_by_the_ledger_are_compared_and_pass(self):
        g, changes = self.run_gate(eu_doc(), eu_doc(), us_doc(), us_doc())
        for c in ('smpc', 'uspi'):
            self.assertEqual(g[c]['drift']['status'], 'pass', g[c]['drift'])
            self.assertIn('1 of 1 compared by source fingerprint', g[c]['drift']['detail'])
            self.assertEqual(g[c]['fp']['status'], 'pass', g[c]['fp'])
            self.assertEqual(changes[c]['fingerprints']['ledger'], 1)

    def test_text_changed_while_the_source_is_the_same_is_parser_drift(self):
        # the drill: an indication is altered, the extract still claims the same source
        g, changes = self.run_gate(eu_doc(), changed(eu_doc(), '4.1'), us_doc(), changed(us_doc(), 'indications'))
        for c in ('smpc', 'uspi'):
            self.assertEqual(g[c]['drift']['status'], 'FAIL', g[c]['drift'])
            self.assertEqual(len(changes[c]['parserDrift']), 1)

    def test_re_extraction_from_the_same_source_with_different_text_is_parser_drift(self):
        # an extractor rewrote the files: they now carry their own fingerprint — the same source as the ledger's
        g, _ = self.run_gate(eu_doc(), changed(eu_doc(sourceSha='e' * 64), '4.2'),
                             us_doc(sourceSha='f' * 64), changed(us_doc(sourceSha='u' * 64, shaScope='label'), 'dosage'))
        self.assertEqual(g['smpc']['drift']['status'], 'FAIL', g['smpc']['drift'])
        self.assertEqual(g['uspi']['drift']['status'], 'FAIL', g['uspi']['drift'])   # the old whole-record fingerprint ('f…') is superseded by the ledger

    def test_text_changed_with_a_new_source_is_a_regulatory_update(self):
        g, changes = self.run_gate(eu_doc(), changed(eu_doc(sourceSha='a' * 64, retrieved='2026-11-09'), '4.1'),
                                   us_doc(), changed(us_doc(sourceSha='b' * 64, shaScope='label', effective='2026-10-30'), 'indications'))
        for c in ('smpc', 'uspi'):
            self.assertEqual(g[c]['drift']['status'], 'pass', g[c]['drift'])
            self.assertEqual(g[c]['fp']['status'], 'pass', g[c]['fp'])
            self.assertEqual(len(changes[c]['updated']), 1)
            self.assertEqual(changes[c]['fingerprints']['own'], 1)

    def test_a_changed_label_without_any_fingerprint_fails(self):
        # new retrieval day / version: the ledger entry no longer applies, and the file carries no fingerprint of its own
        g, _ = self.run_gate(eu_doc(), changed(eu_doc(retrieved='2026-11-09'), '4.1'), us_doc(), changed(us_doc(effective='2026-10-30'), 'indications'))
        for c in ('smpc', 'uspi'):
            self.assertEqual(g[c]['fp']['status'], 'FAIL', g[c]['fp'])
            self.assertIn('new/changed without: E', g[c]['fp']['detail'])

    def test_coverage_must_not_fall(self):
        # nothing changed in the labels, but the candidate lost its ledger
        g, _ = self.run_gate(eu_doc(), eu_doc(), us_doc(), us_doc(), cand_ledger={'smpc': {}, 'uspi': {}})
        for c in ('smpc', 'uspi'):
            self.assertEqual(g[c]['fp']['status'], 'FAIL', g[c]['fp'])
            self.assertIn('without 1 (published release: 0)', g[c]['fp']['detail'])

    def test_first_release_with_a_ledger_passes_against_a_release_without_one(self):
        g, _ = self.run_gate(eu_doc(), eu_doc(), us_doc(), us_doc(), pub_ledger=None)
        for c in ('smpc', 'uspi'):
            self.assertEqual(g[c]['fp']['status'], 'pass', g[c]['fp'])
            self.assertIn('without 0 (published release: 1)', g[c]['fp']['detail'])

    def test_old_and_new_us_fingerprints_are_not_compared_with_each_other(self):
        # published: whole-record fingerprint, no ledger entry; candidate: label-only fingerprint, same text
        g, changes = self.run_gate(eu_doc(), eu_doc(), us_doc(sourceSha='f' * 64), us_doc(sourceSha='9' * 64, shaScope='label'),
                                   pub_ledger=None, cand_ledger={'smpc': {'examplo': EU_ENTRY}, 'uspi': {}})
        self.assertEqual(g['uspi']['drift']['status'], 'pass')
        self.assertIn('0 of 1 compared by source fingerprint', g['uspi']['drift']['detail'])
        self.assertEqual(changes['uspi']['sourceChangedTextSame'], [])


if __name__ == '__main__':
    unittest.main()
