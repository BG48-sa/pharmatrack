#!/usr/bin/env python3
"""Build announcements.json — FDA approvals that are ANNOUNCED but may not yet
be queryable in openFDA (whose datasets refresh on a ~weekly cycle).

Why these sources: fda.gov itself is Akamai-protected and rejects plain HTTP
clients, so the press releases are read through feeds that mirror them:
  1. Google News RSS restricted to site:fda.gov — surfaces the FDA's own
     press releases (titles verbatim, links via news.google.com redirect).
  2. Drugs.com "New Drug Approvals" feed — manufacturer announcements whose
     titles usually carry "Brand (generic)" names, which gives the app
     searchable drug names for the no-results hint.

Output (frontend/announcements.json):
  { "generated": "YYYY-MM-DD",
    "items": [ { "title": str, "url": str, "date": "YYYY-MM-DD",
                 "source": "FDA" | "Drugs.com", "names": [str, ...] } ] }

Items older than MAX_AGE_DAYS are dropped; newest first; capped at MAX_ITEMS.
Only python3 stdlib. Usage: build-announcements.py [outfile]
"""
import json
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

MAX_AGE_DAYS = 60
MAX_ITEMS = 25
UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"}

GOOGLE_FEEDS = [
    # FDA's own press releases about drug approvals, via Google News.
    'https://news.google.com/rss/search?q=site:fda.gov+%22FDA+Approves%22+when:60d&hl=en-US&gl=US&ceid=US:en',
    'https://news.google.com/rss/search?q=site:fda.gov+%22accelerated+approval%22+when:60d&hl=en-US&gl=US&ceid=US:en',
]
DRUGSCOM_FEED = 'https://www.drugs.com/feeds/new_drug_approvals.xml'

# Tokens that look like drug names but aren't. Compared lowercase.
NAME_STOPWORDS = {
    'fda', 'us', 'u.s.', 'covid', 'hiv', 'ema', 'eu', 'the', 'and', 'or',
    'update', 'updated', 'new', 'first', 'gene', 'therapy', 'chemotherapy',
}


def fetch(url: str) -> ET.Element | None:
    try:
        raw = urllib.request.urlopen(
            urllib.request.Request(url, headers=UA), timeout=25).read()
        return ET.fromstring(raw)
    except Exception as e:  # noqa: BLE001 — a dead feed must not kill the build
        print(f'[announcements] WARN: {url.split("?")[0]} failed: {type(e).__name__}', file=sys.stderr)
        return None


def parse_date(item: ET.Element) -> str | None:
    txt = item.findtext('pubDate') or ''
    try:
        return parsedate_to_datetime(txt).astimezone(timezone.utc).strftime('%Y-%m-%d')
    except Exception:  # noqa: BLE001
        return None


def extract_names(title: str) -> list[str]:
    """Pull probable drug names out of a headline: 'Rasonque (daraxonrasib)'
    yields both words. Heuristic by design — empty is fine (title still shown)."""
    names: list[str] = []
    for inner in re.findall(r'\(([A-Za-z][A-Za-z \-]{2,60})\)', title):
        for word in re.split(r'[ /]+and[ /]+|[,/]| with ', inner):
            word = word.strip().strip('-')
            if not re.fullmatch(r'[A-Za-z][A-Za-z\-]{3,}', word):
                continue
            if word.lower() in NAME_STOPWORDS or word.isupper():
                continue
            names.append(word.lower())
    # Brand name directly before an opening parenthesis.
    for brand in re.findall(r'([A-Z][A-Za-z\-]{3,})\s*\(', title):
        if brand.lower() not in NAME_STOPWORDS:
            names.append(brand.lower())
    # Bare generic names (no parentheses), recognized by INN-style suffixes —
    # e.g. "FDA approves zanidatamab-hrii and tislelizumab-jsgr for …".
    inn_suffix = re.compile(
        r'^[a-z]{2,}(?:mab|nib|sib|tinib|ciclib|parib|rasib|degib|denib|'
        r'zumab|limab|tug|tide|gene|vec|cel|stat|prazan|gliflozin|glutide|'
        r'sertib|lisib|metinib|fenib|zomib|xaban|siran|rsen)(?:-[a-z]{4})?$')
    for word in re.findall(r"[A-Za-z][A-Za-z\-]{6,}", title):
        w = word.lower()
        if inn_suffix.match(w) and w not in NAME_STOPWORDS:
            names.append(w)
            if '-' in w:
                names.append(w.split('-')[0])  # match searches without the 4-letter tail
    return sorted(set(names))


def collect() -> list[dict]:
    cutoff = (datetime.now(timezone.utc) - timedelta(days=MAX_AGE_DAYS)).strftime('%Y-%m-%d')
    items: list[dict] = []

    for feed_url in GOOGLE_FEEDS:
        root = fetch(feed_url)
        if root is None:
            continue
        for item in root.iter('item'):
            title = (item.findtext('title') or '').strip()
            # Google appends the publisher — keep only FDA's own pages.
            if not title.lower().endswith('- fda.gov'):
                continue
            title = re.sub(r'\s*-\s*fda\.gov$', '', title, flags=re.I)
            # Generic fda.gov index pages sometimes match the query ("Fast
            # Track Approvals", "What Is the Approval Process…"). Real press
            # headlines start with "FDA <verb>s …".
            if not re.match(r'(u\.s\.\s+)?fda (approves|authorizes|grants|expands|clears)\b', title, re.I):
                continue
            date = parse_date(item)
            if not date or date < cutoff:
                continue
            items.append({
                'title': title,
                'url': (item.findtext('link') or '').strip(),
                'date': date,
                'source': 'FDA',
                'names': extract_names(title),
            })

    root = fetch(DRUGSCOM_FEED)
    if root is not None:
        for item in root.iter('item'):
            title = (item.findtext('title') or '').strip()
            # Keep approval announcements only (the feed is already curated,
            # but titles like "... Submits NDA" occasionally slip in).
            if not re.search(r'approv', title, re.I):
                continue
            date = parse_date(item)
            if not date or date < cutoff:
                continue
            items.append({
                'title': title,
                'url': (item.findtext('link') or '').strip(),
                'date': date,
                'source': 'Drugs.com',
                'names': extract_names(title),
            })

    # Dedupe on normalized title, newest first, cap.
    seen: set[str] = set()
    out: list[dict] = []
    for it in sorted(items, key=lambda x: x['date'], reverse=True):
        key = re.sub(r'[^a-z0-9]', '', it['title'].lower())[:80]
        if key in seen:
            continue
        seen.add(key)
        out.append(it)
    return out[:MAX_ITEMS]


def main() -> int:
    out_path = Path(sys.argv[1] if len(sys.argv) > 1 else
                    Path(__file__).resolve().parent.parent / 'announcements.json')
    items = collect()
    if not items:
        # Never publish an empty file over a good one: leaving the previous
        # snapshot in place is strictly better than wiping the banner.
        print('[announcements] WARN: no items collected — keeping existing file', file=sys.stderr)
        return 0 if out_path.exists() else 1
    doc = {
        'generated': datetime.now(timezone.utc).strftime('%Y-%m-%d'),
        'items': items,
    }
    out_path.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    named = sum(1 for i in items if i['names'])
    print(f'[announcements] wrote {len(items)} items ({named} with drug names) -> {out_path}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
