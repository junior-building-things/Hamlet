/**
 * Track in-flight cron runs so the sidebar can show "Junior is working".
 *
 * Each cron entry-point handler wraps its work in markCronStarted +
 * markCronEnded (in a finally so crashes still clear). State lives in
 * DigestStateFile.cronRuns so it's shared across Cloud Run instances.
 *
 * Stale entries (older than STALE_RUN_MS) are filtered out on read —
 * if a handler crashes before the finally runs, the marker won't pin
 * the UI forever.
 */

import { loadDigestState, saveDigestState } from './digest-state';
import { getCronById } from './cron-registry';

const STALE_RUN_MS = 15 * 60 * 1000; // 15 minutes — covers the longest digest runs

export interface ActiveCronRun {
  id: string;
  label: string;
  startedAt: string;
  source: 'manual' | 'scheduled';
  /** Seconds since startedAt, computed at read time. */
  elapsedSeconds: number;
}

/** Mark a cron job as currently running. Resolves the label from the registry. */
export async function markCronStarted(id: string, source: 'manual' | 'scheduled' = 'scheduled'): Promise<void> {
  try {
    const def = getCronById(id);
    const label = def?.name ?? id;
    const state = await loadDigestState();
    state.cronRuns = { ...(state.cronRuns ?? {}), [id]: { label, startedAt: new Date().toISOString(), source } };
    await saveDigestState(state);
  } catch (e) {
    console.warn('[cron-runs] markCronStarted failed:', e);
  }
}

/** Clear the running marker for a cron job. Always called from a finally. */
export async function markCronEnded(id: string): Promise<void> {
  try {
    const state = await loadDigestState();
    if (state.cronRuns && state.cronRuns[id]) {
      const next = { ...state.cronRuns };
      delete next[id];
      state.cronRuns = next;
      await saveDigestState(state);
    }
  } catch (e) {
    console.warn('[cron-runs] markCronEnded failed:', e);
  }
}

/** Read currently-active runs, dropping any stale (>15min) entries. */
export async function getActiveCronRuns(): Promise<ActiveCronRun[]> {
  try {
    const state = await loadDigestState();
    const runs = state.cronRuns ?? {};
    const now = Date.now();
    const out: ActiveCronRun[] = [];
    for (const [id, run] of Object.entries(runs)) {
      const startedMs = Date.parse(run.startedAt);
      if (isNaN(startedMs) || now - startedMs > STALE_RUN_MS) continue;
      out.push({
        id,
        label: run.label,
        startedAt: run.startedAt,
        source: run.source,
        elapsedSeconds: Math.max(0, Math.round((now - startedMs) / 1000)),
      });
    }
    // Newest first so the sidebar shows the most recent kick-off.
    out.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
    return out;
  } catch (e) {
    console.warn('[cron-runs] getActiveCronRuns failed:', e);
    return [];
  }
}

/** Convenience wrapper — marks start, runs the work, always marks end. */
export async function withCronRun<T>(
  id: string,
  source: 'manual' | 'scheduled',
  fn: () => Promise<T>,
): Promise<T> {
  await markCronStarted(id, source);
  try {
    return await fn();
  } finally {
    await markCronEnded(id);
  }
}
