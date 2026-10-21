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
  summary + artifact; problems (behind > 14 days, stale, an incomplete run with a
  real gap — see below) turn the run red after the commit. Run it locally any
  time to see the current state.
- Ingest failures are NOT exempt from that alarm, but EMA being late is not ours:
  `smpc-index.json → failed` (reason per slug in `failedWhy`: `404` EMA serves no
  PDF yet, `fetch`, `parse`) counts as a problem once EMA's document list names
  the product-information PDF and we still have no extract 7 days later
  (`--listed-grace-days`: EMA has published, the failure is ours), or as a
  backstop 90 days after the decision with nothing listed at EMA
  (`--failed-max-days`: a broken product-number join). Before that, a medicine
  authorised via the Union Register while EMA's table still says "Opinion"
  (`ec: "register"`; on 19.10.2026 seven, Nylaspeg/Onswik 60 days) is the
  approval → label queue's warning (30 d), not a red run.
- What turns the Monday run red (drift-report `problems`): a label behind EMA
  > 14 d, a stale extract, an ingest failure as above, the EMA list unavailable,
  or an INCOMPLETE refresh with a real gap — run cut short (EMA blocking, time
  budget, download limit), a label EMA marked as changed not fetched, a label
  unchecked two runs in a row, or EMA refusing > 50 % of the rotating cross-check
  sample. Refused cross-check HEADs alone are reported, not red: the runs of
  5., 12. and 19.10.2026 were red for nothing else (12, 8 and 49 unchecked, all
  from the sample; every label EMA's list had marked as changed was downloaded).
  The extractor retries refused HEADs once after `HEAD_RETRY_PAUSE_MS` (60 s) and
  records the cause per label (`uncheckedWhy`: HTTP status / timeout / budget /
  abort + plan), a breakdown in `incomplete` (changed / sample / carry / unlisted
  / repeat / codes) and `downloadFailed` (a changed label whose download failed,
  old extract kept — it shows as "behind" and escalates after 14 d).

## US label freshness (openFDA, weekly)
- `frontend/scripts/uspi/extract-all.mjs` (CHANGED_ONLY=1, Mondays) re-checks the
  version of every stored set_id and looks up EU medicines WITHOUT a US extract
  only when eligible: EU authorisation < 120 d, FDA approval < 400 d per the app's
  US rosters (`novel-approvals.json` / `cgt-products.json`, same brand-or-unique-INN
  rule as `services/usApproval.ts` — EU-first medicines get their US label years
  later: Awiqli, Emcitate), plus a rotation of `RETRY_SAMPLE` (40) extract-less
  medicines per run (`retryOffset` in uspi-index.json). Before 14.10.2026 only the
  120-day EU window existed, so such medicines were never looked up again.
  `PLAN_ONLY=1 CHANGED_ONLY=1 node scripts/uspi/extract-all.mjs` prints the week's
  plan without touching the network or any file.

## Source-freshness watchdog (OK / STALE / FAILED per upstream source)
- The release gates check OUR files; `frontend/scripts/source-freshness.py` checks the
  DATA inside each upstream source: it records the source's own watermark (EMA report
  date, openFDA `meta.last_updated`, the EMA document list's clock, newest CDER
  novel approval, CBER/CDx list dates) next to our download time, probes the live
  sources (`--probe`: HTTP Last-Modified of EMA's files, openFDA `limit=1` meta) and
  compares with the previous run (`HEAD:frontend/freshness.json`). Thresholds per
  source are in `LIMITS` at the top of the script.
- STALE = alive but behind its cadence (warning annotation, still published; the
  app shows "EU data through … · US approvals through …" from `release.json →
  freshness.currentThrough`, never "updated today"). FAILED = publishing would be
  wrong (watermark moved backwards, count collapsed, ledger unreadable) → the daily
  job stops before commit/deploy. An openFDA lag behind FDA's own announcements is
  recorded as `lag` and stays OK up to 14 days — the Recent-Approvals overlay covers it.
- The report is committed as `frontend/freshness.json` (only a moved watermark /
  status / count counts as a change, see "Drop pure-reformatting changes"),
  published as `data/freshness.json`, summarised in the run summary, and archived
  per release as `data-releases/<id>.freshness.json`. The Monday label job runs it
  report-only. Run locally: `python3 frontend/scripts/source-freshness.py --probe`.

## Approval → label reconciliation queue (pending-labels.json)
- A medicine is shown the day it is approved, before its official label exists:
  US recent approvals carry CDER's one-line roster summary until openFDA has the
  USPI; an EU medicine carries EMA's table wording until its SmPC is extracted; a
  positive CHMP opinion waits for the EC decision, then for the product
  information. `frontend/scripts/label-reconciliation.py` (daily job, `--probe`)
  keeps one entry per such hand-over in `frontend/pending-labels.json` and moves
  it along `AWAITING_USPI | AWAITING_EC_DECISION | AWAITING_SMPC → LABEL_AVAILABLE
  → LABEL_VERIFIED` — never backwards (gate G8). Verified entries record set ID /
  version / effective date (US) or the SmPC URL + retrieval date (EU) and a SHA-256
  of the ingested text; US entries also carry the Indications and Usage text.
- US labels are looked up in three tiers: by application number, by brand under
  another application (shared label), and in `spl_product_data_elements` for
  labels openFDA has not harmonised yet (no `openfda` block — Saphnelo, Trimbow,
  Tudriqev sat there for months; the app's live query by application number
  never finds those, the queue text does). A label not linked to the application
  must be at least as new as the approval (−60 d) or it is another product.
- Thresholds (script flags): US no USPI after 45 d, EU no SmPC after 30 d,
  document detected but not ingested after 14 d, no EC decision 120 d after the
  opinion → `::warning::` + run summary + `alerts=N` output; never a stop. Entries
  leave the queue 180 d after approval once verified; unresolved ones stay.
- Published with every release (`copy-data.mjs` FILES, `release.json →
  counts.labelQueue`); the Monday label job writes the report only. The app
  (`services/labelQueue.ts`) shows "Label pending / found / verified" on US cards
  and in both detail sheets + PDF, and uses verified US text in place of a summary.
  "Drop pure-reformatting changes" ignores `lastChecked`, so a quiet day commits
  nothing. Run locally: `python3 frontend/scripts/label-reconciliation.py --probe --md /tmp/labels.md`.

## Post-authorisation audit (events vs stored labels, report only)
- `frontend/scripts/post-authorisation-audit.py` (Monday label job, step after the
  freshness watchdog; `continue-on-error`, never stops a run, changes no file in the
  repo) starts from the regulatory EVENT instead of the label source — the label
  refresh and drift report cannot see an approval whose label never moved.
- EU: EMA's post-authorisation list (`medicines-output-post_authorisation_json-report_en.json`,
  extension-of-indication opinions) joined on the EMA product number to
  `ema-medicines.json` + `smpc-data`. A positive opinion is followed by the EC decision
  (≤ 67 d) and then a new SmPC: `PENDING_EC` → `PENDING_PUBLICATION` (+14 d) →
  `VERIFIED` (our SmPC dated after the opinion) / `PENDING_INGEST` (EMA published < 14 d
  ago) / `BEHIND_EMA` (> 14 d, drift report territory) / `OVERDUE` (neither EMA's
  product information nor ours is newer than the opinion — an EC decision or EMA
  publication to look at; Trixeo Aerosphere on 21.10.2026: opinion 23.7., EMA PI still
  of 19.9.2025). Opinion ≠ EC decision.
