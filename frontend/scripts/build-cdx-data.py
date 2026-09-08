#!/usr/bin/env python3
"""Build the bundled FDA companion-diagnostic snapshot (fda-cdx.json).

WHY THIS EXISTS
  The Biomarkers tab is Europe-centred: an EU SmPC requires a *validated test*
  for a biomarker, not a named kit. In the US the FDA authorises specific
  companion diagnostic (CDx) devices for specific drug + indication pairs and
  publishes the definitive list on fda.gov. That list has no API, so this script
  turns a verbatim browser extract of it (scripts/cdx/fda-cdx-raw.json, see the
  README there) into a compact snapshot the app can search on its own and join
  onto each biomarker entry.

SOURCE
  FDA "List of FDA-Authorized Companion Diagnostic Devices (In Vitro and Imaging
  Tools)" — the `updated` field of the raw file is the page's "Content current
  as of" date and is shown in the app as the list date.

WHAT IS NORMALISED (and nothing else)
  • Whitespace, ®/™ marks, dash variants; "TM" typed as plain letters.
  • One device = one card: the FDA page spells a few devices inconsistently
    (upper/lower case, "PD-LI" for "PD-L1", a second name in brackets, three
    spellings of "Foundation Medicine, Inc."). DEVICE_FIX / key() merge those;
    every manufacturer spelling seen is kept.
  • Drug cells are parsed into brand (generic) pairs plus NDA/BLA numbers; the
    cleaned FDA wording is kept verbatim beside them. Four FDA typos in generic
    names are corrected (DRUG_FIX) so search by INN works.
  • One obviously mistyped year (08/22/0218 → 2018, a supplement between two
    2018 and 2020 supplements of the same PMA) is corrected (DATE_FIX).
  • The biomarker cell is mapped to canonical gene / marker tokens (BM_GENES)
    for matching; an unknown value aborts the build so a list update can never
    silently drop a marker.
  • The test method is derived from the device type (METHOD rules) — it is
    presented in the app as derived, not as an FDA field.

OUTPUT
  fda-cdx.json — { generated, listDate, source, total, devices: [ { name, maker,
    method, genes[], auths: [ { ind, sample, drug, drugs:[{b,g}], apps[], bm,
    det, genes[], num, date, type, hist?:[{num,date}], grp? } ] } ],
    group: [ { dev, maker, ind, sample, num, date, drugs:[{b,g}], text } ] }
"""
import collections
import datetime
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, 'cdx', 'fda-cdx-raw.json')
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, '..', 'fda-cdx.json')


def clean(s: str) -> str:
    s = (s.replace(' ', ' ').replace('®', '').replace('™', '')
         .replace('–', '-').replace('—', '-').replace('’', "'")
         .replace('“', '"').replace('”', '"'))
    s = re.sub(r'\s+', ' ', s).strip()
    s = re.sub(r'\(\s+', '(', s)
    s = re.sub(r'\s+\)', ')', s)
    s = re.sub(r'\s+,', ',', s)
    return s


# --- devices -----------------------------------------------------------------
DEVICE_FIX = {
    'Ventana PD-LI (SP263) Assay': 'Ventana PD-L1 (SP263) Assay',
    'PATHWAY anti-HER-2/neu (4B5) Rabbit Monoclonal Primary Antibody (PATHWAY anti-HER2 (4B5) antibody)':
        'PATHWAY anti-Her2/neu (4B5) Rabbit Monoclonal Primary Antibody',
    'MI Cancer Seek': 'MI Cancer Seek (MCS)',
}


def split_device(raw: str):
    """'Name (Maker)' → (name, maker); tolerates a missing bracket and the
    '(Roche Tissue Diagnostics)' note some Ventana rows carry."""
    s = clean(raw)
    note = ''
    m = re.search(r'\s*\(?Roche Tissue Diagnostics\)?\s*$', s)
    if m:
        note = 'Roche Tissue Diagnostics'
        s = s[:m.start()].rstrip(' (')
    i = s.rfind('(')
    if i < 0:
        return s, ''
    name = s[:i].strip()
    maker = s[i + 1:].strip().rstrip(')').strip()
    if note:
        maker = f'{maker} ({note})'
    name = DEVICE_FIX.get(name, name)
    return name, maker


def key(name: str) -> str:
    n = name.lower().replace('her-2', 'her2').replace('her 2', 'her2')
    return re.sub(r'[^a-z0-9]+', ' ', n).strip()


