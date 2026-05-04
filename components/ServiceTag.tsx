'use client';
import { STATUS_TONE_STYLES, type StatusTone } from './StatusBadge';

/**
 * Small uppercase pill used to tag a cron job / system prompt with the
 * agent it belongs to (Hamlet / Junior / Rio / Mia). Mirrors the
 * group-header pill style but uses a 4px radius instead of full pill.
 */

export type Service = 'hamlet' | 'junior' | 'rio' | 'mia';

const SERVICE_TONE: Record<Service, StatusTone> = {
  hamlet: 'blue',
  junior: 'violet',
  rio:    'orange',
  mia:    'green',
};

// Strip a leading "Hamlet — " / "Junior — " / etc. prefix from a name,
// regardless of which service it belongs to. Tolerates em-dash, en-dash,
// or hyphen separators with surrounding whitespace.
const PREFIX_RE = /^(hamlet|junior|rio|mia)\s*[—–\-:]\s*/i;
export function stripServicePrefix(name: string): string {
  return name.replace(PREFIX_RE, '').trim();
}

export function ServiceTag({ service }: { service: Service }) {
  const tone = SERVICE_TONE[service];
  const s = STATUS_TONE_STYLES[tone];
  return (
    <span
      className="inline-flex items-center px-2.5 py-[3px] rounded-[4px] font-mono text-[10px] font-medium uppercase tracking-[0.06em] whitespace-nowrap"
      style={{ background: s.bg, color: s.fg }}
    >
      {service}
    </span>
  );
}
