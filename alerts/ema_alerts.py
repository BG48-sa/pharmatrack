#!/usr/bin/env python3
"""PharmaTrack EMA alerts — watch the official EMA dataset and notify on changes.

On each run it downloads the EMA "Download medicine data" report, compares it to
the previous run's state, and reports two things an EMA committee member cares
about most:

  • New EU marketing authorisations  (a medicine became "Authorised")
  • New CHMP positive opinions        (a medicine entered "Opinion" status —
                                       European Commission decision ≈67 days out)

Delivery:
  --dry-run   print the digest to the terminal (no email, no state change)
  --print     write the digest to alerts/digest.html and open it (no email)
  (default)   send the digest by email via SMTP, then save the new state

Options:
  --atmp-only        only report advanced-therapy medicinal products (CAT remit)
  --area "<text>"    only report items whose therapeutic area / indication
                     contains <text> (case-insensitive); repeatable
  --state <path>     state file (default: alerts/state.json next to this script)

Credentials are read from alerts/config.env (see config.example.env) or the
environment — never hard-code them. Nothing here stores a password.

First run establishes a baseline and emails a short "monitoring started"
confirmation instead of dumping the whole catalogue.
"""
import argparse
import datetime
import json
import os
import smtplib
import ssl
import sys
import tempfile
import urllib.request
from email.message import EmailMessage
from pathlib import Path

import openpyxl

HERE = Path(__file__).resolve().parent
EMA_URL = "https://www.ema.europa.eu/en/documents/report/medicines-output-medicines-report_en.xlsx"

# Column indices in the EMA report (header row 8, data from row 9) — same as
# the app's build-ema-data.py. Keep the two in sync if EMA changes the layout.
C = dict(
    category=0, name=1, prodnum=2, status=3, inn=6, substance=7, area=8,
    atc=11, indication=15, accelerated=16, atmp=18, biosimilar=19,
    conditional=20, exceptional=21, generic=22, orphan=23, prime=24,
    holder=25, opinion=29, ma_date=31, url=38,
)


# ---------------------------------------------------------------- config -----
def load_config_env() -> None:
    """Load KEY=VALUE lines from alerts/config.env into os.environ (no override)."""
    cfg = HERE / "config.env"
    if not cfg.exists():
        return
    for line in cfg.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key, val = key.strip(), val.strip().strip('"').strip("'")
        os.environ.setdefault(key, val)


# ---------------------------------------------------------------- parse ------
def fmt_date(v):
    if v in (None, ""):
        return None
    if isinstance(v, (datetime.datetime, datetime.date)):
        return v.strftime("%Y-%m-%d")
    s = str(v).strip()
    for f in ("%d/%m/%Y", "%Y-%m-%d", "%d.%m.%Y"):
        try:
            return datetime.datetime.strptime(s[:10], f).strftime("%Y-%m-%d")
        except ValueError:
            pass
    return s[:10] or None


def yes(v):
    return str(v or "").strip().lower() == "yes"


def clean(v):
    return " ".join(str(v or "").split())


def download_report() -> Path:
    dest = Path(tempfile.gettempdir()) / "pharmatrack_ema.xlsx"
    req = urllib.request.Request(EMA_URL, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=120) as r, open(dest, "wb") as f:
        f.write(r.read())
    return dest


def parse_report(path: Path):
    wb = openpyxl.load_workbook(path, read_only=True)
    ws = wb["Medicine"]
    rows = list(ws.iter_rows(values_only=True))
    generated = fmt_date(rows[0][3]) if rows else None

    authorised, pipeline = [], []
    for i, row in enumerate(rows):
        if i <= 8 or clean(row[C["category"]]) != "Human":
            continue
        status = clean(row[C["status"]])
        item = {
            "name": clean(row[C["name"]]),
            "prodnum": clean(row[C["prodnum"]]),
            "inn": clean(row[C["inn"]]) or clean(row[C["substance"]]),
            "area": clean(row[C["area"]]),
            "atc": clean(row[C["atc"]]),
            "ind": clean(row[C["indication"]])[:300],
            "url": clean(row[C["url"]]),
            "holder": clean(row[C["holder"]]),
            "atmp": yes(row[C["atmp"]]),
            "orphan": yes(row[C["orphan"]]),
            "prime": yes(row[C["prime"]]),
            "cond": yes(row[C["conditional"]]),
            "acc": yes(row[C["accelerated"]]),
            "ma_date": fmt_date(row[C["ma_date"]]),
            "opinion": fmt_date(row[C["opinion"]]),
        }
        if status == "Authorised" and item["ma_date"]:
            authorised.append(item)
        elif status in ("Opinion", "Opinion under re-examination") and item["opinion"]:
            pipeline.append(item)
    return generated, authorised, pipeline


