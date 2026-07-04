// SmPC section extractor — turns an EMA product-information text dump into
// structured QRD sections. Anchors on the standardised heading numbers, bounds
// each section by the next heading, and restricts to Annex I (the SmPC) so the
// package leaflet never leaks in.
import { readFileSync, writeFileSync } from 'node:fs';

const TARGETS = {
  '4.1': 'Therapeutic indications',
  '4.3': 'Contraindications',
  '4.4': 'Special warnings and precautions for use',
  '4.8': 'Undesirable effects',
  '5.1': 'Pharmacodynamic properties',
  '5.2': 'Pharmacokinetic properties',
  '5.3': 'Preclinical safety data',
};

// Any QRD subsection heading: "4.1", "5.2", "6.1" ... followed by a Title.
const HEADING = /^[ \t]*(\d\.\d+)[ \t.]+([A-Z][^\n]{3,80})$/gm;

function cleanBody(raw) {
  return raw
    .replace(/\f/g, '\n')                              // page breaks
    .replace(/^[ \t]*\d+\/\d+[ \t]*$/gm, '')           // "12/59" page numbers
    .replace(/^[ \t]*Page \d+.*$/gim, '')
    .replace(/^[ \t]{2,}\d{1,3}[ \t]*$/gm, '')         // centred bare page numbers (indented lone 1–3 digits)
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/g, ''))             // trailing space
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')                        // collapse blank runs
    .trim();
}

function extract(file, meta) {
  let text = readFileSync(file, 'utf8').replace(/\f/g, '\n'); // page breaks → newlines so headings starting a page are still line-anchored
  // Restrict to Annex I (the SmPC): cut everything from "ANNEX II" onward.
  const annexII = text.search(/^\s*ANNEX II\b/m);
  if (annexII > 0) text = text.slice(0, annexII);

  // Collect every heading position in document order.
  const heads = [];
  let m;
  HEADING.lastIndex = 0;
  while ((m = HEADING.exec(text)) !== null) {
    heads.push({ num: m[1], title: m[2].trim(), start: m.index, end: m.index + m[0].length });
  }

  const sections = {};
  for (const [num, title] of Object.entries(TARGETS)) {
    // First heading whose number matches AND whose title looks right (guards
    // against cross-references like "(see section 4.4)").
    const idx = heads.findIndex(
      (h) => h.num === num && h.title.toLowerCase().startsWith(title.slice(0, 8).toLowerCase())
    );
    if (idx === -1) { sections[num] = { title, text: '', missing: true }; continue; }
    const bodyStart = heads[idx].end;
    const bodyEnd = idx + 1 < heads.length ? heads[idx + 1].start : text.length;
    sections[num] = { title, text: cleanBody(text.slice(bodyStart, bodyEnd)) };
  }
  return { ...meta, sections };
}

const out = {
  generated: process.env.STAMP || 'dev',
  source: 'EMA product-information (Annex I, SmPC)',
  drugs: [
    extract('iclusig.txt', {
      key: 'iclusig', brand: 'Iclusig', inn: 'ponatinib',
      url: 'https://www.ema.europa.eu/en/documents/product-information/iclusig-epar-product-information_en.pdf',
    }),
    extract('glivec.txt', {
      key: 'glivec', brand: 'Glivec', inn: 'imatinib',
      url: 'https://www.ema.europa.eu/en/documents/product-information/glivec-epar-product-information_en.pdf',
    }),
  ],
};

writeFileSync('smpc-compare.json', JSON.stringify(out, null, 2));
for (const d of out.drugs) {
  console.log(`\n=== ${d.brand} (${d.inn}) ===`);
  for (const [num, s] of Object.entries(d.sections)) {
    const chars = s.text.length;
    console.log(`  ${num} ${s.title.padEnd(42)} ${s.missing ? 'MISSING' : chars + ' chars'}`);
  }
}
