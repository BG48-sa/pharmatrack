# Data-script tests and dependency hygiene

## Running

From the repo root (or `frontend/`):

```bash
npm run check      # = npm run typecheck (tsc --noEmit, strict) + npm test
npm test           # python3 -m unittest discover -s scripts/tests
```

Only `python3` (3.11+) and `openpyxl` are needed — the same as the GitHub
Actions jobs install. No network access: every test works on small fixture
files written into a temporary folder. The deploy job (`refresh-data.yml`,
step "Install, type-check and test") runs the same `npm run check` before it
builds; a failing check stops the deploy and the previous release stays live.

| File | Script under test | What is covered |
|---|---|---|
| `test_label_reconciliation.py` | `label-reconciliation.py` | queue membership from the three US sources + EMA table; opinion → authorisation → SmPC-verified chain; "never regress a verified label" (gate G8); alert thresholds; retention and medicines leaving the EMA catalogue; US label validation against fake openFDA records (application match, brand, unharmonised SPL record, older label of another product); Markdown report; one end-to-end command-line run incl. `$GITHUB_OUTPUT` |
| `test_source_conflicts.py` | `source-conflicts.py` | the cross-source conflict report (Monday label job, report only): approval-date and active-ingredient disagreements between Drugs@FDA, the CDER roster and the CBER list (salts ignored), an announcement dated before the approval, a stored US label older than its application's approval (note ≤ 30 d, conflict beyond), EMA's table vs the Union Register decision date (note at one day), opinion-after-authorisation for recent records only, a queue entry whose source date moved, Markdown report and one command-line run incl. `$GITHUB_OUTPUT` / `--fail-on-conflict` |
| `test_build_ema_data.py` | `build-ema-data.py` | positional column layout (refuses to build when a header moved); authorised / opinion / negative / withdrawn rows; EC-decision-date fallback; **EU Union Register**: a positive opinion the Commission has decided is published as authorised with `ec: "register"`, older decisions are ignored, non-authorisation decision types and veterinary records are skipped, malformed lines are tolerated; the last-good-download cache (`eu-register-decisions.json`) is written on a good run and used when the Commission serves its outage page |
| `test_build_novel_approvals.py` | `build-novel-approvals.py` | CDER "Export Excel" roster parsing: glued link labels, non-breaking spaces, M/D/YYYY dates, a brand name glued into another drug's indication, newest-first sort, year ordering, unrecognised files |

`build-ema-data.py` runs at import time (it is a command-line tool), so its
test copies the script and `agephrases.py` into a temporary folder and runs
it there as a subprocess — the real `.sources.json` and `smpc-data/` are never
touched.

## Dependencies (`npm ci`, `npm audit`)

- Every dependency in `frontend/package.json` is pinned to an exact version;
  the root `package-lock.json` is the single source of truth and `npm ci`
  installs exactly that (and fails if the two disagree). Upgrades are
  deliberate commits, never a side effect of `npm install`.
- `npm audit` on 22.10.2026, before: 18 findings (3 critical, 12 high).
  Most came from one dev-only tool, `@capacitor/assets` (icon generator),
  which dragged in an old `@capacitor/cli` 5, `sharp`, `handlebars`, `tar` 6,
  `xmldom`, `minimatch` 3 … It is not used by any script and the icons are
  generated; it was removed (run it on demand with `npx @capacitor/assets`
  when the icon changes). `vite` 8.0.16 → 8.3.5 (dev-server advisories,
  minor update, build verified), `@capacitor/cli|core|ios` 8.4.0 → 8.5.3
  (GHSA-rvm3-566m-v7fv, remote content at the app origin — fixed in 8.4.3;
  the iOS project picks the new runtime up at the next `cap sync` / build,
  which must be simulator-checked as always), `npm audit fix` for the
  transitive `tar`, `@xmldom/xmldom`, `brace-expansion`, `dompurify`.
- **Accepted (documented) finding**: `uuid` < 11.1.1 (moderate,
  GHSA-w5hq-g745-h8pq) via `xcode` 3.0.1 via `@capacitor/cli`. The CLI is a
  build-time tool (`cap sync`), never part of the shipped web or iOS bundle,
  and the advisory concerns `uuid.v3/v5/v6` with a caller-supplied buffer,
  which `xcode` does not use. `npm audit` offers only a downgrade of the CLI
  as a "fix"; re-check when `xcode` releases a version on `uuid` ≥ 11.1.1.