- US: Drugs@FDA approved SUPPL submissions of class EFFICACY / LABELING on applications
  whose label we hold (`uspi-data` `usApplication`, `effective`): `PENDING` (< 45 d) /
  `VERIFIED` (label effective ≥ supplement − 14 d) / `LABEL_OLDER`. Only EFFICACY raises
  an alert; the note says whether openFDA already holds a newer version of the set ID
  (our ingest is behind) or not (the label source lags, or the supplement sits on
  another label of the same application — Wegovy tablets/injection, Tivicay PD).
- Per event it records SHA-256 of whitespace-normalised key sections (EU 4.1–4.4, US
  indications/dosage/contraindications/boxed warning/warnings); `--previous` carries
  first-seen hashes so a later run can see 4.1 / Indications move. CI does not persist
  that state yet (artifact `post-auth.json` only).
- Not a clinical check: dates + section hashes, not text equivalence. First run
  21.10.2026: 27 EU events (13 verified, 12 pending EC, 1 pending ingest, 1 overdue),
  248 US events (170 verified, 44 pending, 34 label older of which 6 efficacy).
  Run locally: `python3 frontend/scripts/post-authorisation-audit.py --md /tmp/pa.md`
  (`--no-epar`, `--skip-us`, `--ema-feed FILE` for offline use).

## Web app updates (service worker)
- Browsers install a new service worker only when `sw.js` changes byte for byte, and
  the app reloads itself only on that event (index.html `controllerchange`). A
  code-only deploy therefore never reached a long-open DrugRadar Web window until
  18.10.2026: `npm run build` now ends with `scripts/stamp-sw.mjs`, which writes the
  release id (+ commit) into `dist/sw.js` (`BUILD_STAMP`), so every deploy is a new
  worker → installs → takes control → one reload. `public/sw.js` itself is not
  rewritten. Bump `CACHE_NAME` only when the precache list or caching rules change.

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

