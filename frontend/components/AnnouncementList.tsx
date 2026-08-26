import React, { useState } from 'react';
import { Megaphone, ExternalLink, ChevronDown, ChevronUp } from 'lucide-react';
import { Announcement, getAnnouncements, findAnnouncements } from '../services/announcements';

/**
 * "Just announced" — FDA press releases newer than the openFDA data cycle.
 * Bridges the gap between an approval being announced (hours) and it becoming
 * searchable in the Approvals tab (days to ~2 weeks).
 */

const fmtDate = (iso: string): string => {
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};

const Row: React.FC<{ item: Announcement }> = ({ item }) => (
  <a
    href={item.url}
    target="_blank"
    rel="noopener noreferrer"
    className="flex items-start gap-2.5 py-2 group"
  >
    <span className="shrink-0 mt-0.5 inline-flex items-center px-1.5 py-0.5 rounded-md bg-white border border-amber-200 text-[10px] font-bold text-amber-700 tabular-nums">
      {fmtDate(item.date)}
    </span>
    <span className="text-[13px] leading-snug text-slate-700 group-active:text-amber-800 min-w-0">
      {item.title}
      <ExternalLink size={11} className="inline-block ml-1 mb-0.5 text-amber-500 shrink-0" />
    </span>
  </a>
);

/** Collapsible banner for the Approvals tab (default, non-search state). */
export const AnnouncementBanner: React.FC = () => {
  const [open, setOpen] = useState(false);
  const items = getAnnouncements();
  if (items.length === 0) return null;
  const shown = open ? items : items.slice(0, 2);
  return (
    <div className="mx-4 mb-4 rounded-2xl border border-amber-200 bg-amber-50/70 px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="p-2 bg-amber-100 rounded-xl text-amber-700 shrink-0">
          <Megaphone size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-bold text-slate-900 leading-tight">Just announced by the FDA</h3>
          <p className="text-[12px] text-slate-600 mt-0.5 leading-relaxed">
            Fresh approval announcements from the FDA press office. The full
            database entry (label, class, dates) can take days to ~2 weeks to
            appear in the lists and search below.
          </p>
        </div>
      </div>
      <div className="mt-1 divide-y divide-amber-100">
        {shown.map((a) => (
          <Row key={a.url} item={a} />
        ))}
      </div>
      {items.length > 2 && (
        <button
          onClick={() => setOpen(!open)}
          className="mt-1 inline-flex items-center gap-1 text-[12px] font-semibold text-amber-700 active:text-amber-900"
        >
          {open ? (
            <>
              Show fewer <ChevronUp size={14} />
            </>
          ) : (
            <>
              Show all {items.length} announcements <ChevronDown size={14} />
            </>
          )}
        </button>
      )}
    </div>
  );
};

/** Hint shown when an FDA search finds nothing but the query matches a fresh
 *  announcement — "approved, database entry pending" beats an empty list. */
export const AnnouncementHint: React.FC<{ query: string }> = ({ query }) => {
  const matches = findAnnouncements(query);
  if (matches.length === 0) return null;
  return (
    <div className="mx-4 mb-4 rounded-2xl border border-amber-200 bg-amber-50/70 px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="p-2 bg-amber-100 rounded-xl text-amber-700 shrink-0">
          <Megaphone size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-bold text-slate-900 leading-tight">
            Announced — database entry pending
          </h3>
          <p className="text-[12px] text-slate-600 mt-0.5 leading-relaxed">
            “{query}” matches a recent FDA announcement. Newly approved drugs
            take days to ~2 weeks to become searchable in openFDA — until then,
            read the announcement itself:
          </p>
          <div className="mt-1 divide-y divide-amber-100">
            {matches.map((a) => (
              <Row key={a.url} item={a} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