def maker_key(m: str) -> str:
    return re.sub(r'[^a-z0-9]+', ' ', m.lower()).strip()


def method_for(name: str) -> str:
    k = key(name)
    words = k.split()
    if 'fish' in words or 'breakapart' in k or 'break apart' in k or 'pathvysion' in k or 'inform her2' in k:
        return 'FISH'
    if 'cish' in words or 'dual ish' in k:
        return 'ISH'
    if 'elisa' in words or 'detectcdx' in k or 'nabcyte' in k:
        return 'Immunoassay (ELISA)'
    if 'ferriscan' in k:
        return 'MRI (imaging)'
    if 'antithrombin' in k:
        return 'Chromogenic activity assay'
    if any(w in k for w in ('ihc', 'pharmdx', 'antibody', 'rxdx', 'hercep', 'ventana', 'pd l1')):
        return 'IHC'
    if 'bracanalysis' in k:
        return 'Sequencing (NGS / Sanger)'
    if 'mychoice' in k:
        return 'NGS (HRD score)'
    if 'secore' in k:
        return 'HLA sequencing'
    if any(w in k for w in ('foundationone', 'foundationfocus', 'guardant360', 'oncomine', 'trusight', 'xt cdx',
                            'mi cancer seek', 'ctdx first', 'onco reveal', 'signatera', 'pomc')):
        return 'NGS'
    if any(w in k for w in ('cobas', 'therascreen', 'realtime', 'idylla', 'crcdx', 'kit d816v', 'leukostrat',
                            'mrdx', 'oncomate', 'ezh2', 'thxid')):
        return 'PCR'
    raise SystemExit(f'no method rule for device: {name!r}')


# --- indication / sample -----------------------------------------------------
SAMPLE_RE = re.compile(r'(?i)^(tissue|plasma|whole ?blood|serum|blood|peripheral blood|bone marrow)')


def split_ind(raw: str):
    s = clean(raw)
    for m in reversed(list(re.finditer(r'\s*-\s*', s))):
        rest = s[m.end():].strip()
        if SAMPLE_RE.match(rest):
            ind, sample = s[:m.start()].strip(), rest
            sample = sample[0].upper() + sample[1:]
            sample = re.sub(r'^Tissues$', 'Tissue', sample)
            return ind, sample
    return s, ''


# --- drugs -------------------------------------------------------------------
DRUG_FIX = {
    'gilterinib': 'gilteritinib',
    'amivantamb': 'amivantamab-vmjw',
    'dostarlimag-gxly': 'dostarlimab-gxly',
    'fam-trastuzumab deruxtecan nxki': 'fam-trastuzumab deruxtecan-nxki',
}
PAIR_RE = re.compile(r'([A-Z][A-Za-z0-9]*(?:[ -][A-Z][A-Za-z0-9]*)*)\s*\(([^()]+)\)')
APP_RE = re.compile(r'\b(NDA|BLA) (\d{6}(?:/S\d{3})?)')


def parse_drugs(raw: str):
    s = clean(raw)
    s = re.sub(r'(?<=[A-Z])TM\b', '', s)                 # "QVANTIGTM" (a ™ typed as letters)
    s = re.sub(r'\s*-\s*(NDA|BLA)\b', r' \1', s)         # "Piqray (alpelisib) - NDA 212526"
    s = re.sub(r'\b(NDA|BLA)\s*(\d{6})', r'\1 \2', s)    # "NDA210496"
    s = re.sub(r'\s*\+\s*', ' + ', s)
    drugs, seen = [], set()
    for b, g in PAIR_RE.findall(s):
        b, g = b.strip(), g.strip()
        if b == 'Imlunestrant' and g == 'Inluriyo':      # FDA lists this one brand/generic reversed
            b, g = 'Inluriyo', 'imlunestrant'
        if b.isupper():
            b = b.title()
        if re.match(r'^[A-Z][a-z]+(-[a-z]+)?$', g):
            g = g[0].lower() + g[1:]
        g = DRUG_FIX.get(g, g)
        if b.lower() not in seen:
            seen.add(b.lower())
            drugs.append({'b': b, 'g': g})
    apps = []
    for kind, num in APP_RE.findall(s):
        a = f'{kind} {num}'
        if a not in apps:
            apps.append(a)
    return s, drugs, apps


