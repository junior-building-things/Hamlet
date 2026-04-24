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

export function VersionBadge({ version, versionHistory }: { version?: string; versionHistory?: string[] }) {
  const [showTooltip, setShowTooltip] = useState(false);
  const [anchor, setAnchor] = useState({ top: 0, left: 0, width: 0 });
  const [mounted, setMounted] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => { setMounted(true); }, []);

  const show = useCallback(() => {
    if (ref.current) {
      const r = ref.current.getBoundingClientRect();
      setAnchor({ top: r.top, left: r.left, width: r.width });
    }
    setShowTooltip(true);
  }, []);
  const hide = useCallback(() => setShowTooltip(false), []);

  if (!version) return null;
  const config = versionColor(version);
  const hasHistory = versionHistory && versionHistory.length > 1;
  const trail = hasHistory ? versionHistory.join(' → ') : undefined;

  return (
    <>
      <span
        ref={ref}
        className={`inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium whitespace-nowrap ${config.bg} ${config.text}`}
        onMouseEnter={show}
        onMouseLeave={hide}
      >
        {version}
      </span>
      {trail && showTooltip && mounted && createPortal(
        <div
          className="fixed px-2.5 py-1.5 bg-[var(--card)] border border-[var(--border)] rounded-lg shadow-xl text-[11px] text-[var(--foreground)] whitespace-nowrap pointer-events-none"
          style={{
            top: anchor.top - 6,
            left: anchor.left + anchor.width / 2,
            transform: 'translate(-50%, -100%)',
            zIndex: 9999,
          }}
        >
          {trail}
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-l-[5px] border-r-[5px] border-t-[5px] border-l-transparent border-r-transparent border-t-[var(--card)]" />
        </div>,
        document.body,
      )}
    </>
  );
}
