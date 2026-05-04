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
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => () => { if (showTimer.current) clearTimeout(showTimer.current); }, []);

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
    if (showTimer.current) clearTimeout(showTimer.current);
    showTimer.current = setTimeout(() => {
      const r = ref.current?.getBoundingClientRect();
      if (r) setAnchor({ top: r.top, left: r.left, width: r.width });
      setShowTooltip(true);
    }, 350);
  }, []);
  const hide = useCallback(() => {
    if (showTimer.current) { clearTimeout(showTimer.current); showTimer.current = null; }
    setShowTooltip(false);
  }, []);

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
          className="tip shown"
          style={{
            top: anchor.top - 8,
            left: anchor.left + anchor.width / 2,
            transform: 'translate(-50%, -100%)',
            zIndex: 9999,
          }}
        >
          <div className="tip-label" style={{ marginBottom: 4 }}>Version {version}</div>
          <div style={{ fontSize: 12, lineHeight: 1.4 }}>Merge: {mergeDate}</div>
        </div>,
        document.body,
      )}
    </>
  );
}
