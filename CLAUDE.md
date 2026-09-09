# PharmaTracker

Recent drug-approvals tracker. **React + Vite + TypeScript** frontend, **Capacitor**
iOS wrapper, plus a Python alerts service. Data from openFDA / EMA sources.

## Location & layout
- Canonical source: `~/Downloads/Wissenschaft & KI/pharmatrack_-recent-drug-approvals`
  (this folder). Git repo, remote `github.com/BG48-sa/pharmatrack`.
- The `~/Desktop/Claude BG apps/Pharmatracker` folder is **not source** — it's only an
  alias to the built `PharmaTrack.app`. Don't edit code there.
- `frontend/` — the Vite app (`App.tsx`, `components/`, `services/`, data JSON like
  `ema-medicines.json`, `novel-approvals.json`, `pdufa.json`, `announcements.json`
  (FDA press-release mirror bridging the ~weekly openFDA lag; rebuilt by
  `scripts/build-announcements.py`, daily via the refresh-data GitHub Action);
  `capacitor.config.ts`, `ios/` for the Capacitor iOS project).
- `alerts/` — Python alert poller (`ema_alerts.py`) run via a launchd plist.

## Running
From repo root: `npm run dev` (frontend dev server), `npm run build`, `npm run ios`.

## Distribution
- **GitHub Pages PWA**: deployed via `deploy-pages.sh` to repo `bg48-sa/pharmatrack`.
  Install through Safari; no Apple certificate needed.
- **Mac app** (iOS app running on Mac): does NOT auto-update — rebuild and reinstall
  to get changes. After reinstalling, macOS Gatekeeper blocks first launch; the user
  must "Open Anyway" in System Settings → Privacy & Security.

## Note
The git remote URL has a hardcoded PAT — should be rotated and moved to a credential
helper (do not commit or echo the token).

## Data release gates
Every data release is validated before it is committed or deployed. The nightly
Action downloads the raw inputs (EMA report xlsx, EU Union Register page), rebuilds
the snapshots, then runs `frontend/scripts/validate-release.py` against the data/
folder of the `gh-pages` branch (what users currently see). A failing gate stops the
job: nothing is committed, nothing is deployed, the previous release stays live on the
web and in the native apps. Raw inputs, hashes and the validation report are kept as
workflow artifacts for 90 days; `public/data/release.json` carries the pipeline commit,
counts and source hashes. Run the same check locally before committing a manual label
extraction: `python3 frontend/scripts/validate-release.py --published-ref origin/gh-pages`
(fetch first: `git fetch --depth=1 origin +gh-pages:refs/remotes/origin/gh-pages`).
The label extractors also refuse to overwrite a good per-drug file with a degraded one
(`index.guarded` lists what was kept).
