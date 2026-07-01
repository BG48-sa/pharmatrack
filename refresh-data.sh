#!/usr/bin/env bash
# Refresh DrugRadar's bundled snapshot data, then redeploy if anything changed.
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
# FDA approvals and clinical trials are queried LIVE by the app — nothing to do.
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

# --- 4. Deploy only if a data file actually changed --------------------------
DATA_FILES=(
  "$FE/ema-medicines.json"
  "$FE/novel-approvals.json"
  "$FE/cgt-products.json"
)

# The builders pretty-print, but some committed files are hand-compacted. Revert
# any file whose CONTENT is unchanged (semantically equal to HEAD) so pure
# reformatting never triggers a redeploy or clobbers a manual format.
for f in "${DATA_FILES[@]}"; do
  git cat-file -e "HEAD:$f" 2>/dev/null || continue
  if "$PY" - "$f" <<'PYEOF'
import json, subprocess, sys
f = sys.argv[1]
try:
    head = subprocess.run(["git", "show", "HEAD:" + f], capture_output=True, text=True, check=True).stdout
    sys.exit(0 if json.loads(head) == json.load(open(f)) else 1)
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
git -c user.name='Bernd Gansbacher' -c user.email='bernd.gansbacher@gmail.com' \
    commit -q -m "Refresh bundled data $(date '+%Y-%m-%d')"
git push -q origin HEAD && log "Pushed data commit to origin" || log "WARN: push to origin failed (deploy continues)"

log "Publishing to GitHub Pages…"
./deploy-pages.sh

log "Done."
