import React from 'react';
import { EmaFlags } from '../types';

// Compact regulatory-status pills, ordered by how much an EMA committee member
// cares: ATMP (advanced therapy) first, then orphan / PRIME, then the MA-type
// qualifiers. Only truthy flags render.
const DEFS: Array<{ key: keyof EmaFlags; label: string; cls: string }> = [
  { key: 'atmp', label: 'ATMP', cls: 'bg-violet-100 text-violet-800 border-violet-200' },
  { key: 'orphan', label: 'Orphan', cls: 'bg-amber-100 text-amber-800 border-amber-200' },
  { key: 'prime', label: 'PRIME', cls: 'bg-rose-100 text-rose-800 border-rose-200' },
  { key: 'acc', label: 'Accelerated', cls: 'bg-sky-100 text-sky-800 border-sky-200' },
  { key: 'cond', label: 'Conditional', cls: 'bg-slate-100 text-slate-700 border-slate-200' },
  { key: 'exc', label: 'Except. circ.', cls: 'bg-slate-100 text-slate-700 border-slate-200' },
  { key: 'bio', label: 'Biosimilar', cls: 'bg-teal-100 text-teal-800 border-teal-200' },
  { key: 'gen', label: 'Generic', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
];

const EmaBadges: React.FC<{ flags: EmaFlags; className?: string }> = ({ flags, className }) => {
  const active = DEFS.filter((d) => flags[d.key]);
  if (active.length === 0) return null;
  return (
    <div className={`flex flex-wrap gap-1 ${className ?? ''}`}>
      {active.map((d) => (
        <span
          key={d.key}
          className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${d.cls}`}
        >
          {d.label}
        </span>
      ))}
    </div>
  );
};

export default EmaBadges;
