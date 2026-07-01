# PharmaTracker

Recent drug-approvals tracker. **React + Vite + TypeScript** frontend, **Capacitor**
iOS wrapper, plus a Python alerts service. Data from openFDA / EMA sources.

## Location & layout
- Canonical source: `~/Downloads/pharmatrack_-recent-drug-approvals` (this folder).
  Git repo, remote `github.com/BG48-sa/pharmatrack`.
- The `~/Desktop/Claude BG apps/Pharmatracker` folder is **not source** — it's only an
  alias to the built `PharmaTrack.app`. Don't edit code there.
- `frontend/` — the Vite app (`App.tsx`, `components/`, `services/`, data JSON like
  `ema-medicines.json`, `novel-approvals.json`, `pdufa.json`; `capacitor.config.ts`,
  `ios/` for the Capacitor iOS project).
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
