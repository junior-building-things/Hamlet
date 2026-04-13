'use client';

/**
 * Distinct color scheme for each status. Font color, background, and border
 * all match so the badge reads as a unified chip.
 */
const STATUS_COLORS: Record<string, string> = {
  'PRD/Design Prep': 'bg-purple-500/15 text-purple-400 border border-purple-500/30',
  'Line Review':     'bg-pink-500/15 text-pink-400 border border-pink-500/30',
  'Dependency Check':'bg-rose-500/15 text-rose-400 border border-rose-500/30',
  'RD Allocation':   'bg-orange-500/15 text-orange-400 border border-orange-500/30',
  'PRD Walkthrough': 'bg-amber-500/15 text-amber-400 border border-amber-500/30',
  'Tech Design':     'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30',
  'Development':     'bg-blue-500/15 text-blue-400 border border-blue-500/30',
  'QA Testing':      'bg-yellow-500/15 text-yellow-300 border border-yellow-500/30',
  'AB Testing':      'bg-lime-500/15 text-lime-400 border border-lime-500/30',
  'Merged':          'bg-teal-500/15 text-teal-400 border border-teal-500/30',
  'Done':            'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30',
};

const DEFAULT_STYLE = 'bg-slate-500/15 text-slate-400 border border-slate-500/30';

export function statusStyle(status: string): string {
  return STATUS_COLORS[status] ?? DEFAULT_STYLE;
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium whitespace-nowrap ${statusStyle(status)}`}>
      {status}
    </span>
  );
}
