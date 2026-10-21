# FDA companion-diagnostic list — raw extract

`fda-cdx-raw.json` is a verbatim cell-by-cell copy of the two tables on the FDA
page "List of FDA-Authorized Companion Diagnostic Devices (In Vitro and Imaging
Tools)":

https://www.fda.gov/medical-devices/in-vitro-diagnostics/list-fda-authorized-companion-diagnostic-devices-in-vitro-and-imaging-tools

fda.gov blocks scripted downloads (even curl with a browser user agent gets a
404), so the extract is taken in a browser. Since autumn 2026 the main table is a
paginated DataTable that shows 10 rows at a time and hides columns on narrow
windows, so the snippet first switches it to "all rows" and reads the cells'
text with line breaks (`<br>` and paragraphs) instead of `innerText`, which is
empty for hidden columns. Open the page, run this in the console and save the
printed JSON as `fda-cdx-raw.json` (set `updated` to the page's "Content
current as of" date):

```js
jQuery('#DataTables_Table_0').DataTable().page.len(-1).draw();
const txt = (td) => {
  const c = td.cloneNode(true);
  c.querySelectorAll('br').forEach((b) => b.replaceWith('\n'));
  c.querySelectorAll('p,div,li').forEach((e) => { e.prepend('\n'); e.append('\n'); });
  return c.textContent.replace(/[ \t\u00a0]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{2,}/g, '\n').trim();
};
const cells = (t) => [...t.querySelectorAll('tbody tr')]
  .filter((tr) => !tr.classList.contains('child'))
  .map((tr) => [...tr.querySelectorAll('td')].map(txt))
  .filter((r) => r.length);
const [main, group] = document.querySelectorAll('table');
copy(JSON.stringify({ updated: '<MM/DD/YYYY>', source: location.href, rows: cells(main), group: cells(group) }));
```

The daily freshness watchdog (`scripts/source-freshness.py --probe`) asks
openFDA's `device/pma` endpoint for companion-diagnostic decisions made after
the list date and marks this source STALE when the snapshot misses one for
more than 30 days — that is the signal to redo the extract.

`rows` = the main table (6 columns: device (manufacturer), indication – sample,
drug (generic) NDA/BLA, biomarker, biomarker details, submission number (date)).
`group` = the "Group Labeling" table (4 columns).

Then rebuild the app snapshot:

```bash
python3 scripts/build-cdx-data.py
```

which writes `frontend/fda-cdx.json` (published at /data/fda-cdx.json by
`scripts/copy-data.mjs` and searched by `services/companionDx.ts`).
