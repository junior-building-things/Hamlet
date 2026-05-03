'use client';
import { Priority } from '@/lib/types';

const TONES: Record<Priority, { bg: string; fg: string; border: string }> = {
  P0: { bg: 'oklch(0.72 0.18 22 / 0.10)', fg: 'oklch(0.55 0.20 22)', border: 'oklch(0.72 0.18 22 / 0.30)' },
  P1: { bg: 'oklch(0.82 0.14 75 / 0.10)', fg: 'oklch(0.50 0.16 75)', border: 'oklch(0.82 0.14 75 / 0.30)' },
  P2: { bg: 'transparent',                 fg: 'var(--text-muted)',  border: 'var(--hairline-strong)' },
  P3: { bg: 'transparent',                 fg: 'var(--text-dim)',    border: 'var(--hairline)' },
};

export function PriorityBadge({ priority }: { priority: Priority }) {
  const t = TONES[priority] ?? TONES.P2;
  return (
    <span
      className="inline-flex items-center font-mono text-[10.5px] uppercase tracking-[0.04em] px-1.5 py-0.5 rounded-[4px] border whitespace-nowrap"
      style={{ background: t.bg, color: t.fg, borderColor: t.border }}
    >
      {priority}
    </span>
  );
}