# Stable identity for an entry so re-runs don't re-alert. EMA product number +
# the relevant date; falls back to the name when no product number is present.
def key_auth(it):
    return f"{it['prodnum'] or it['name']}|MA|{it['ma_date']}"


def key_pipe(it):
    return f"{it['prodnum'] or it['name']}|OP|{it['opinion']}"


# ---------------------------------------------------------------- filter -----
def passes(it, atmp_only, areas):
    if atmp_only and not it["atmp"]:
        return False
    if areas:
        hay = f"{it['area']} {it['ind']} {it['inn']} {it['name']}".lower()
        if not any(a in hay for a in areas):
            return False
    return True


def flag_str(it):
    tags = []
    if it["atmp"]:
        tags.append("ATMP")
    if it["orphan"]:
        tags.append("Orphan")
    if it["prime"]:
        tags.append("PRIME")
    if it["cond"]:
        tags.append("Conditional")
    if it["acc"]:
        tags.append("Accelerated")
    return " · ".join(tags)


# ---------------------------------------------------------------- render -----
def est_decision(opinion_iso: str) -> str:
    try:
        d = datetime.date.fromisoformat(opinion_iso) + datetime.timedelta(days=67)
        return d.isoformat()
    except Exception:
        return ""


def render_html(generated, new_auth, new_pipe, baseline=False, counts=(0, 0)):
    def card(it, kind):
        flags = flag_str(it)
        flag_html = f'<div style="margin-top:6px">{badges(it)}</div>' if flags else ""
        if kind == "auth":
            right = f'<b style="color:#1d4ed8">EU MA · {it["ma_date"]}</b>'
        else:
            ed = est_decision(it["opinion"])
            right = (f'<b style="color:#4338ca">CHMP + · {it["opinion"]}</b>'
                     f'<br><span style="color:#64748b;font-size:12px">est. EC decision ~{ed}</span>')
        area = f'<div style="color:#2563eb;font-size:12px;margin-top:4px">{it["area"]}</div>' if it["area"] else ""
        link = f'<a href="{it["url"]}" style="color:#2563eb;font-size:12px">EMA page</a>' if it["url"] else ""
        return f"""
        <tr><td style="padding:12px 14px;border:1px solid #e2e8f0;border-radius:12px;background:#fff">
          <table width="100%"><tr>
            <td><b style="font-size:15px;color:#0f172a">{it['name']}</b>
                <span style="color:#64748b">— {it['inn']}</span>{area}{flag_html}
                <div style="color:#475569;font-size:12px;margin-top:6px">{it['holder']}</div>
                {link}</td>
            <td align="right" valign="top" style="white-space:nowrap;font-size:13px">{right}</td>
          </tr></table>
        </td></tr><tr><td style="height:8px"></td></tr>"""

    def badges(it):
        out = []
        for label, cond, color in [
            ("ATMP", it["atmp"], "#6d28d9"), ("Orphan", it["orphan"], "#b45309"),
            ("PRIME", it["prime"], "#be123c"), ("Conditional", it["cond"], "#475569"),
            ("Accelerated", it["acc"], "#0369a1"),
        ]:
            if cond:
                out.append(f'<span style="display:inline-block;padding:1px 6px;margin-right:4px;'
                           f'border-radius:4px;background:{color}1a;color:{color};font-size:10px;'
                           f'font-weight:700;text-transform:uppercase">{label}</span>')
        return "".join(out)

    def section(title, items, kind):
        if not items:
            return ""
        cards = "".join(card(it, kind) for it in items)
        return (f'<h2 style="font-size:16px;color:#0f172a;margin:18px 0 10px">{title} '
                f'({len(items)})</h2><table width="100%" cellpadding="0" cellspacing="0">{cards}</table>')

    head = (f'<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:640px;'
            f'margin:0 auto;color:#0f172a">'
            f'<h1 style="font-size:20px;margin:0 0 2px">PharmaTrack — EMA alert</h1>'
            f'<div style="color:#64748b;font-size:12px;margin-bottom:8px">EMA report {generated}</div>')
    if baseline:
        body = (f'<p style="font-size:14px;color:#334155">Monitoring started. Tracking '
                f'<b>{counts[0]}</b> authorised EU medicines and <b>{counts[1]}</b> medicines '
                f'with a pending CHMP opinion. You\'ll be alerted when new ones appear.</p>')
    else:
        body = (section("🆕 New EU marketing authorisations", new_auth, "auth")
                + section("⏳ New CHMP positive opinions — MA expected", new_pipe, "pipe"))
        if not body:
            body = '<p style="color:#64748b;font-size:14px">No new authorisations or opinions since the last check.</p>'
    return head + body + '<div style="color:#94a3b8;font-size:11px;margin-top:20px">Source: EMA medicine data. Verify before acting.</div></div>'


