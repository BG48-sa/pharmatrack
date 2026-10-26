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
        self.assertEqual(lr.slug_of(EPAR + 'Alphazon-previously-oldname'), 'alphazon')   # the whole "-previously-…" tail goes
        self.assertEqual(lr.slug_of(EPAR + 'spikevax-previously-covid-19-vaccine-moderna'), 'spikevax')
        self.assertEqual(lr.brand_query_terms('Bixlenvo Sunlenca Starter Pack (copackaged)'), ['Bixlenvo Sunlenca Starter', 'Bixlenvo'])
        self.assertEqual(lr.brand_query_terms('Zetavex'), ['Zetavex'])

    def test_inn_key_and_same_approval(self):
        self.assertEqual(lr.inn_key('PRITELIVIR'), lr.inn_key('pritelivir'))
        self.assertEqual(lr.inn_key('ibuprofen and famotidine'), lr.inn_key('IBUPROFEN, FAMOTIDINE'))
        self.assertEqual(lr.inn_key('semaglutide sodium'), 'semaglutide')
        self.assertNotEqual(lr.inn_key('sodium citrate'), lr.inn_key('sodium ctirate'))   # FDA typos are not guessed
        a = {'inn': 'pritelivir', 'approvalDate': '2026-10-09'}
        self.assertTrue(lr.same_approval(a, {'inn': 'PRITELIVIR', 'approvalDate': '2026-10-10'}))
        self.assertFalse(lr.same_approval(a, {'inn': 'pritelivir', 'approvalDate': '2026-10-12'}))
        self.assertFalse(lr.same_approval(a, {'inn': 'other', 'approvalDate': '2026-10-09'}))

    def test_ema_feed_names_the_real_pdf(self):
        tmp = tempfile.mkdtemp()
        try:
            rows = [{'type': 'product-information', 'last_updated_date': '2026-10-01T00:00:00',
                     'document_url': 'https://www.ema.europa.eu/en/documents/product-information/byannli-epar-product-information_en.pdf',
                     'ema_product_number': 'EMEA/H/C/005352/0000'}]
            rows += [{'type': 'product-information', 'last_updated_date': '2026-01-01',
                      'document_url': f'https://www.ema.europa.eu/en/documents/product-information/med{i}-epar-product-information_en.pdf',
                      'ema_product_number': f'EMEA/H/C/{i:06d}'} for i in range(1000)]
            rows.append({'type': 'other', 'last_updated_date': '2026-01-01', 'document_url': 'x'})
            path = os.path.join(tmp, 'feed.json')
            write_json(path, {'meta': {'timestamp': '2026-10-21T06:00:00'}, 'data': rows})
            feed = lr.load_ema_feed(path, lambda m: None)
            self.assertEqual(feed['EMEA/H/C/005352']['updated'], '2026-10-01')
            self.assertTrue(feed['slug:byannli']['url'].endswith('byannli-epar-product-information_en.pdf'))
            write_json(path, {'data': rows[:3]})
            self.assertIsNone(lr.load_ema_feed(path, lambda m: None))      # implausibly small → HEAD fallback
            self.assertIsNone(lr.load_ema_feed(None, lambda m: None))
        finally:
            shutil.rmtree(tmp)

    def test_shared_brand_label_under_another_application_passes(self):
        rec = {'openfda': {'application_number': ['NDA221104'], 'brand_name': ['BIXLENVO'], 'generic_name': ['lenacapavir'],
                           'product_type': ['HUMAN PRESCRIPTION DRUG']},
               'indications_and_usage': ['BIXLENVO is indicated for the treatment of adults with test disease who have failed prior therapy.']}
        ok, checks, _ = lr.validate_us_label(rec, 'NDA221443', 'Bixlenvo', 'lenacapavir', allow_shared=True)
        self.assertTrue(ok)
        self.assertIsNone(checks['applicationMatch'])
        self.assertEqual(checks['applicationShared'], 'NDA221104')
        ok2, checks2, _ = lr.validate_us_label(rec, 'NDA221443', 'Othername', 'otherdrug', allow_shared=True)
        self.assertFalse(lr.validate_us_label(rec, 'NDA221443', 'Bixlenvo', 'lenacapavir')[0])  # not allowed for a verified entry
        self.assertFalse(ok2)

    def test_dailymed_lookup_searches_the_salt_free_inn(self):
        terms = []
        orig_list, orig_rec = lr.dailymed_list, lr.dailymed_record
        lr.dailymed_list = lambda term: terms.append(term) or []
        lr.dailymed_record = lambda sid: None
        try:
            lr.dailymed_lookup('Simtriyo', 'centanafadine hydrochloride', '2026-07-20', lambda m: None)
        finally:
            lr.dailymed_list, lr.dailymed_record = orig_list, orig_rec
        self.assertIn('centanafadine', terms)

    def test_dailymed_list_keeps_real_list_rows(self):
        # DailyMed's list title never says "HUMAN PRESCRIPTION"; the old filter dropped every row.
        body = json.dumps({'data': [
            {'setid': 'set-utebzi', 'title': 'UTEBZI (TEBIPENEM PIVOXIL) TABLET, FILM COATED [GLAXOSMITHKLINE LLC]',
             'published_date': 'Oct 01, 2026', 'spl_version': 2},
            {'title': 'no setid row'},
        ]}).encode()
        orig = lr.http
        lr.http = lambda url, **kw: (200, {}, body)
        try:
            rows = lr.dailymed_list('Utebzi')
        finally:
            lr.http = orig
        self.assertEqual([r['setid'] for r in rows], ['set-utebzi'])

    def test_dailymed_record_rejects_an_otc_label_by_document_code(self):
        xml = ('<document xmlns="urn:hl7-org:v3"><id root="spl-9"/><code code="34390-5" displayName="HUMAN OTC DRUG LABEL"/>'
               '<setId root="set-9"/><versionNumber value="1"/><effectiveTime value="20261001"/></document>').encode()
        orig = lr.http
        lr.http = lambda url, **kw: (200, {}, xml)
        try:
            self.assertIsNone(lr.dailymed_record('set-9'))
        finally:
            lr.http = orig

    def test_dailymed_spl_is_shaped_like_an_openfda_record(self):
        xml = ('<document xmlns="urn:hl7-org:v3"><id root="spl-1"/><setId root="set-1"/><versionNumber value="3"/>'
               '<effectiveTime value="20261001"/><component><structuredBody><component><section>'
               '<subject><manufacturedProduct><manufacturedProduct><name>ZETAVEX</name>'
               '<asEntityWithGeneric><genericMedicine><name>zetamab</name></genericMedicine></asEntityWithGeneric>'
               '</manufacturedProduct><subjectOf><approval><id extension="NDA210001" root="2.16"/></approval></subjectOf>'
               '</manufacturedProduct></subject></section></component>'
               '<component><section><code code="34067-9"/><title>1 INDICATIONS AND USAGE</title>'
               '<text><paragraph>ZETAVEX is a monoclonal antibody indicated for the treatment of adult patients '
               'with relapsed or refractory test disease after two prior lines.</paragraph></text></section></component>'
               '</structuredBody></component></document>').encode()
        orig = lr.http
        lr.http = lambda url, **kw: (200, {}, xml)
        try:
            rec = lr.dailymed_record('set-1')
        finally:
            lr.http = orig
        self.assertEqual(rec['set_id'], 'set-1')
        self.assertEqual(rec['version'], '3')
        self.assertEqual(rec['effective_time'], '20261001')
        self.assertEqual(rec['openfda']['brand_name'], ['ZETAVEX'])
        self.assertEqual(rec['openfda']['application_number'], ['NDA210001'])
        self.assertIn('relapsed or refractory test disease', rec['indications_and_usage'][0])
        ok, checks, text = lr.validate_us_label(rec, 'NDA210001', 'Zetavex', 'zetamab')
        self.assertTrue(ok)
        self.assertTrue(checks['applicationMatch'])


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

    def test_brand_misspelt_at_drugsfda_is_one_medicine_with_the_roster(self):
        # Drugs@FDA: "HOVILPR" (typo), CDER roster: "Hovilpri" — same INN, same date.
        us = read_json(os.path.join(self.fe, 'us-recent.json'))
        us['items'].insert(0, {'orig': '20261009', 'application_number': 'NDA221154', 'sponsor_name': 'AICURIS AG',
                               'products': [{'brand_name': 'HOVILPR', 'active_ingredients': [{'name': 'PRITELIVIR'}]}]})
        write_json(os.path.join(self.fe, 'us-recent.json'), us)
        novel = read_json(os.path.join(self.fe, 'novel-approvals.json'))
        novel['2026'].insert(0, {'no': 46, 'brandName': 'Hovilpri', 'genericName': 'pritelivir', 'approvalDate': '2026-10-09',
                                 'indication': 'To treat mucocutaneous HSV lesions in immunocompromised adults'})
        write_json(os.path.join(self.fe, 'novel-approvals.json'), novel)
        # An earlier run already queued both spellings (the bug being fixed).
        previous = {'entries': [
            {'id': 'FDA:hovilpr', 'jurisdiction': 'FDA', 'drug': 'Hovilpr', 'inn': 'pritelivir', 'applicationNumber': 'NDA221154',
             'approvalDate': '2026-10-09', 'status': lr.S_AWAITING_USPI, 'firstSeen': '2026-10-18', 'statusSince': '2026-10-18', 'history': []},
            {'id': 'FDA:hovilpri', 'jurisdiction': 'FDA', 'drug': 'Hovilpri', 'inn': 'pritelivir', 'applicationNumber': None,
             'approvalDate': '2026-10-09', 'status': lr.S_AWAITING_USPI, 'firstSeen': '2026-10-10', 'statusSince': '2026-10-10', 'history': []},
        ]}
        q, out = run_queue(self.fe, TODAY, previous=previous)
        e = by_id(out)
        self.assertNotIn('FDA:hovilpr', e)
        h = e['FDA:hovilpri']
        self.assertEqual(h['drug'], 'Hovilpri')
        self.assertEqual(h['applicationNumber'], 'NDA221154')
        self.assertEqual(h['sources'], ['drugsfda', 'novel'])
        self.assertEqual(h['firstSeen'], '2026-10-10')
        self.assertIn('merged FDA:hovilpr into FDA:hovilpri', h['history'][-1]['note'])
        self.assertEqual([c['id'] for c in out['summary']['closed']], ['FDA:hovilpr'])
        # A verified entry under the misspelt id keeps its verified state under the new id.
        previous['entries'][0]['status'] = lr.S_VERIFIED
        previous['entries'][0]['label'] = {'setId': 'set-h', 'sha256': 'abc'}
        q, out = run_queue(self.fe, TODAY, previous=previous)
        h = by_id(out)['FDA:hovilpri']
        self.assertEqual(h['status'], lr.S_VERIFIED)
        self.assertEqual(h['label']['setId'], 'set-h')
        self.assertEqual(h['drug'], 'Hovilpri')

    def test_ema_document_list_marks_the_pdf_available_without_a_head_probe(self):
        feed = {'EMEA/H/C/006002': {'url': 'https://www.ema.europa.eu/en/documents/product-information/betarix-x-epar-product-information_en.pdf',
                                    'updated': '2026-10-15'}}
        q = lr.Queue({}, TODAY)
        lr.reconcile_us(q, self.fe, TODAY, 180, False, lambda m: None)
        lr.reconcile_eu(q, self.fe, TODAY, 180, False, lambda m: None, feed=feed)
        beta = q.get('EMA:EMEA/H/C/006002')
        self.assertEqual(beta['status'], lr.S_AVAILABLE)
        self.assertTrue(beta['label']['url'].endswith('betarix-x-epar-product-information_en.pdf'))
        self.assertEqual(beta['label']['emaUpdated'], '2026-10-15')
        # Not listed next time (and never confirmed by a HEAD probe) → back to awaiting.
        out = lr.build_output(q, TODAY, 180, THRESHOLDS, False)
        q2 = lr.Queue(out, '2026-10-22')
        lr.reconcile_us(q2, self.fe, '2026-10-22', 180, False, lambda m: None)
        lr.reconcile_eu(q2, self.fe, '2026-10-22', 180, False, lambda m: None, feed={})
        self.assertEqual(q2.get('EMA:EMEA/H/C/006002')['status'], lr.S_AWAITING_SMPC)

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
