/**
 * "Save as PDF" for one medicine: a one- or two-page fact sheet built from the
 * detail view's data (names, EU/US status and dates, indication, sources).
 *
 * The PDF is drawn with jsPDF, loaded on first use so the main bundle stays
 * small. On iOS the file is written to the app cache and handed to the native
 * share sheet (Save to Files, Mail, Print, AirDrop…). On the web it goes to the
 * browser share sheet when that accepts files (iPhone/iPad Safari), otherwise
 * it downloads.
 */
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import type { DrugDetailData, EmaFlags } from '../types';
import { targetsOf } from './targetAgents';
import { describeUsApproval, US_COVERAGE_NOTE } from './usApproval';

const drugsAtFdaUrl = (brand: string): string =>
  `https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=BasicSearch.process&searchTerm=${encodeURIComponent(brand)}`;

const fmtDate = (val?: string): string => {
  if (!val) return '';
  if (!/^\d{4}-\d{2}/.test(val)) return val;
  const d = new Date(val.length === 7 ? `${val}-01` : val);
  if (isNaN(d.getTime())) return val;
  return d.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' });
};

const FLAG_LABELS: Array<[keyof EmaFlags, string]> = [
  ['atmp', 'Advanced therapy (ATMP)'],
  ['orphan', 'Orphan'],
  ['prime', 'PRIME'],
  ['acc', 'Accelerated assessment'],
  ['cond', 'Conditional MA'],
  ['exc', 'Exceptional circumstances'],
  ['bio', 'Biosimilar'],
  ['gen', 'Generic'],
  ['dev', 'Drug-device combination'],
];

// The built-in PDF fonts only cover Latin-1; map the typographic characters the
// data uses and drop anything else rather than print garbage.
const latin1 = (s: string): string =>
  s
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .replace(/\u2026/g, '...')
    .replace(/\u2022/g, '\u00B7')
    .replace(/\u2265/g, '>=')
    .replace(/\u2264/g, '<=')
    .replace(/\u2248/g, '~')
    .replace(/\u2192/g, '->')
    .replace(/\u2122/g, '(TM)')
    .replace(/[\u2000-\u200A\u202F\u205F]/g, ' ')
    .normalize('NFC')
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, (c) => c.normalize('NFD').replace(/[^\x20-\x7E]/g, ''));

const fileSlug = (name: string): string =>
  name.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'medicine';

/** Start loading the PDF library early, so a tap on the button is instant. */
export const preloadPdfLibrary = (): void => {
  import('jspdf').catch(() => {});
};

