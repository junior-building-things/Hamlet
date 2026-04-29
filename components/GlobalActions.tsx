'use client';
import { ThemeToggle } from '@/components/FilterBar';
import { useSync } from '@/components/SyncContext';
import { Loader2, RefreshCw } from 'lucide-react';

/**
 * Floating top-right action bar shown across every tab.
 * Reads sync state from SyncContext (populated by ProjectView).
 *
 * Rendered absolute-positioned by page.tsx so it sits above each tab's
 * own toolbar — every tab gets the dark/light toggle and Sync All
 * button in the same spot, with a consistent state.
 */
export function GlobalActions() {
  const { syncingAll, detailSyncTotal, syncAll } = useSync();
  const isSyncing = syncingAll || detailSyncTotal > 0;
  return (
    <div className="flex items-center gap-2">
      <ThemeToggle />
      <button
        onClick={syncAll}
        disabled={isSyncing}
        className="flex items-center gap-2 px-4 py-2 bg-[var(--card)] border border-[var(--border)] hover:bg-[var(--card-hover)] text-[var(--muted)] hover:text-[var(--foreground)] text-sm rounded-xl transition-colors disabled:opacity-50"
      >
        {isSyncing
          ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Syncing</>
          : <><RefreshCw className="w-3.5 h-3.5" /> Sync All</>}
      </button>
    </div>
  );
}
