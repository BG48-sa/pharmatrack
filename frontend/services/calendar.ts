/**
 * Calendar export of estimated EU decision dates.
 *
 * Builds a standards-compliant .ics (RFC 5545) with one all-day event per
 * pending decision, including the estimate disclaimer and a reminder alarm
 * three days before (matching the local-notification lead time). On iOS the
 * file is written to the app cache and handed to the native share sheet —
 * "Add to Calendar" is one tap from there, and no calendar permission is
 * needed because the user performs the import themselves. On the web build
 * it falls back to a plain .ics download.
 */
import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

export interface DecisionEvent {
  drug: string;
  inn?: string;
  indication?: string;
  date: string; // estimated EC decision date, YYYY-MM-DD
}

const DISCLAIMER =
  'Estimated date (~67 days after the CHMP opinion) - may change or not occur. ' +
  'Not an official notification from any authority. Not medical advice. ' +
  'Verify via the official EMA register. Exported from DrugRadar.';

// RFC 5545: escape backslash, semicolon, comma, newline in text values.
const esc = (s: string): string =>
  s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

// RFC 5545 §3.1: fold content lines longer than 75 octets (continuation lines
// start with a space). We fold on characters, which is safe for our ASCII text.
const fold = (line: string): string => {
  if (line.length <= 75) return line;
  const parts: string[] = [line.slice(0, 75)];
  for (let i = 75; i < line.length; i += 74) parts.push(' ' + line.slice(i, i + 74));
  return parts.join('\r\n');
};

const ymd = (iso: string): string => iso.replace(/-/g, '');

const nextDay = (iso: string): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

// Deterministic UID so re-importing the same event updates instead of duplicating.
const uid = (e: DecisionEvent): string => {
  const s = `${e.drug}::${e.date}`;
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return `dr-${Math.abs(h)}@drugradar`;
};

/** Build the .ics text for the given decisions (invalid dates are skipped). */
export const buildIcs = (events: DecisionEvent[]): string => {
  const stamp = `${ymd(new Date().toISOString().slice(0, 10))}T000000Z`;
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//DrugRadar//EU decision dates//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];

  for (const e of events) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date)) continue;
    const summary = `EU decision expected: ${e.drug}${e.inn ? ` (${e.inn})` : ''}`;
    const desc = [e.indication ? `Indication followed: ${e.indication}.` : '', DISCLAIMER]
      .filter(Boolean)
      .join(' ');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${uid(e)}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${ymd(e.date)}`,
      `DTEND;VALUE=DATE:${ymd(nextDay(e.date))}`,
      `SUMMARY:${esc(summary)}`,
      `DESCRIPTION:${esc(desc)}`,
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${esc(summary)}`,
      'TRIGGER:-P3D',
      'END:VALARM',
      'END:VEVENT'
    );
  }

  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
};

/**
 * Export the given decisions: native share sheet on iOS, .ics download on web.
 * Returns false when nothing could be exported. Never throws.
 */
export const exportToCalendar = async (events: DecisionEvent[]): Promise<boolean> => {
  const ics = buildIcs(events);
  if (!ics.includes('BEGIN:VEVENT')) return false;
  const filename = events.length === 1 ? `eu-decision-${events[0].drug.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.ics` : 'eu-decisions.ics';

  if (Capacitor.isNativePlatform()) {
    try {
      const file = await Filesystem.writeFile({
        path: filename,
        data: ics,
        directory: Directory.Cache,
        encoding: Encoding.UTF8,
      });
      await Share.share({
        title: 'EU decision dates',
        files: [file.uri],
      });
      return true;
    } catch (err) {
      // User cancelling the share sheet lands here too — treat as handled.
      return String(err).toLowerCase().includes('cancel');
    }
  }

  try {
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return true;
  } catch {
    return false;
  }
};
