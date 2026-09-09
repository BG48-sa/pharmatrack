"""Age limits mentioned in an indication text, normalised so two wordings can
be compared: "patients 12 years of age and older", "aged 12 years", "from
12 years" all become ">=12y"; "6 to < 12 years" becomes "6-12y"; "up to 17
years" becomes "<=17y". Shared by build-ema-data.py (which flags EU records
whose SmPC and EMA-table wordings disagree) and validate-release.py (the
cross-view gates)."""
import re

_NUM = {"one": "1", "two": "2", "three": "3", "four": "4", "five": "5", "six": "6", "seven": "7",
        "eight": "8", "nine": "9", "ten": "10", "twelve": "12", "eighteen": "18"}
_UNIT = {"year": "y", "years": "y", "month": "m", "months": "m", "week": "w", "weeks": "w"}
_WORDS = "|".join(_NUM)


def _n(x):
    return _NUM.get(x.lower(), x)


def _u(x):
    return _UNIT[x.lower()]


_PATTERNS = [
    (re.compile(r"(?:aged?\s+|from\s+(?:the\s+age\s+of\s+)?)?(\d+|" + _WORDS + r")\s+(years?|months?|weeks?)\s+(?:of\s+age\s+)?(?:and|or)\s+(?:older|above|over)", re.I),
     lambda m: f">={_n(m.group(1))}{_u(m.group(2))}"),
    (re.compile(r"(\d+)\s+(?:to|-|–)\s+(?:<\s?)?(\d+)\s+(years?|months?)", re.I),
     lambda m: f"{m.group(1)}-{m.group(2)}{_u(m.group(3))}"),
    (re.compile(r"(?:aged?|from(?:\s+the\s+age\s+of)?|over|above|older\s+than)\s+(\d+)\s+(years?|months?|weeks?)(?!\s+(?:and|or|to|-|–))", re.I),
     lambda m: f">={m.group(1)}{_u(m.group(2))}"),
    (re.compile(r"(?:≥|>=|at\s+least)\s*(\d+)\s+(years?|months?)", re.I),
     lambda m: f">={m.group(1)}{_u(m.group(2))}"),
    (re.compile(r"(?:up\s+to(?:\s+and\s+including)?|under|below|younger\s+than|<)\s*(\d+)\s+(years?|months?)", re.I),
     lambda m: f"<={m.group(1)}{_u(m.group(2))}"),
]


def _matches(text):
    used = []
    for rx, fn in _PATTERNS:
        for m in rx.finditer(text or ""):
            if any(a <= m.start() < b for a, b in used):
                continue
            used.append((m.start(), m.end()))
            yield m.start(), fn(m), m.group(0)


def age_thresholds(text):
    """Set of normalised age tokens, e.g. {'>=12y', '6-12y'}."""
    return {tok for _, tok, _ in _matches(text)}


def age_phrases(text):
    """The age phrases as written, in order of appearance, without repeats."""
    out = []
    for pos, _, phrase in sorted(_matches(text)):
        p = re.sub(r"\s+", " ", phrase).strip()
        if p.lower() not in (x.lower() for x in out):
            out.append(p)
    return out
