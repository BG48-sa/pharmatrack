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
The git remote URL no longer carries a token: pushes authenticate through the macOS
keychain credential helper (`git config credential.helper` = osxkeychain; `gh auth
status` shows the account). Any personal access token that was once embedded in the
URL should be revoked at github.com → Settings → Developer settings → Tokens.

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
(`index.guarded` lists what was kept). Gate G6 checks agreement across views: curated
CBER rows must carry the age limits of the extracted US label, and EU records take their
indication wording from the SmPC extract (`indSrc: "smpc"`, `indRet` = retrieval date,
`indT` = EMA-table age phrases when the two sources disagree) — the EMA table lags the SmPC.

## EU label freshness (EMA document list + drift report)
- The weekly label job (`refresh-labels.yml`, Mondays) no longer asks EMA's PDF
  server about every label (EMA blocks after a few hundred requests — on 28.9.2026
  only 402 of 1,580 got checked). `frontend/scripts/smpc/ema-feed.mjs` downloads
  EMA's EPAR document list (`documents-output-epar_documents_json-report_en.json`,
  ~28 MB, regenerated 06:00/18:00 Amsterdam) and joins it on the EMA product number
  (`num` in ema-medicines.json, from build-ema-data.py) — that gives the real PDF
  URL (not always `<slug>-epar-product-information_en.pdf`: Arikayce, Byannli,
  Briviact) and `last_updated_date`. Only labels EMA changed are downloaded; a
  rotating sample of `HEAD_SAMPLE` (default 100) labels is still checked directly
  as an independent cross-check (`headOffset` in smpc-index.json).
- New extracts carry `emaUpdated` (the list's clock); older ones are compared via
  `retrieved` / `sourceModified` (+1 day slack — the PDF date can trail the list).
- A run that stops early keeps every label listed, records `unchecked` (checked
  first next run) and `incomplete`. Extracts of medicines no longer authorised are
  deleted (gate G5 counts those as "retired", not as vanished).
- `node frontend/scripts/smpc/drift-report.mjs` compares the whole corpus with
  EMA's list independently: labels behind EMA, authorised medicines without a
  label, labels of withdrawn medicines, incomplete run. In CI it goes to the run
  summary + artifact; problems (behind > 14 days, stale, incomplete) turn the run
  red after the commit. Run it locally any time to see the current state.

## US "Recent Approvals" + permanent release archive
- The US tab's default list comes from `frontend/us-recent.json`, rebuilt nightly by
  `frontend/scripts/build-us-recent.py` (Drugs@FDA records with any submission in the
  last 365 days → original NDA/BLA approval date per application; ANDA, OTC-only,
  medical gases and NDA chemistry type 5 dropped), merged in the app with CBER
  cell & gene therapies from the same window. openFDA alone cannot rank by FIRST
  approval — do not go back to a live `submission_status_date` sort. Gate G4 checks it.
- Every deploy of the refresh-data Action commits the published `release.json`
  (+ changes.md) to `data-releases/<release id>.json` on main — gh-pages is
  force-pushed and run artifacts expire after 90 days, so this is the permanent record.
  `release.json` → `sourcesFda.drugsfda` holds the openFDA download ledger.

