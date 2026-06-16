# PharmaTrack — Drug Approvals

A mobile-first reference app for FDA & EMA drug approvals and late-stage clinical
trials. React + Vite, wrapped for iOS/macOS with Capacitor. All data comes from
public regulatory APIs and bundled official snapshots — no backend, no API keys,
nothing model-generated.

## Views

- **Europe** — EU-first view built on the official EMA medicine dataset, with
  two sub-views and All / Advanced-therapy (ATMP) / Orphan / PRIME filters:
  - *Approved* — centrally authorised EU medicines, most recent marketing
    authorisation first. New medicines authorised since your last visit are
    flagged **New**.
  - *Expected* — medicines with a positive CHMP opinion but no marketing
    authorisation yet. Each shows the **estimated European Commission decision
    date** (≈67 days after the opinion) — the earliest reliable "MA is coming"
    signal. This is the EU answer to "when is MA expected?".

  Search spans disease (therapeutic area / indication), drug name, INN and ATC
  code. Each medicine opens a detail sheet with its regulatory flags (ATMP,
  orphan, PRIME, conditional, exceptional circumstances, accelerated,
  biosimilar, generic) and national-access lookups for Italy (AIFA) and
  Germany (G-BA).
- **Novel** — CDER's official "Novel Drug Therapy Approvals" lists (the headline
  new-drug roster), grouped by year. Bundled snapshot, since the FDA pages block
  scraping and the live openFDA feed lags on brand-new approvals.
- **US** — recent FDA approvals (with EMA authorisation dates and a curated
  "Coming Up" PDUFA watchlist), live from openFDA.
- **Trials** — active Phase 3 trials from the ClinicalTrials.gov v2 API.

## Data sources

| Data | Source | Where |
|------|--------|-------|
| Novel approvals | FDA CDER "Novel Drug Approvals" (Excel export) | `frontend/novel-approvals.json` ← `scripts/build-novel-approvals.py` |
| FDA approvals / labels | openFDA Drugs@FDA + label API (live) | `frontend/services/fdaService.ts` |
| EU medicines (Europe tab: authorised + CHMP-opinion pipeline, flags, areas) and EMA authorisation dates for the US tab | EMA "Download medicine data" snapshot | `frontend/ema-medicines.json` ← `scripts/build-ema-data.py` |
| CBER cell & gene therapies | FDA approved CGT products snapshot | `frontend/cgt-products.json` ← `scripts/build-cgt-data.py` |
| PDUFA watchlist | Hand-curated (sponsor/analyst-disclosed; not an official feed) | `frontend/pdufa.json` |
| Pipeline trials | ClinicalTrials.gov v2 API (live) | `frontend/services/clinicalTrials.ts` |

The bundled snapshots exist because those sources have no live/queryable API.
Regenerate any of them by re-running its `scripts/build-*.py` and committing the
updated JSON. For the novel lists, download each year's **"Export Excel"** from
the FDA page into `frontend/scripts/data/novel-<year>.xlsx` first.

## Develop

```bash
cd frontend
npm install
npm run dev      # Vite dev server
```

## Build for iOS / macOS

```bash
cd frontend
npm run ios      # vite build && cap sync ios && cap open ios
```

Then select your device in Xcode and Run. On Apple-Silicon Macs the iOS app also
runs as a Mac app.
