'use client';
import { ThemeToggle } from '@/components/FilterBar';
import { useSync } from '@/components/SyncContext';
import { Loader2, RefreshCw } from 'lucide-react';

/**
 * Floating top-right action bar shown across every tab.
 * Reads sync state from SyncContext (populated by ProjectView).
 *
 * Layout (left → right): Sync All button, theme toggle. Per the
 * design redesign, the theme toggle now lives to the right of Sync.
 */
export function GlobalActions() {
  const { syncingAll, detailSyncTotal, syncAll } = useSync();
  const isSyncing = syncingAll || detailSyncTotal > 0;
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={syncAll}
        disabled={isSyncing}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--r-md)] border border-[var(--hairline-strong)] bg-[var(--bg-elev-1)] hover:bg-[var(--bg-elev-3)] text-[var(--text-muted)] hover:text-[var(--text)] text-[12.5px] transition-colors disabled:opacity-50 ${
          isSyncing ? 'border-[color:var(--ai-glow)] text-[var(--ai)]' : ''
        }`}
      >
        {isSyncing
          ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Syncing…</>
          : <><RefreshCw className="w-3.5 h-3.5" /> Sync All</>}
      </button>
      <ThemeToggle />
    </div>
  );
}