# --- submission number / date ------------------------------------------------
DATE_FIX = {'08/22/0218': '08/22/2018'}
NUM_RE = re.compile(r'([A-Z]{1,3}\d{6}(?:/S\d{3})?(?:\s*/\s*[A-Z]\d{6})?)\s*\((\d{2}/\d{2}/\s?\d{4})\)')
TYPE = {'P': 'PMA', 'K': '510(k)', 'DEN': 'De Novo', 'H': 'HDE', 'BK': '510(k) · CBER', 'BR': 'CBER'}


def parse_num(raw: str):
    s = clean(raw)
    grp = 'group labeling' in s.lower()
    s = re.sub(r'(?i)\s*group labeling.*$', '', s)
    hist = []
    for num, date in NUM_RE.findall(s):
        num = re.sub(r'\s*/\s*', ' / ', num) if re.search(r'/\s*[A-Z]\d{6}', num) else num
        date = date.replace(' ', '')
        date = DATE_FIX.get(date, date)
        mm, dd, yy = date.split('/')
        iso = f'{yy}-{mm}-{dd}'
        datetime.date.fromisoformat(iso)  # validates
        hist.append({'num': num, 'date': iso})
    if not hist:
        raise SystemExit(f'no submission number/date in {raw!r}')
    prefix = re.match(r'[A-Z]+', hist[0]['num']).group(0)
    return hist, grp, TYPE.get(prefix, prefix)


# --- biomarker cell → canonical tokens ---------------------------------------
_HER2 = ['ERBB2', 'HER2']
_DMMR = ['dMMR', 'MMR', 'MLH1', 'MSH2', 'MSH6', 'PMS2']
_NTRK = ['NTRK1', 'NTRK2', 'NTRK3', 'NTRK']
BM_GENES = {
    'EGFR (HER1)': ['EGFR', 'HER1'], 'EGFR': ['EGFR'],
    'BRAF': ['BRAF'], 'KRAS': ['KRAS'], 'KRAS and NRAS': ['KRAS', 'NRAS'],
    'ERBB2 (HER2)': _HER2, 'ERBB2/HER2': _HER2, 'ERBB2': _HER2,
    'PD-L1': ['PD-L1', 'CD274'],
    'BRCA1 and BRCA2': ['BRCA1', 'BRCA2'], 'BRCA1, BRCA2 and ATM': ['BRCA1', 'BRCA2', 'ATM'],
    'ALK': ['ALK'], 'PIK3CA': ['PIK3CA'], 'PIK3CA, AKT1, and PTEN': ['PIK3CA', 'AKT1', 'PTEN'], 'PTEN': ['PTEN'],
    'RET': ['RET'], 'MET': ['MET'], 'ESR1': ['ESR1'],
    'IDH1': ['IDH1'], 'IDH2': ['IDH2'], 'IDH1, IDH2': ['IDH1', 'IDH2'],
    'Deficient mismatch repair (dMMR) proteins': _DMMR, 'deficient mismatch repair (dMMR) proteins': _DMMR,
    'proficient mismatch repair (pMMR) proteins': ['pMMR', 'MMR'],
    'MSI-High': ['MSI-H', 'MSI'], 'Not MSI-High': ['MSS', 'MSI'], 'Microsatellite stable/MSS (Not MSI-High)': ['MSS', 'MSI'],
    'Homologous recombination repair (HRR) genes': ['HRR'], 'Myriad HRD': ['HRD'],
    'ROS1': ['ROS1'], 'FLT3 (ITD/TDK)': ['FLT3'],
    'NTRK1, NTRK2, and NTRK3 fusions': _NTRK, 'NTRK1, NTRK2 and NTRK3': _NTRK,
    'HLA': ['HLA'], 'Anti-AAV5 Antibodies': ['AAV5'], 'EZH2': ['EZH2'], 'Concizumab': ['concizumab'],
    'Liver iron concentration imaging': ['LIC'], 'FGFR2': ['FGFR2'], 'FGFR3': ['FGFR3'], 'TMB': ['TMB'],
    'ACVR2A, BTBD7, DIDO1, MRE11, RYR3, SEC31A and SULF2': ['ACVR2A', 'BTBD7', 'DIDO1', 'MRE11', 'RYR3', 'SEC31A', 'SULF2'],
    'Antithrombin III': ['AT3', 'antithrombin'], 'KIT': ['KIT'], 'KMT2A': ['KMT2A'],
    'Melanoma-associated antigen 4 (MAGE-A4)': ['MAGE-A4'], 't(9;21) Philadelphia chromosome': ['BCR-ABL1', 'Ph'],
    'AAVRh74var capsid neutralizing antibodies': ['AAVrh74'], 'AAVrh74': ['AAVrh74'],
    'PDGFRB': ['PDGFRB'], 'PDGFRA': ['PDGFRA'], 'POMC, PCSK1 and LEPR': ['POMC', 'PCSK1', 'LEPR'],
    'Circulating tumor DNA (ctDNA) molecular residual disease (MRD)': ['ctDNA', 'MRD'],
    'Claudin 18 (CLDN18)': ['CLDN18'], 'FOLR1': ['FOLR1'], 'TP53': ['TP53'],
}


