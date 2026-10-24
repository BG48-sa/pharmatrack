#!/usr/bin/env bash
# Refresh DrugRadar's bundled snapshot data, then redeploy if anything changed.
#
# NOTE: the GitHub Action .github/workflows/refresh-data.yml is the production
# pipeline (four slots a day, validation gates, freshness watchdog, release
# archive). This script is the laptop fallback for an offline/manual refresh
# and rebuilds the same daily snapshots, minus the Union Register fallback file
# and the published freshness report. Prefer the Action; run this to recover
# when GitHub Actions is down.
#
# What auto-updates from the internet:
#   • EMA medicines  — the official "Download medicine data" xlsx is fetched and
#                      rebuilt every run. This is the main reason to schedule it.
#
# What is only RE-PROCESSED (no live source — needs a human to drop new files):
#   • Novel approvals — FDA "Export Excel" sheets are Akamai-protected; download
#                       them by hand into frontend/scripts/data/novel-<year>.xlsx.
#   • Cell/gene Tx    — CBER has no API; products are hardcoded in build-cgt-data.py.
#   • Critical meds   — one-off snapshot, no generator script. Not touched here.
#   • US recent approvals, the approval → label queue and the freshness report
#     are rebuilt from openFDA / EMA (steps 3c–3e). Clinical trials are queried
#     LIVE by the app — nothing to do.
#
# Usage:
#   ./refresh-data.sh            # refresh, and deploy + commit if data changed
#   ./refresh-data.sh --no-deploy   # refresh only (rebuild JSON, skip publish)
#
# Exit code 0 on success (including "nothing changed").
set -euo pipefail
cd "$(dirname "$0")"

DEPLOY=1
[[ "${1:-}" == "--no-deploy" ]] && DEPLOY=0

# Python with openpyxl. The python.org 3.11 framework build has it; the system
# /usr/bin/python3 usually does not. Override with PT_PYTHON if yours differs.
PY="${PT_PYTHON:-/Library/Frameworks/Python.framework/Versions/3.11/bin/python3}"
[[ -x "$PY" ]] || PY="$(command -v python3)"

FE="frontend"
SCRIPTS="$FE/scripts"
EMA_URL="https://www.ema.europa.eu/en/documents/report/medicines-output-medicines-report_en.xlsx"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

log "Using python: $PY"
"$PY" -c "import openpyxl" 2>/dev/null || {
  log "ERROR: openpyxl not available for $PY. Set PT_PYTHON to a python that has it."
  exit 1
}

# --- 1. EMA: download the official report and rebuild -----------------------
EMA_XLSX="$(mktemp -t ema).xlsx"
trap 'rm -f "$EMA_XLSX"' EXIT
log "Downloading EMA medicines report…"
if curl -fsSL -A "Mozilla/5.0" -o "$EMA_XLSX" "$EMA_URL" && [[ -s "$EMA_XLSX" ]]; then
  log "Rebuilding ema-medicines.json"
  "$PY" "$SCRIPTS/build-ema-data.py" "$EMA_XLSX" "$FE/ema-medicines.json"
else
  log "WARN: EMA download failed — keeping the existing ema-medicines.json"
fi

# --- 2. Novel approvals: re-process any xlsx already in scripts/data ---------
if ls "$SCRIPTS"/data/novel-*.xlsx >/dev/null 2>&1; then
  log "Rebuilding novel-approvals.json from scripts/data/*.xlsx"
  "$PY" "$SCRIPTS/build-novel-approvals.py" "$FE/novel-approvals.json"
else
  log "No novel-*.xlsx in scripts/data — skipping novel rebuild"
fi

# --- 3. Cell & gene therapy: regenerate from the hardcoded product list ------
log "Rebuilding cgt-products.json"
"$PY" "$SCRIPTS/build-cgt-data.py" "$FE/cgt-products.json"

# --- 3b. FDA announcements: press-release mirror feeds (Google News/Drugs.com)
log "Rebuilding announcements.json"
"$PY" "$SCRIPTS/build-announcements.py" "$FE/announcements.json" \
  || log "WARN: announcements rebuild failed — keeping the existing file"

