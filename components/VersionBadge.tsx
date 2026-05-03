'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

const VERSION_COLORS = [
  { bg: 'bg-cyan-500/15 border border-cyan-500/30',     text: 'text-cyan-700'    },
  { bg: 'bg-violet-500/15 border border-violet-500/30',  text: 'text-violet-700'  },
  { bg: 'bg-amber-500/15 border border-amber-500/30',    text: 'text-amber-700'   },
  { bg: 'bg-emerald-500/15 border border-emerald-500/30', text: 'text-emerald-700' },
  { bg: 'bg-rose-500/15 border border-rose-500/30',      text: 'text-rose-700'    },
  { bg: 'bg-blue-500/15 border border-blue-500/30',      text: 'text-blue-700'    },
  { bg: 'bg-orange-500/15 border border-orange-500/30',  text: 'text-orange-700'  },
  { bg: 'bg-teal-500/15 border border-teal-500/30',      text: 'text-teal-700'    },
];

function versionColor(version: string) {
  let hash = 0;
  for (let i = 0; i < version.length; i++) {
    hash = ((hash << 5) - hash + version.charCodeAt(i)) | 0;
  }
  return VERSION_COLORS[Math.abs(hash) % VERSION_COLORS.length];
}

// Module-level cache: fetched once per page load, shared across all
// VersionBadge instances. Promise so concurrent first renders dedupe.
let mergeCalendarPromise: Promise<Record<string, string>> | null = null;
function loadMergeCalendar(): Promise<Record<string, string>> {
  if (!mergeCalendarPromise) {
    mergeCalendarPromise = fetch('/api/merge-calendar')
      .then(r => r.ok ? r.json() : {})
      .catch(() => ({}));
  }
  return mergeCalendarPromise;
}

function formatMergeDate(iso: string): string {
  // Render "23 Apr" in Singapore time so the tooltip is succinct.
  const d = new Date(iso + 'T00:00:00+08:00');
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Singapore' });
}

export function VersionBadge({ version }: { version?: string; versionHistory?: string[] }) {
  const [showTooltip, setShowTooltip] = useState(false);
  const [anchor, setAnchor] = useState({ top: 0, left: 0, width: 0 });
  const [mounted, setMounted] = useState(false);
  const [mergeDate, setMergeDate] = useState<string | null>(null);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => { setMounted(true); }, []);

  // Resolve merge date for THIS version once the calendar loads.
  useEffect(() => {
    if (!version) return;
    let cancelled = false;
    loadMergeCalendar().then(map => {
      if (cancelled) return;
      const iso = map[version];
      setMergeDate(iso ? formatMergeDate(iso) : null);
    });
    return () => { cancelled = true; };
  }, [version]);

  const show = useCallback(() => {
    if (ref.current) {
      const r = ref.current.getBoundingClientRect();
      setAnchor({ top: r.top, left: r.left, width: r.width });
    }
    setShowTooltip(true);
  }, []);
  const hide = useCallback(() => setShowTooltip(false), []);

  if (!version) return null;
  // versionColor kept for back-compat with any non-list usage.
  void versionColor;

  return (
    <>
      <span
        ref={ref}
        className="font-mono text-[11px] text-[var(--text-muted)] cursor-default whitespace-nowrap"
        style={{ borderBottom: '1px dashed var(--hairline-strong)' }}
        onMouseEnter={show}
        onMouseLeave={hide}
      >
        {version}
      </span>
      {mergeDate && showTooltip && mounted && createPortal(
        <div
          className="fixed px-2.5 py-1.5 bg-[var(--card)] border border-[var(--border)] rounded-lg shadow-xl text-[11px] text-[var(--foreground)] whitespace-nowrap pointer-events-none"
          style={{
            top: anchor.top - 6,
            left: anchor.left + anchor.width / 2,
            transform: 'translate(-50%, -100%)',
            zIndex: 9999,
          }}
        >
          Merge: {mergeDate}
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-l-[5px] border-r-[5px] border-t-[5px] border-l-transparent border-r-transparent border-t-[var(--card)]" />
        </div>,
        document.body,
      )}
    </>
  );
}