/** Build the PDF for one medicine. */
export const buildDrugPdf = async (d: DrugDetailData): Promise<{ bytes: ArrayBuffer; filename: string }> => {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });

  const W = 210;
  const H = 297;
  const M = 18; // side margin
  const CW = W - 2 * M; // content width
  const BOTTOM = H - 24; // keep clear of the footer
  let y = 0;

  const ink = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const;
  };
  const setText = (hex: string) => doc.setTextColor(...ink(hex));

  const ensure = (needed: number) => {
    if (y + needed > BOTTOM) {
      doc.addPage();
      y = 20;
    }
  };

  // Wrapped paragraph that can flow across pages.
  const para = (text: string, size = 10.5, color = '#1e293b', style: 'normal' | 'bold' = 'normal', lh = 1.4) => {
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    setText(color);
    const step = (size * 0.3528) * lh;
    for (const line of doc.splitTextToSize(latin1(text), CW) as string[]) {
      ensure(step);
      doc.text(line, M, y + size * 0.3528);
      y += step;
    }
  };

  const heading = (text: string) => {
    ensure(14);
    y += 4;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    setText('#64748b');
    doc.text(latin1(text.toUpperCase()), M, y + 3);
    y += 5;
    doc.setDrawColor(...ink('#e2e8f0'));
    doc.line(M, y, W - M, y);
    y += 3;
  };

  // Label / value rows, value column wrapped.
  const fact = (label: string, value: string, note?: string) => {
    const LW = 42;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10.5);
    const lines = doc.splitTextToSize(latin1(value), CW - LW) as string[];
    const noteLines = note ? (doc.setFontSize(8.5), doc.splitTextToSize(latin1(note), CW - LW) as string[]) : [];
    ensure(lines.length * 5.2 + noteLines.length * 4 + 2);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    setText('#64748b');
    doc.text(latin1(label), M, y + 3.7);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10.5);
    setText('#0f172a');
    lines.forEach((l, i) => doc.text(l, M + LW, y + 3.7 + i * 5.2));
    y += lines.length * 5.2;
    if (noteLines.length) {
      doc.setFontSize(8.5);
      setText('#64748b');
      noteLines.forEach((l, i) => doc.text(l, M + LW, y + 3 + i * 4));
      y += noteLines.length * 4;
    }
    y += 2.5;
  };

  // Tinted call-out box (expected decision / not-authorised status).
  const callout = (title: string, big: string, body: string, fill: string, edge: string, dark: string) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    const bodyLines = doc.splitTextToSize(latin1(body), CW - 10) as string[];
    const h = 8 + 7 + bodyLines.length * 4 + 5;
    ensure(h + 4);
    doc.setFillColor(...ink(fill));
    doc.setDrawColor(...ink(edge));
    doc.roundedRect(M, y, CW, h, 3, 3, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    setText(dark);
    doc.text(latin1(title.toUpperCase()), M + 5, y + 6);
    doc.setFontSize(14);
    doc.text(latin1(big), M + 5, y + 13);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    bodyLines.forEach((l, i) => doc.text(l, M + 5, y + 19 + i * 4));
    y += h + 5;
  };

  // ── Brand strip ──────────────────────────────────────────────────────────
  doc.setFillColor(...ink('#2563eb'));
  doc.rect(0, 0, W, 14, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(255, 255, 255);
  doc.text('DrugRadar', M, 9);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text('FDA + EMA medicine fact sheet', M + 22, 9);
  const created = new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' });
  doc.text(`Created ${created}`, W - M, 9, { align: 'right' });
  y = 26;

  // ── Title ────────────────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  setText('#0f172a');
  for (const line of doc.splitTextToSize(latin1(d.brandName), CW) as string[]) {
    doc.text(line, M, y);
    y += 9;
  }
  if (d.genericName && d.genericName !== '—') {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(12.5);
    setText('#475569');
    for (const line of doc.splitTextToSize(latin1(d.genericName), CW) as string[]) {
      doc.text(line, M, y - 1);
      y += 5.8;
    }
  }
  const tags = [d.badge, ...(d.emaFlags ? FLAG_LABELS.filter(([k]) => d.emaFlags?.[k]).map(([, l]) => l) : [])].filter(Boolean) as string[];
  if (tags.length) {
    y += 1;
    para(tags.join('  ·  '), 9.5, '#4338ca', 'bold');
  }
  y += 4;

  // ── Status call-outs ─────────────────────────────────────────────────────
  if (d.expectedDecision) {
    callout(
      'EU marketing authorisation expected',
      fmtDate(d.expectedDecision),
      `Estimated European Commission decision, about 67 days after the CHMP opinion${d.opinionDate ? ` of ${fmtDate(d.opinionDate)}` : ''}. The decision has not been made yet - the date and outcome may change.`,
      '#eef2ff', '#c7d2fe', '#3730a3'
    );
  }
  if (d.statusNote && !/^Conditional MA converted/.test(d.statusNote)) {
    callout(
      'EU status',
      d.statusNote.replace(/ (\d{4}-\d{2}-\d{2})$/, (_, iso) => ' · ' + fmtDate(iso)),
      `Not currently authorised in the EU. Status and date as recorded in the EMA medicine data${d.emaApprovalDate && /^\d/.test(d.emaApprovalDate) ? `; originally authorised ${fmtDate(d.emaApprovalDate)}` : ''}.`,
      '#fffbeb', '#fde68a', '#92400e'
    );
  }

  // ── Approvals ────────────────────────────────────────────────────────────
  heading('Approvals');
  const us = describeUsApproval(d.approvalDate, fmtDate);
  fact('FDA (US)', us.state === 'approved' ? `Approved ${us.date}` : us.text, us.state === 'none' ? US_COVERAGE_NOTE : undefined);
  const hasEma = !!d.emaApprovalDate && /^\d/.test(d.emaApprovalDate);
  const emaNotes = [
    d.statusNote && /^Conditional MA converted/.test(d.statusNote)
      ? `Conditional at grant, converted to full MA ${fmtDate(d.statusNote.replace(/^.* /, ''))}`
      : '',
    d.sourceNote || '',
  ].filter(Boolean).join(' · ');
  const noLongerAuthorised = !!d.statusNote && !/^Conditional MA converted/.test(d.statusNote);
  fact('EMA (EU)', hasEma ? `${noLongerAuthorised ? 'Originally authorised' : 'Authorised'} ${fmtDate(d.emaApprovalDate)}` : d.emaApprovalDate || 'No EU authorisation in app data', emaNotes || undefined);

  // ── Product ──────────────────────────────────────────────────────────────
  if (d.company || d.drugClass || d.therapeuticArea) {
    heading('Product');
    if (d.company) fact('Company', d.company);
    if (d.drugClass) fact('Drug class', d.drugClass);
    { const t = targetsOf(d.genericName); if (t.length && !d.drugClass?.startsWith('Acts on')) fact('Mechanism', `Acts on ${t.join(', ')}`); }
    if (d.therapeuticArea) {
      fact('Therapeutic area', d.therapeuticArea.split(';').map((a) => a.trim()).filter(Boolean).join(' · '));
    }
  }

  // ── Indication ───────────────────────────────────────────────────────────
  if (d.indication) {
    heading(d.indicationSource === 'summary' ? 'Indication (summary)' : 'Indication');
    for (const block of d.indication.split(/\n+/).map((b) => b.trim()).filter(Boolean)) {
      para(block);
      y += 1.5;
    }
    if (d.indicationNote) para(d.indicationNote, 8.5, '#64748b');
    if (d.indicationConflict) para(d.indicationConflict, 8.5, '#b45309');
    if (d.indicationSource === 'summary') {
      para('Summarised by DrugRadar from the FDA approval; eligibility criteria (genotype, age, prior therapy, diagnostics) may be shortened - the full label is authoritative.', 8.5, '#b45309');
    }
  }

  // ── Sources ──────────────────────────────────────────────────────────────
  heading('Official sources');
  const link = (label: string, url: string) => {
    ensure(10);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    setText('#1d4ed8');
    doc.textWithLink(latin1(label), M, y + 3.5, { url });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    setText('#64748b');
    const shown = (doc.splitTextToSize(url, CW) as string[])[0];
    doc.textWithLink(shown, M, y + 7.5, { url });
    y += 11;
  };
  if (d.emaUrl) link('EMA medicine page (EPAR, product information)', d.emaUrl);
  link('Drugs@FDA search', drugsAtFdaUrl(d.brandName));

  // ── Footer on every page ─────────────────────────────────────────────────
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setDrawColor(...ink('#e2e8f0'));
    doc.line(M, H - 17, W - M, H - 17);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    setText('#64748b');
    const disclaimer = doc.splitTextToSize(
      'Created with DrugRadar from public EMA and FDA data. For information only - not medical advice. Data may be incomplete or out of date; dates may be estimates. Always verify against the current SmPC / EPAR or FDA label.',
      CW - 22
    ) as string[];
    disclaimer.forEach((l, i) => doc.text(l, M, H - 13 + i * 3.3));
    doc.text(`${p} / ${pages}`, W - M, H - 13, { align: 'right' });
  }

  doc.setProperties({
    title: latin1(`${d.brandName} - DrugRadar fact sheet`),
    subject: 'EU and US regulatory status',
    creator: 'DrugRadar',
  });

  return { bytes: doc.output('arraybuffer'), filename: `DrugRadar-${fileSlug(d.brandName)}.pdf` };
};