def main() -> None:
    raw = json.load(open(RAW, encoding='utf-8'))
    unknown = sorted({clean(r[3]) for r in raw['rows'] if clean(r[3]) not in BM_GENES})
    if unknown:
        raise SystemExit('unmapped biomarker values (add to BM_GENES): ' + ' | '.join(unknown))

    # Canonical indication spelling: the commonest variant per case-insensitive key.
    ind_votes = collections.defaultdict(collections.Counter)
    for r in raw['rows']:
        ind, _ = split_ind(r[1])
        ind_votes[key(ind)][ind] += 1
    canon_ind = {k: c.most_common(1)[0][0] for k, c in ind_votes.items()}

    devices = {}
    for r in raw['rows']:
        if len(r) != 6:
            raise SystemExit(f'row with {len(r)} cells: {r!r}')
        name, maker = split_device(r[0])
        k = key(name)
        dev = devices.setdefault(k, {'names': collections.Counter(), 'makers': collections.defaultdict(collections.Counter), 'auths': []})
        dev['names'][name] += 1
        if maker:
            dev['makers'][maker_key(maker)][maker] += 1
        ind, sample = split_ind(r[1])
        drug, drugs, apps = parse_drugs(r[2])
        hist, grp, typ = parse_num(r[5])
        bm = clean(r[3])
        auth = {
            'ind': canon_ind[key(ind)], 'sample': sample,
            'drug': drug, 'drugs': drugs, 'apps': apps,
            'bm': bm, 'det': clean(r[4]), 'genes': BM_GENES[bm],
            'num': hist[0]['num'], 'date': hist[0]['date'], 'type': typ,
        }
        if len(hist) > 1:
            auth['hist'] = hist[1:]
        if grp:
            auth['grp'] = True
        dev['auths'].append(auth)

    out_devices = []
    for k, dev in devices.items():
        name = dev['names'].most_common(1)[0][0]
        auths = sorted(dev['auths'], key=lambda a: (a['date'], a['num']))
        genes = []
        for a in auths:
            for g in a['genes']:
                if g not in genes:
                    genes.append(g)
        makers = [c.most_common(1)[0][0] for c in dev['makers'].values()]
        out_devices.append({'name': name, 'maker': ' / '.join(makers), 'method': method_for(name),
                            'genes': genes, 'auths': auths})
    out_devices.sort(key=lambda d: key(d['name']))

    group = []
    for g in raw['group']:
        name, maker = split_device(g[0])
        ind, sample = split_ind(g[1])
        hist, _, _ = parse_num(g[2])
        text = clean(g[3])
        # The group text also writes "Melanoma (Tissue)" — keep only brand (generic) pairs.
        _, drugs, _ = parse_drugs(re.sub(r'\s*-\s*(NDA|BLA)\b', r' \1', text))
        drugs = [x for x in drugs if not re.match(r'(?i)^(tissue|plasma)', x['g'])]
        group.append({'dev': name, 'maker': maker, 'ind': canon_ind.get(key(ind), ind), 'sample': sample,
                      'num': hist[0]['num'], 'date': hist[0]['date'], 'drugs': drugs, 'text': text})

    mm, dd, yy = raw['updated'].split('/')
    total = sum(len(d['auths']) for d in out_devices)
    if total != len(raw['rows']):
        raise SystemExit(f'lost rows: {total} != {len(raw["rows"])}')
    out = {
        'generated': datetime.date.today().isoformat(),
        'listDate': f'{yy}-{mm}-{dd}',
        'source': raw['source'],
        'total': total,
        'devices': out_devices,
        'group': group,
    }
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    print(f'[build-cdx] {total} authorisations · {len(out_devices)} devices · {len(group)} group-labelling rows '
          f'· list date {out["listDate"]} → {os.path.relpath(OUT)} ({os.path.getsize(OUT)//1024} KB)')


if __name__ == '__main__':
    main()
