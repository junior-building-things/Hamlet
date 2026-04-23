'use client';

/**
 * Solid-color status badges with white/black text for maximum contrast.
 */
const STATUS_COLORS: Record<string, string> = {
  'PRD/Design Prep': 'bg-purple-600 text-white',
  'Line Review':     'bg-pink-600 text-white',
  'Dependency Check':'bg-rose-600 text-white',
  'Compliance Review':'bg-rose-400 text-white',
  'RD Allocation':   'bg-orange-500 text-white',
  'PRD Walkthrough': 'bg-amber-500 text-black',
  'Tech Design':     'bg-cyan-600 text-white',
  'Development':     'bg-blue-600 text-white',
  'QA Testing':      'bg-yellow-400 text-black',
  'QA':              'bg-yellow-400 text-black',
  'UAT':             'bg-indigo-500 text-white',
  'AB Testing':      'bg-lime-500 text-black',
  'Merged':          'bg-teal-500 text-white',
  'Done':            'bg-emerald-600 text-white',
};

const DEFAULT_STYLE = 'bg-slate-500 text-white';

export function statusStyle(status: string): string {
  return STATUS_COLORS[status] ?? DEFAULT_STYLE;
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded text-xs font-semibold whitespace-nowrap ${statusStyle(status)}`}>
      {status}
    </span>
  );
}