const toBase64 = (bytes: ArrayBuffer): string => {
  const u8 = new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(bin);
};

/**
 * Create the PDF and hand it to the user: share sheet on iOS (native and
 * Safari), download elsewhere. Returns false only when something failed —
 * cancelling the share sheet counts as done. Never throws.
 */
export const saveDrugPdf = async (d: DrugDetailData): Promise<boolean> => {
  let pdf: { bytes: ArrayBuffer; filename: string };
  try {
    pdf = await buildDrugPdf(d);
  } catch {
    return false;
  }

  if (Capacitor.isNativePlatform()) {
    try {
      const file = await Filesystem.writeFile({
        path: pdf.filename,
        data: toBase64(pdf.bytes),
        directory: Directory.Cache,
      });
      await Share.share({ title: `${d.brandName} - DrugRadar`, files: [file.uri] });
      return true;
    } catch (err) {
      return String(err).toLowerCase().includes('cancel');
    }
  }

  const blob = new Blob([pdf.bytes], { type: 'application/pdf' });
  try {
    const file = new File([blob], pdf.filename, { type: 'application/pdf' });
    const coarse = window.matchMedia?.('(pointer: coarse)').matches;
    if (coarse && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: `${d.brandName} - DrugRadar` });
      return true;
    }
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') return true;
    // otherwise fall back to a download
  }

  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = pdf.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return true;
  } catch {
    return false;
  }
};
