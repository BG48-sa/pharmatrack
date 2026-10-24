# PharmaTracker

Recent drug-approvals tracker. **React + Vite + TypeScript** frontend, **Capacitor**
iOS wrapper, Python/Node data scripts run by GitHub Actions. Data from openFDA / EMA sources.

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
- The legacy `alerts/` e-mail watcher (launchd, Gmail app password) was removed on
  22.10.2026 — it had not run since the repo moved folders in June 2026; its local
  files are archived outside the repo in `~/Downloads/Wissenschaft & KI/pharmatrack-alerts-archive-2026-10-22/`.

## Building a release on the Mac — remember this
- Before any build, `git pull` in the project folder. If it refuses with "Your local
  changes would be overwritten … project.pbxproj", Xcode has edited the project file
  locally (version/build set in its UI, or housekeeping). Run
  `git checkout -- frontend/ios/App/App.xcodeproj/project.pbxproj`, then pull again.
  If the pull works, nothing to do. This has NOTHING to do with Apple's review.
- After a Mac build, record the version/build in `App.xcodeproj` on main (done for
  2.0.5/35 and 2.0.6/36), otherwise the next build reuses a number Apple rejects.
- Tell Bernd plainly, step by step; he follows from the iPhone or Mac screenshots.

## Running
From repo root: `npm run dev` (frontend dev server), `npm run build`, `npm run ios`.

## Checks (run before every commit; the deploy job runs them too)
- `npm ci` — install exactly what `package-lock.json` records (root lockfile, workspace `frontend`).
- `npm run check` = `npm run typecheck` (`tsc --noEmit`, strict, `frontend/tsconfig.json`) +
  `npm test` (Python `unittest` fixture tests in `frontend/scripts/tests/` for
  label-reconciliation.py, build-ema-data.py incl. the Union Register path, and
  build-novel-approvals.py; stdlib + openpyxl only, no network).
- `npm audit` — dependencies are pinned to exact versions; the accepted remaining
  finding is documented in `frontend/scripts/tests/README.md`.

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

## Audit fixes of 24.10.2026 (Gemini review, verified against the repo)
- GitHub starts `schedule` runs hours late (06:17 UTC slot began 11:30–13:00 UTC,
  Monday 04:30 → 10:11–12:21 UTC). The daily job now has four earlier slots
  (03:41 / 08:41 / 13:41 / 18:41 UTC) so the delayed start lands in the intended
  window; the label job runs Mondays 00:41 UTC. Quiet slots publish nothing. If the
  delays persist, an external trigger (`gh workflow run` from a cron elsewhere)
  would start within seconds — needs a PAT, not done.
- One medicine, two spellings: Drugs@FDA listed pritelivir as "HOVILPR", the CDER
  roster as "Hovilpri" → two US cards and two queue entries. `recentFromSnapshot()`
  and `us_candidates()` now match a roster entry to a Drugs@FDA row on INN +
  approval date (±1 d, salts/"and" ignored — `innKey`/`inn_key`) and take the
  roster's spelling; `Queue.rename()` merges the queue entries (the further-advanced
  state wins, history records the merge). FDA's own ingredient typos ("sodium
  ctirate", "calcuim chloride", NDA219455/6) are NOT guessed.
- `slug_of()` in label-reconciliation.py and build-ema-data.py stripped only the
  literal `-previously-` (spikevax-previously-covid-19-vaccine-moderna →
  `spikevaxcovid-19-vaccine-moderna`); now the whole tail goes, as in extract-all.mjs.
- label-reconciliation.py: `--ema-feed FILE` (the daily job downloads EMA's EPAR
  document list) marks EU product information LABEL_AVAILABLE from the list (real
  PDF URL + EMA's date) instead of HEAD-probing a guessed URL; HEAD remains the
  fallback. US lookups: a co-packaged brand ("Bixlenvo Sunlenca Starter Pack") is
  retried by its first word; tier 4 asks DailyMed's REST API (`spls.json` +
  SPL XML, Indications section LOINC 34067-9) when openFDA has nothing — the
  label carries `source: DailyMed …`, `harmonised: false`.
- source-freshness.py: `ema_epar_documents` is STALE for an incomplete label run
  only when it left a real gap (same rule as drift-report.mjs, `incomplete_gap()`);
  refused cross-check HEADs are a note. Two curated snapshots are now watched by
  age: `eu_critical_medicines` (400 d) and `biomarkers_table` (180 d).
- The Monday job commits `frontend/post-auth.json` and passes it as `--previous`,
  so section-hash changes (4.1 / Indications) are seen across weeks.
- `refresh-data.sh` (laptop fallback) rebuilds all daily snapshots now;
  `deploy-pages.sh` no longer claims a token in the remote URL.
- AccessStatus.tsx: EU HTA joint clinical assessment, France (HAS), Spain (AEMPS
  IPT) and UK (NICE) links next to AIFA / G-BA.

