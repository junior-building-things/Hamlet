'use client';
import { ThemeToggle } from '@/components/FilterBar';
import { useSync } from '@/components/SyncContext';
import { Loader2, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';

/**
 * Floating top-right action bar shown across every tab.
 *
 * Layout (left → right): "Synced Xs ago" status indicator (when we
 * have a real timestamp), Sync All button, theme toggle. All three
 * use the design's shared primitives — `.hm-sync-bar`, `.hm-btn` /
 * `.hm-btn-ai`, `.hm-icon-btn`.
 */
export function GlobalActions() {
  const { syncingAll, detailSyncTotal, syncAll, lastSyncedAt } = useSync();
  const isSyncing = syncingAll || detailSyncTotal > 0;
  const relative  = useRelativeTime(lastSyncedAt);

  return (
    <div className="flex items-center gap-2">
      {relative && (
        <div className="hm-sync-bar">
          <span className="dot" />
          Synced {relative}
        </div>
      )}
      <button
        onClick={syncAll}
        disabled={isSyncing}
        className={`hm-btn ${isSyncing ? 'hm-btn-ai' : ''}`}
      >
        {isSyncing
          ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Syncing…</>
          : <><RefreshCw className="w-3.5 h-3.5" /> Sync All</>}
      </button>
      <ThemeToggle />
    </div>
  );
}

/** "Xs ago" / "Xm ago" / "Xh ago" — re-renders every 30s so the
 *  visible value stays roughly fresh. */
function useRelativeTime(iso?: string | null): string | null {
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force(x => x + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleTimeString();
}
