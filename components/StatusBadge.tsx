'use client';

/**
 * Status pill — leading dot, mono uppercase label, soft-tinted bg.
 * Each status maps to one of the design's accent colors via OKLCH so
 * the same hue family is used across light + dark themes.
 */
export type StatusTone =
  | 'violet' | 'pink' | 'rose' | 'orange' | 'amber'
  | 'cyan'   | 'blue' | 'yellow' | 'indigo' | 'lime'
  | 'teal'   | 'green' | 'gray';

export const STATUS_TONE: Record<string, StatusTone> = {
  'PRD/Design Prep':  'violet',
  'Line Review':      'pink',
  'Dependency Check': 'rose',
  'Compliance Review':'rose',
  'RD Allocation':    'orange',
  'PRD Walkthrough':  'pink',
  'Tech Design':      'cyan',
  'Development':      'blue',
  'QA Testing':       'yellow',
  'QA':               'yellow',
  'UAT':              'indigo',
  'AB Testing':       'lime',
  'Merged':           'teal',
  'Done':             'green',
};

export const STATUS_TONE_STYLES: Record<StatusTone, { bg: string; fg: string; dot: string }> = {
  violet: { bg: 'oklch(0.74 0.14 295 / 0.12)',  fg: 'oklch(0.55 0.18 295)',  dot: 'oklch(0.55 0.18 295)' },
  pink:   { bg: 'oklch(0.78 0.16 350 / 0.12)',  fg: 'oklch(0.55 0.20 350)',  dot: 'oklch(0.55 0.20 350)' },
  rose:   { bg: 'oklch(0.72 0.18 22 / 0.12)',   fg: 'oklch(0.55 0.20 22)',   dot: 'oklch(0.55 0.20 22)'  },
  orange: { bg: 'oklch(0.78 0.16 50 / 0.12)',   fg: 'oklch(0.55 0.18 50)',   dot: 'oklch(0.55 0.18 50)'  },
  amber:  { bg: 'oklch(0.82 0.14 75 / 0.14)',   fg: 'oklch(0.55 0.16 75)',   dot: 'oklch(0.55 0.16 75)'  },
  cyan:   { bg: 'oklch(0.74 0.14 195 / 0.14)',  fg: 'oklch(0.50 0.13 195)',  dot: 'oklch(0.50 0.13 195)' },
  blue:   { bg: 'oklch(0.78 0.13 240 / 0.14)',  fg: 'oklch(0.55 0.16 240)',  dot: 'oklch(0.55 0.16 240)' },
  yellow: { bg: 'oklch(0.86 0.14 95 / 0.16)',   fg: 'oklch(0.50 0.14 95)',   dot: 'oklch(0.50 0.14 95)'  },
  indigo: { bg: 'oklch(0.70 0.15 270 / 0.14)',  fg: 'oklch(0.50 0.16 270)',  dot: 'oklch(0.50 0.16 270)' },
  lime:   { bg: '#EEF9F1',                       fg: '#43CA78',               dot: '#43CA78'              },
  teal:   { bg: 'oklch(0.78 0.12 175 / 0.14)',  fg: 'oklch(0.50 0.13 175)',  dot: 'oklch(0.50 0.13 175)' },
  green:  { bg: 'oklch(0.78 0.14 155 / 0.12)',  fg: 'oklch(0.50 0.16 155)',  dot: 'oklch(0.50 0.16 155)' },
  gray:   { bg: 'var(--bg-elev-3)',              fg: 'var(--text-muted)',     dot: 'var(--text-muted)'    },
};

export function statusStyle(status: string): string {
  // Back-compat: a few callers (e.g. ProjectView group headers) still
  // reference this function. Map to a Tailwind class so old usages stay
  // visually consistent without a deeper refactor.
  const tone = STATUS_TONE[status] ?? 'gray';
  const map: Record<StatusTone, string> = {
    violet: 'bg-purple-600 text-white',
    pink:   'bg-pink-600 text-white',
    rose:   'bg-rose-600 text-white',
    orange: 'bg-orange-500 text-white',
    amber:  'bg-amber-500 text-black',
    cyan:   'bg-cyan-600 text-white',
    blue:   'bg-blue-600 text-white',
    yellow: 'bg-yellow-400 text-black',
    indigo: 'bg-indigo-500 text-white',
    lime:   'bg-lime-500 text-black',
    teal:   'bg-teal-500 text-white',
    green:  'bg-emerald-600 text-white',
    gray:   'bg-slate-500 text-white',
  };
  return map[tone];
}

export function StatusBadge({ status, showDot = true }: { status: string; showDot?: boolean }) {
  const tone = STATUS_TONE[status] ?? 'gray';
  const s = STATUS_TONE_STYLES[tone];
  // Done features stop the breathing pulse — they're, well, done.
  const isInProgress = status !== 'Done' && status !== '已完成';
  return (
    <span
      className="inline-flex items-center gap-1.5 h-[22px] px-2.5 rounded-[var(--r-sm)] font-mono text-[10px] font-medium uppercase tracking-[0.04em] whitespace-nowrap"
      style={{ background: s.bg, color: s.fg }}
    >
      {showDot && (
        <span
          className={`inline-block w-[5px] h-[5px] rounded-full ${isInProgress ? 'dot-breathe' : ''}`}
          style={{ background: s.dot }}
        />
      )}
      {status}
    </span>
  );
}
