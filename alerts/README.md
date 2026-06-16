# PharmaTrack EMA alerts

A standalone watcher that emails you when something changes in the official EMA
medicines dataset:

- **🆕 New EU marketing authorisations** — a medicine just became *Authorised*.
- **⏳ New CHMP positive opinions** — a medicine entered *Opinion* status, i.e.
  the European Commission decision (and the actual MA) is ~67 days away.

It runs independently of the app — no backend, no server. Each run downloads the
EMA report, diffs it against the previous run, and emails only what's new.
Advanced-therapy (ATMP) items are flagged, and you can scope alerts to ATMPs or
to specific diseases.

## 1. Configure email (one-time)

```bash
cd alerts
cp config.example.env config.env
```

Edit `config.env`:

- `SMTP_USER` — your Gmail address.
- `SMTP_PASS` — a Google **App Password** (not your normal password). Turn on
  2-Step Verification, then create one at https://myaccount.google.com/apppasswords
  and paste it without spaces.
- `ALERT_TO` — where alerts go (defaults to `SMTP_USER`).

`config.env` is gitignored. **This is the only place a credential lives, and you
create it yourself** — the script never asks for or stores your password.

> Not on Gmail? Set `SMTP_HOST` / `SMTP_PORT` for your provider (587 uses
> STARTTLS, 465 uses SSL).

## 2. Test it

```bash
# Print the digest to the terminal — no email, no state saved:
python3 ema_alerts.py --dry-run

# Render the digest as HTML and open it in a browser:
python3 ema_alerts.py --print

# Send a real email and record the baseline (first email says "monitoring started"):
python3 ema_alerts.py
```

Use the framework `python3` that has `openpyxl` (run `which python3`; install
the dep with `python3 -m pip install openpyxl` if needed).

## 3. Schedule it (daily, macOS launchd)

```bash
cp com.berndgansbacher.pharmatrack-alerts.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.berndgansbacher.pharmatrack-alerts.plist
launchctl start com.berndgansbacher.pharmatrack-alerts   # run once now to verify
```

It runs every day at 08:00 and logs to `alerts/alerts.log`. Routine runs with no
changes send nothing. To stop: `launchctl unload ~/Library/LaunchAgents/com.berndgansbacher.pharmatrack-alerts.plist`.

## Options

| Flag / env | Effect |
|---|---|
| `--atmp-only` / `ALERT_ATMP_ONLY=true` | Only advanced-therapy medicines (CAT remit) |
| `--area "multiple sclerosis"` | Only items whose area/indication matches the text (repeatable) |
| `--dry-run` | Print, don't email or save state |
| `--print` | Write `digest.html` and open it |

Example — only gene/cell therapies, daily:
add `ALERT_ATMP_ONLY=true` to `config.env`.

## How it stays correct

`state.json` records the exact set of authorised + opinion entries seen last
run (keyed by EMA product number + date), so you're never alerted twice and a
medicine that flips opinion→authorised is reported at each genuine step. Delete
`state.json` to re-baseline.
