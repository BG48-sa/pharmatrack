"""Gate G8 of validate-release.py: the approval → label reconciliation queue.

Each case builds a tiny published release and a tiny candidate that hold only
pending-labels.json and reads the G8 entries of the JSON report. The other gates
fail on such a skeleton (no snapshots) — only G8 is asserted here.

Background (17.11.2026): a verified entry whose label had lost its hash blocked
every release for six days; the entry's verification was wrong (another product's
label). G8 keeps refusing a verified entry without its evidence and a silent fall
back from LABEL_VERIFIED, and accepts exactly one way back: an audited retraction.
"""
import json
import os
import tempfile
import unittest

from _helpers import run_script, script_path

LABEL = {'setId': 'set-1', 'version': '2', 'effective': '2026-10-09', 'sha256': 'a' * 64,
         'url': 'https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=set-1'}
RETRACTION = {'date': '2026-11-17', 'reason': 'set ID set-1 is the label of another product (BLA761473 / NUFYMCO), not of BLA761187',
              'verifiedSince': '2026-11-10', 'setId': 'set-1', 'version': '2', 'sha256': 'a' * 64}


def entry(id_, status, **kw):
    return {'id': id_, 'drug': id_.split(':')[1].title(), 'jurisdiction': 'FDA', 'status': status, 'statusSince': '2026-11-10', **kw}


def queue(generated, *entries):
    return {'generated': generated, 'entries': list(entries)}


class LabelQueueGate(unittest.TestCase):
    def run_gate(self, published, candidate):
        with tempfile.TemporaryDirectory() as tmp:
            pub, cand = os.path.join(tmp, 'pub'), os.path.join(tmp, 'cand')
            for base, q in ((pub, published), (cand, candidate)):
                os.makedirs(base)
                with open(os.path.join(base, 'pending-labels.json'), 'w', encoding='utf-8') as f:
                    json.dump(q, f)
            report = os.path.join(tmp, 'report.json')
            run_script(script_path('validate-release.py'), '--candidate', cand, '--published', pub, '--report', report, check=False)
            with open(report, encoding='utf-8') as f:
                rep = json.load(f)
        return {g['name']: g for g in rep['gates'] if g['id'] == 'G8'}

    PUBLISHED = queue('2026-11-10', entry('FDA:ranibizumab', 'LABEL_VERIFIED', label=LABEL), entry('FDA:zetavex', 'LABEL_VERIFIED', label=LABEL))

    def failed(self, gates):
        return sorted(n for n, g in gates.items() if g['status'] == 'FAIL')

    def test_unchanged_queue_passes(self):
        gates = self.run_gate(self.PUBLISHED, queue('2026-11-17', *self.PUBLISHED['entries']))
        self.assertEqual(self.failed(gates), [])

    def test_verified_entry_without_its_hash_fails(self):
        # the state of 10.–17.11.2026: status kept, label overwritten by a failed candidate
        broken = entry('FDA:ranibizumab', 'LABEL_VERIFIED', label={'setId': 'set-1', 'version': '3'})
        gates = self.run_gate(self.PUBLISHED, queue('2026-11-17', broken, self.PUBLISHED['entries'][1]))
        self.assertEqual(self.failed(gates), ['label queue: verified entries carry source hash + document reference'])

    def test_silent_fall_back_from_verified_fails(self):
        gates = self.run_gate(self.PUBLISHED, queue('2026-11-17', entry('FDA:ranibizumab', 'AWAITING_USPI'), self.PUBLISHED['entries'][1]))
        self.assertEqual(self.failed(gates), ['label queue: no verified hand-over regresses'])

    def test_audited_retraction_passes_and_is_named(self):
        cand = queue('2026-11-17', entry('FDA:ranibizumab', 'AWAITING_USPI', retraction=RETRACTION), self.PUBLISHED['entries'][1])
        gates = self.run_gate(self.PUBLISHED, cand)
        self.assertEqual(self.failed(gates), [])
        self.assertIn('1 new', gates['label queue: retractions audited and few']['detail'])
        self.assertIn('FDA:ranibizumab', gates['label queue: retractions audited and few']['detail'])

    def test_retraction_without_reason_or_hash_fails(self):
        for missing in ('reason', 'sha256', 'setId', 'date'):
            rt = {k: v for k, v in RETRACTION.items() if k != missing}
            cand = queue('2026-11-17', entry('FDA:ranibizumab', 'AWAITING_USPI', retraction=rt), self.PUBLISHED['entries'][1])
            failed = self.failed(self.run_gate(self.PUBLISHED, cand))
            self.assertIn('label queue: no verified hand-over regresses', failed, missing)
            self.assertIn('label queue: retractions audited and few', failed, missing)

    def test_mass_retraction_fails(self):
        ids = [f'FDA:drug{i}' for i in range(6)]
        pub = queue('2026-11-10', *(entry(i, 'LABEL_VERIFIED', label=LABEL) for i in ids))
        cand = queue('2026-11-17', *(entry(i, 'AWAITING_USPI', retraction=RETRACTION) for i in ids))
        self.assertEqual(self.failed(self.run_gate(pub, cand)), ['label queue: retractions audited and few'])

    def test_retraction_already_published_is_not_counted_again(self):
        ids = [f'FDA:drug{i}' for i in range(6)]
        both = queue('2026-11-17', *(entry(i, 'AWAITING_USPI', retraction=RETRACTION) for i in ids))
        gates = self.run_gate(both, queue('2026-11-18', *both['entries']))
        self.assertEqual(self.failed(gates), [])
        self.assertIn('0 new', gates['label queue: retractions audited and few']['detail'])


if __name__ == '__main__':
    unittest.main()