# --- 3c. US "Recent Approvals" (Drugs@FDA original NDA/BLA approvals, last year)
log "Rebuilding us-recent.json"
"$PY" "$SCRIPTS/build-us-recent.py" "$FE/us-recent.json" \
  || log "WARN: US recent-approvals rebuild failed — keeping the existing file"

# --- 3d. Approval → label reconciliation queue (asks openFDA / EMA) ---------
log "Updating pending-labels.json"
"$PY" "$SCRIPTS/label-reconciliation.py" --probe --json "$FE/pending-labels.json" \
  || log "WARN: label reconciliation failed — keeping the existing queue"

# --- 3e. Source-freshness report (what the app shows as "data through …") ---
log "Updating freshness.json"
"$PY" "$SCRIPTS/source-freshness.py" --probe --json "$FE/freshness.json" >/dev/null \
  || log "WARN: freshness watchdog failed — keeping the existing report"

# --- 4. Deploy only if a data file actually changed --------------------------
DATA_FILES=(
  "$FE/ema-medicines.json"
  "$FE/novel-approvals.json"
  "$FE/cgt-products.json"
  "$FE/announcements.json"
  "$FE/us-recent.json"
  "$FE/pending-labels.json"
  "$FE/freshness.json"
  "$FE/eu-register-decisions.json"
)

# The builders pretty-print, but some committed files are hand-compacted. Revert
# any file whose CONTENT is unchanged (semantically equal to HEAD) so pure
# reformatting never triggers a redeploy or clobbers a manual format.
for f in "${DATA_FILES[@]}"; do
  git cat-file -e "HEAD:$f" 2>/dev/null || continue
  if "$PY" - "$f" <<'PYEOF'
import json, subprocess, sys
f = sys.argv[1]
def norm(d):
    # Same rule as the Action's "Drop pure-reformatting changes": restamped
    # check times / ledgers are not a change, only the data itself is.
    if not isinstance(d, dict):
        return d
    if f.endswith("announcements.json"):
        return {k: v for k, v in d.items() if k != "generated"}
    if f.endswith("us-recent.json"):
        return d.get("items")
    if f.endswith("freshness.json"):
        return {"status": d.get("status"),
                "currentThrough": {k: v for k, v in (d.get("currentThrough") or {}).items() if k != "pipelineRun"},
                "sources": {k: (s.get("status"), s.get("sourceUpdatedAt"), s.get("count")) for k, s in (d.get("sources") or {}).items()}}
    if f.endswith("pending-labels.json"):
        return {"entries": [{k: v for k, v in e.items() if k != "lastChecked"} for e in d.get("entries") or []],
                "alerts": d.get("alerts")}
    return d
try:
    head = subprocess.run(["git", "show", "HEAD:" + f], capture_output=True, text=True, check=True).stdout
    sys.exit(0 if norm(json.loads(head)) == norm(json.load(open(f))) else 1)
except Exception:
    sys.exit(1)  # can't compare -> treat as changed, let git diff decide
PYEOF
  then
    git checkout -- "$f"
  fi
done

if git diff --quiet -- "${DATA_FILES[@]}"; then
  log "No data changes. Done."
  exit 0
fi

log "Data changed:"
git --no-pager diff --stat -- "${DATA_FILES[@]}" | sed 's/^/    /'

if [[ "$DEPLOY" -eq 0 ]]; then
  log "--no-deploy set — leaving changes uncommitted. Done."
  exit 0
fi

# Commit the regenerated snapshots to main so source matches what we publish.
git add -- "${DATA_FILES[@]}"
git -c user.name='Bernd Gansbacher' -c user.email='202773581+BG48-sa@users.noreply.github.com' \
    commit -q -m "Refresh bundled data $(date '+%Y-%m-%d')"
git push -q origin HEAD && log "Pushed data commit to origin" || log "WARN: push to origin failed (deploy continues)"

log "Publishing to GitHub Pages…"
./deploy-pages.sh

log "Done."
