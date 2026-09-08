# FDA companion-diagnostic list — raw extract

`fda-cdx-raw.json` is a verbatim cell-by-cell copy of the two tables on the FDA
page "List of FDA-Authorized Companion Diagnostic Devices (In Vitro and Imaging
Tools)":

https://www.fda.gov/medical-devices/in-vitro-diagnostics/list-fda-authorized-companion-diagnostic-devices-in-vitro-and-imaging-tools

fda.gov blocks scripted downloads, so the extract is taken in a browser. Open the
page, then run in the console and save the printed JSON as `fda-cdx-raw.json`
(set `updated` to the page's "Content current as of" date):

```js
const cells = (t) => [...t.querySelectorAll('tbody tr')]
  .map((tr) => [...tr.querySelectorAll('td')].map((td) => td.innerText.trim()))
  .filter((r) => r.length);
const [main, group] = document.querySelectorAll('table');
copy(JSON.stringify({ updated: '<MM/DD/YYYY>', source: location.href, rows: cells(main), group: cells(group) }));
```

`rows` = the main table (6 columns: device (manufacturer), indication – sample,
drug (generic) NDA/BLA, biomarker, biomarker details, submission number (date)).
`group` = the "Group Labeling" table (4 columns).

Then rebuild the app snapshot:

```bash
python3 scripts/build-cdx-data.py
```

which writes `frontend/fda-cdx.json` (published at /data/fda-cdx.json by
`scripts/copy-data.mjs` and searched by `services/companionDx.ts`).