def render_text(generated, new_auth, new_pipe):
    lines = [f"PharmaTrack — EMA alert (report {generated})", ""]
    if new_auth:
        lines.append(f"NEW EU MARKETING AUTHORISATIONS ({len(new_auth)})")
        for it in new_auth:
            lines.append(f"  • {it['name']} ({it['inn']}) — {it['ma_date']} — {flag_str(it) or '—'}")
            if it["area"]:
                lines.append(f"      {it['area']}")
        lines.append("")
    if new_pipe:
        lines.append(f"NEW CHMP POSITIVE OPINIONS — MA EXPECTED ({len(new_pipe)})")
        for it in new_pipe:
            lines.append(f"  • {it['name']} ({it['inn']}) — opinion {it['opinion']}, "
                         f"est. EC ~{est_decision(it['opinion'])} — {flag_str(it) or '—'}")
            if it["area"]:
                lines.append(f"      {it['area']}")
        lines.append("")
    if not new_auth and not new_pipe:
        lines.append("No new authorisations or opinions since the last check.")
    return "\n".join(lines)


# ---------------------------------------------------------------- email ------
def send_email(subject, html, text):
    host = os.environ.get("SMTP_HOST", "smtp.gmail.com")
    port = int(os.environ.get("SMTP_PORT", "465"))
    user = os.environ.get("SMTP_USER")
    pw = os.environ.get("SMTP_PASS")
    to = os.environ.get("ALERT_TO", user)
    if not (user and pw and to):
        sys.exit("Missing SMTP_USER / SMTP_PASS / ALERT_TO — set them in alerts/config.env.")

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = user
    msg["To"] = to
    msg.set_content(text)
    msg.add_alternative(html, subtype="html")

    ctx = ssl.create_default_context()
    if port == 465:
        with smtplib.SMTP_SSL(host, port, context=ctx) as s:
            s.login(user, pw)
            s.send_message(msg)
    else:
        with smtplib.SMTP(host, port) as s:
            s.starttls(context=ctx)
            s.login(user, pw)
            s.send_message(msg)


# ---------------------------------------------------------------- main -------
def main():
    ap = argparse.ArgumentParser(description="EMA marketing-authorisation alerts")
    ap.add_argument("--dry-run", action="store_true", help="print digest, don't email or save state")
    ap.add_argument("--print", dest="to_file", action="store_true", help="write digest.html and open it")
    ap.add_argument("--atmp-only", action="store_true", help="only advanced-therapy medicines")
    ap.add_argument("--area", action="append", default=[], help="filter by area/indication text (repeatable)")
    ap.add_argument("--state", default=str(HERE / "state.json"))
    args = ap.parse_args()
    areas = [a.lower() for a in args.area]

    load_config_env()
    if os.environ.get("ALERT_ATMP_ONLY", "").lower() in ("1", "true", "yes"):
        args.atmp_only = True

    generated, authorised, pipeline = parse_report(download_report())
    authorised = [it for it in authorised if passes(it, args.atmp_only, areas)]
    pipeline = [it for it in pipeline if passes(it, args.atmp_only, areas)]

    cur_auth = {key_auth(it): it for it in authorised}
    cur_pipe = {key_pipe(it): it for it in pipeline}

    state_path = Path(args.state)
    prev = json.loads(state_path.read_text()) if state_path.exists() else None
    baseline = prev is None

    if baseline:
        new_auth, new_pipe = [], []
    else:
        prev_auth = set(prev.get("auth", []))
        prev_pipe = set(prev.get("pipe", []))
        new_auth = sorted((it for k, it in cur_auth.items() if k not in prev_auth),
                          key=lambda it: it["ma_date"], reverse=True)
        new_pipe = sorted((it for k, it in cur_pipe.items() if k not in prev_pipe),
                          key=lambda it: it["opinion"], reverse=True)

    html = render_html(generated, new_auth, new_pipe, baseline, (len(cur_auth), len(cur_pipe)))
    text = render_text(generated, new_auth, new_pipe)
    n = len(new_auth) + len(new_pipe)
    subject = (f"EMA alert — {len(new_auth)} new MA, {len(new_pipe)} new CHMP opinion"
               if not baseline else "EMA alerts — monitoring started")

    if args.dry_run:
        print(text)
        print(f"\n[dry-run] {n} new item(s); state NOT updated")
        return

    if args.to_file:
        out = HERE / "digest.html"
        out.write_text(html)
        print(f"wrote {out}")
        os.system(f'open "{out}"')
        return

    # Default: email. Skip sending an empty routine digest, but still save state.
    if baseline or n > 0:
        send_email(subject, html, text)
        print(f"emailed: {subject}")
    else:
        print("no changes — no email sent")

    state_path.write_text(json.dumps({
        "generated": generated,
        "updated": datetime.datetime.now().isoformat(timespec="seconds"),
        "auth": list(cur_auth.keys()),
        "pipe": list(cur_pipe.keys()),
    }))


if __name__ == "__main__":
    main()
