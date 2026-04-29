'use client';
import { createContext, useContext, useRef, useState, useCallback, ReactNode } from 'react';

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
}

interface SyncContextValue extends SyncState {
  /** Trigger a full sync (delegates to ProjectView's handler). */
  syncAll: () => void;
  /** Called by ProjectView to register its trigger function. */
  registerSyncAll: (fn: () => void | Promise<void>) => void;
  /** Called by ProjectView to push state changes up. */
  setSyncState: (s: SyncState) => void;
}

const SyncContext = createContext<SyncContextValue | null>(null);

const noop = () => {};

export function SyncProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SyncState>({ syncingAll: false, detailSyncTotal: 0 });
  const handlerRef = useRef<() => void | Promise<void>>(noop);

  const registerSyncAll = useCallback((fn: () => void | Promise<void>) => {
    handlerRef.current = fn;
  }, []);

  const setSyncState = useCallback((s: SyncState) => {
    setState(s);
  }, []);

  const syncAll = useCallback(() => {
    void handlerRef.current();
  }, []);

  return (
    <SyncContext.Provider
      value={{
        syncingAll: state.syncingAll,
        detailSyncTotal: state.detailSyncTotal,
        syncAll,
        registerSyncAll,
        setSyncState,
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