## Deploy from a committed tree only (refresh-data.yml, 24.10.2026)
- Two push-triggered runs 30 s apart (merges of #5 and #6) both rewrote the daily data;
  the later run's `git pull --rebase` conflicted on freshness.json / pending-labels.json,
  the retry loop fell through WITHOUT failing, and the deploy built from the half-merged
  tree: the live site carried conflict markers in `data/pending-labels.json` and no
  `data/freshness.json` for ~15 minutes until a forced redeploy. Now: the data commit
  rebases with `-X theirs` (this run's fresh files win), aborts a failed rebase, and the
  step fails after 3 attempts; the deploy step refuses to run with a rebase/merge in
  progress, uncommitted data files or conflict markers; the archive step fails loudly too.
  Overlapping runs are expected (push + schedule); the concurrency group does not
  serialise a run that is already past checkout.

## EU Union Register outage fallback (eu-register-decisions.json)
- The Commission's register page (`ec.europa.eu/.../reg_last.htm`; the old `newproc.htm`
  address only redirects there over plain http, so since 21.10.2026 the workflow reads
  `reg_last.htm` directly) is sometimes down for
  hours and then serves "Server temporarily unavailable" with HTTP 200 (after a redirect
  to sorry.ec.europa.eu) — on 21.10.2026 07:40 UTC the daily run read it as 0 decisions,
  the freshness watchdog saw 44 → 0 ("count collapsed") and stopped the deploy (correctly;
  the previous release stayed live). Now: the download step accepts a page only if it has
  `{"cat":` decision records (3 tries, 30 s apart); otherwise `build-ema-data.py` falls back
  to `frontend/eu-register-decisions.json` (the decisions of the last good download, written
  on every good run, committed with the daily data). Decisions are never revoked, so only
  the new decisions of the outage are missed; the freshness report marks the source STALE
  ("served from the last good download"), never FAILED. Seeded 21.10.2026 from the raw page
  of the successful 20.10. run (artifact `release-inputs-<run>`, 44 decisions).

## US labels: manufacturer's label, not a repackager's (extract-all.mjs)
- Repackagers (A-S Medication Solutions, Cardinal Health 107, NuCare, ProPharma …) file
  their own SPL under the manufacturer's NDA/BLA number and rarely update it. Until
  21.10.2026 the selection broke ties inside an application arbitrarily: 85 of 1,255 US
  extracts were repackager copies — Wegovy (A-S, 2024: no MASH), Mounjaro (no CV-risk
  indication), Januvia, Jardiance, Xarelto, Eliquis …
- Now (`better()` + `REPACKAGER` in extract-all.mjs): old score first, then not a
  repackager, then the earliest application, then the newest version. `usLabeler` is
  stored per extract (null = label not harmonised at openFDA).
- The weekly changed-only run re-selects any stored label whose current openFDA record is
  a repackager's (`reselect`): one brand query per medicine (limit 1000 — a 20-brand batch
  capped at 250 would cut the manufacturer's label off), the stored route kept (Ozempic:
  Novo's harmonised label under that brand is the oral tablet), and — when only
  repackagers remain — tier 3: unharmonised labels found via `spl_product_data_elements`
  whose DailyMed labeler (title "[…]", browser UA needed) is not a repackager and which are
  at most 180 days older than the reprint (Wegovy, Tivicay, Biktarvy, Levemir, NovoRapid
  are unharmonised at openFDA). Fields an unharmonised record lacks (application, route,
  generic) come from the repackager record of the same product or the previous extract.
- The app's US cards (services/fdaService.ts) use the same rule live: Drugs@FDA is
  searched by `products.brand_name` too (openfda.* is empty until openFDA harmonises
  an application — Wegovy fell through to a repackager's label record with "Not in app
  data" as approval date), live label records are ordered manufacturer-first then
  newest, and when the pipeline holds a same-product label (`services/usLabels.ts`,
  index `match: 'brand'`, file hash-checked against the release via
  `services/labelFiles.ts`) its Indications and Usage replaces the live text, in full in
  the detail sheet (`indicationFull`). labelFiles.ts imports nothing app-specific — the
  loader used to live in liveData.ts, which imports fdaService (import cycle).
- The write guard's "version went backwards" now applies only within one set ID (moving
  from a reprint to the manufacturer's label may go to an older version date).

## Post-authorisation audit (events vs stored labels, report only)
- `frontend/scripts/post-authorisation-audit.py` (Monday label job, step after the
  freshness watchdog; `continue-on-error`, never stops a run, changes no file in the
  repo) starts from the regulatory EVENT instead of the label source — the label
  refresh and drift report cannot see an approval whose label never moved.
- EU: EMA's post-authorisation list (`medicines-output-post_authorisation_json-report_en.json`,
  extension-of-indication opinions) joined on the EMA product number to
  `ema-medicines.json` + `smpc-data`. A positive opinion is followed by the EC decision
  (≤ 67 d) and then a new SmPC. EMA's own product-information date (EPAR document list)
  decides: newer than the opinion → `VERIFIED` once ours is at least as new (after the
  67-day window) / `PENDING_INGEST` (EMA published < 14 d ago) / `BEHIND_EMA` (> 14 d);
  still older than the opinion → `PENDING_EC` (≤ 67 d) → `PENDING_PUBLICATION` (+14 d) →
  `OVERDUE` (an EC decision or EMA publication to look at; 21.10.2026: Trixeo Aerosphere,
  opinion 23.7., EMA PI of 19.9.2025; Palynziq, opinion 21.5., EMA PI of 12.7.2024). Our
  download date is never evidence on its own (it once passed Palynziq as verified); without
  EMA's date only `emaUpdated`/`sourceModified` can verify, else `UNVERIFIABLE`. EMA's
  product numbers carry stray spaces ("EMEA/H/C/005679 ") — stripped. Opinion ≠ EC decision.
- US: Drugs@FDA approved SUPPL submissions of class EFFICACY / LABELING on applications
  whose label we hold (`uspi-data` `usApplication`, `effective`): `PENDING` (< 45 d) /
  `VERIFIED` (label effective ≥ supplement − 14 d) / `LABEL_OLDER`. Only EFFICACY raises
  an alert; the note says whether openFDA already holds a newer version of the set ID
  (our ingest is behind) or not, naming the label's labeler — on 21.10.2026 the flags for
  Wegovy, Mounjaro and Tivicay were repackager copies (see "US labels: manufacturer's
  label, not a repackager's" below).
- Per event it records SHA-256 of whitespace-normalised key sections (EU 4.1–4.4, US
  indications/dosage/contraindications/boxed warning/warnings); `--previous` carries
  first-seen hashes so a later run can see 4.1 / Indications move. CI does not persist
  that state yet (artifact `post-auth.json` only).
- Not a clinical check: dates + section hashes, not text equivalence. First run
  21.10.2026 (after the EU fix): 27 EU events (12 verified, 11 pending EC, 2 pending ingest, 2 overdue),
  248 US events (170 verified, 44 pending, 34 label older of which 6 efficacy).
  Run locally: `python3 frontend/scripts/post-authorisation-audit.py --md /tmp/pa.md`
  (`--no-epar`, `--skip-us`, `--ema-feed FILE` for offline use).

## Label comparison: "Highlight differences" (services/labelDiff.ts)
- `LabelComparePanel.tsx` has a toggle (two-label comparisons only; default on,
  remembered in localStorage `labelCompare.highlight`) that colours a sentence-level
  comparison of the two columns, plus a "Differences only" switch (`labelCompare.onlyDiff`)
  that hides matching sentences and keeps each difference under its heading.
- `diffSections()`: units = sentences per line (an aligned pdftotext table block is one
  unit; the US "1 INDICATIONS AND USAGE" / "1.5 Classical Hodgkin Lymphoma" titles are
  stripped off their first sentence; short lines without punctuation/digits and "▸ BRAND
  25 mg/mL …" presentation lines are `heading`, never a difference). Matching: tokens are
  folded across the two regulatory dialects first (PHRASES/SYNONYMS: single agent =
  monotherapy, adolescents/children = pediatric, British → American spelling, tumour/
  carcinoma → cancer, NSCLC/HNSCC/RCC/cHL/… expanded, q3w = every 3 week), cross-reference
  markers removed, then IDF-weighted similarity = max(Dice, 0.85 × overlap coefficient) so
  a short US Highlights claim contained in a long EU sentence still pairs; greedy best
  pair first at `MATCH_THRESHOLD` 0.4, and a unit left over may pair with an already
  matched counterpart (the SmPC repeats 4.1 per presentation, the PI has Highlights +
  full text — a repeat is not a difference). Marks: unmatched = "only in" that label
  (rose = column 1, emerald = column 2, dotted underline), matched with unshared tokens
  = "wording differs" (amber;
  only numbers and clinically decisive words — `DECISIVE`: negations, setting/line, population, route, biomarker, severity — are painted, population words only against a stated population on the other side (`POPULATION`); "patients", "undergone", "every … weeks" are style, not substance), differing NUMBERS always (red, wavy). Colour is always
  paired with a decoration (colour-vision deficiency, greyscale print). Each unit carries
  `pair` (index on the other side). Keytruda 4.1 on 24.10.2026: 4 only EU · 21 only US
  · 71 differ in ~80 ms (before tuning: 69 · 59 · 39 — mostly noise).
- It is a text comparison, not a clinical judgement: a rephrased claim can still show as
  "only in" one label, and a weak pair (≈0.4) can be wrong; the footer says so. Tune in
  `labelDiff.ts` (thresholds, PHRASES, SYNONYMS). Tests:
  `scripts/tests/label-diff.test.mjs` (`node --test --experimental-strip-types`, in `npm test`).

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

