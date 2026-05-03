'use client';
import { createContext, useContext, useRef, useState, useCallback, useEffect, ReactNode } from 'react';

/**
 * Shared sync state surfaced to every tab.
 *
 * ProjectView owns the heavy sync logic (Meego fetch + per-feature
 * detail syncs). It registers its trigger function via `registerSyncAll`
 * on mount, and reports state changes via `setSyncState`.
 *
 * Any tab can:
 *  - read `syncingAll` / `detailSyncTotal` to render a spinner
 *  - call `syncAll()` to trigger a full sync (it'll route into
 *    ProjectView's registered handler)
 *
 * This relies on ProjectView staying mounted across tab navigation —
 * page.tsx renders ProjectView always (hidden via CSS when inactive)
 * so the sync continues running and the state survives.
 */
interface SyncState {
  syncingAll: boolean;
  detailSyncTotal: number;
  /** ISO timestamp of the last completed sync (any kind). null until first sync. */
  lastSyncedAt?: string | null;
}

interface SyncContextValue extends SyncState {
  /** Trigger a full sync (delegates to ProjectView's handler). */
  syncAll: () => void;
  /** Called by ProjectView to register its trigger function. */
  registerSyncAll: (fn: () => void | Promise<void>) => void;
  /** Called by ProjectView to push state changes up. */
  setSyncState: (s: SyncState) => void;
  /** Mark "now" as the latest sync time (called after sync completes). */
  markSynced: () => void;
  /** ISO timestamp of the most recent refresh-feature-cache cron run.
   *  Polled once at mount + after every Sync All so the drawer's
   *  "Updated Xh ago" line stays roughly fresh without spamming the API. */
  refreshCronLastRunAt?: string | null;
}

const SyncContext = createContext<SyncContextValue | null>(null);

const noop = () => {};

export function SyncProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SyncState>({ syncingAll: false, detailSyncTotal: 0, lastSyncedAt: null });
  const [refreshCronLastRunAt, setRefreshCronLastRunAt] = useState<string | null>(null);
  const handlerRef = useRef<() => void | Promise<void>>(noop);

  // Pull the refresh-feature-cache cron's lastAttemptTime once on mount
  // and re-poll lazily after every sync-all completion. The drawer reads
  // this to compute the "Updated Xh ago" line.
  const refetchCronTimes = useCallback(async () => {
    try {
      const res = await fetch('/api/crons');
      const data = await res.json() as { jobs?: Array<{ id: string; lastAttemptTime?: string | null }> };
      const job = (data.jobs ?? []).find(j => j.id === 'refresh-feature-cache');
      setRefreshCronLastRunAt(job?.lastAttemptTime ?? null);
    } catch { /* best-effort */ }
  }, []);
  useEffect(() => { refetchCronTimes(); }, [refetchCronTimes]);

  const registerSyncAll = useCallback((fn: () => void | Promise<void>) => {
    handlerRef.current = fn;
  }, []);

  const setSyncState = useCallback((s: SyncState) => {
    // Preserve lastSyncedAt unless caller explicitly overrode it.
    setState(prev => ({
      ...prev,
      syncingAll: s.syncingAll,
      detailSyncTotal: s.detailSyncTotal,
      lastSyncedAt: s.lastSyncedAt !== undefined ? s.lastSyncedAt : prev.lastSyncedAt,
    }));
  }, []);

  const markSynced = useCallback(() => {
    setState(prev => ({ ...prev, lastSyncedAt: new Date().toISOString() }));
    // Re-poll cron times (in case the user manually triggered the
    // refresh cron and just got a fresh value).
    void refetchCronTimes();
  }, [refetchCronTimes]);

  const syncAll = useCallback(() => {
    void handlerRef.current();
  }, []);

  return (
    <SyncContext.Provider
      value={{
        syncingAll: state.syncingAll,
        detailSyncTotal: state.detailSyncTotal,
        lastSyncedAt: state.lastSyncedAt,
        refreshCronLastRunAt,
        syncAll,
        registerSyncAll,
        setSyncState,
        markSynced,
      }}
    >
      {children}
    </SyncContext.Provider>
  );
}

export function useSync(): SyncContextValue {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error('useSync must be used inside SyncProvider');
  return ctx;
}
