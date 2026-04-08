/**
 * Persistent feature-risk state for the daily digest.
 *
 * Stored as a single JSON file at `gs://tiktok-im-hamlet-state/digests/chat-risks.json`
 * (kept the original path for backwards compat). Holds two kinds of risk
 * state per feature:
 *   - chatRisk: Gemini-detected qualitative risk from the last N runs
 *   - delayChange: a Meego field-edit (version / planned launch date) that
 *     should keep the feature flagged "Delayed" for the next 2 runs after
 *     it was first detected
 *
 * Plus a small list of recent run timestamps so we can compute "since the
 * last digest run" cutoffs for the activity-log scan.
 */

import { readJsonState, writeJsonState } from './gcs-state';

const STATE_PATH = 'digests/chat-risks.json';

/**
 * Hard cap on how long ANY persisted entry (chat or delay) can sit without
 * being re-confirmed. After this, the entry is dropped on the next save
 * even if Gemini hasn't explicitly cleared it — covers cases where a feature
 * gets stuck in a state we never observed cleanly.
 */
const STALE_RISK_MAX_AGE_DAYS = 14;

/** How many recent run timestamps we keep. We need 2 (current + previous) but keep a small buffer. */
const RECENT_RUN_TIMES_KEEP = 5;

export type ChatRiskLevel = 'yellow' | 'red';

export interface PersistedChatRisk {
  level: ChatRiskLevel;
  summary: string;
  /** ISO timestamp of when this risk was first detected. */
  raisedAtIso: string;
}

export interface PersistedDelayChange {
  /** Display string like "version 44.4 → 44.5" or "planned launch 16 Apr → 17 Apr". */
  detail: string;
  /** ISO timestamp of when this delay was first detected. */
  detectedAtIso: string;
  /**
   * Number of digest runs (including the current one) where the Delayed
   * badge should still be shown. Decremented at the end of each run that
   * shows it; entry is dropped when this hits 0.
   */
  runsLeftToShow: number;
}

export interface PersistedFeatureRisk {
  /** Feature display name (cached for log readability — not authoritative). */
  name: string;
  chatRisk?: PersistedChatRisk;
  delayChange?: PersistedDelayChange;
  /** ISO timestamp of the most recent run that touched this entry. */
  lastSeenIso: string;
}

export interface DiscoveredIdEntry {
  id: string;
  name: string;
}

export interface DigestStateFile {
  updatedAt: string;
  /** ISO timestamps of recent digest runs, oldest first. Used as activity-log cutoff. */
  recentRunTimes: string[];
  /** Keyed by Meego workItemId. */
  features: Record<string, PersistedFeatureRisk>;
  /**
   * Cache of the most recent successful discovery (PM-owned features). Used
   * as a fallback when Meego MCP's list_todo + MQL endpoints are both
   * failing — a transient backend outage shouldn't blank the digest entirely.
   * Refreshed on every successful discovery.
   */
  discoveredIdsCache?: {
    savedAtIso: string;
    ids: DiscoveredIdEntry[];
  };
}

/**
 * Migrate the legacy shape (which was a flat PersistedChatRisk per feature)
 * to the current PersistedFeatureRisk shape with a chatRisk subfield.
 *
 * Legacy shape per feature:
 *   { name, level, summary, raisedAtIso, lastSeenIso }
 * Current shape per feature:
 *   { name, chatRisk: { level, summary, raisedAtIso }, lastSeenIso }
 */
function migrateLegacy(raw: unknown): DigestStateFile {
  if (!raw || typeof raw !== 'object') {
    return { updatedAt: new Date().toISOString(), recentRunTimes: [], features: {} };
  }
  const obj = raw as Record<string, unknown>;
  const features: Record<string, PersistedFeatureRisk> = {};
  const rawFeatures = (obj.features as Record<string, unknown> | undefined) ?? {};
  for (const [id, entry] of Object.entries(rawFeatures)) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    // New shape: has chatRisk or delayChange field
    if (e.chatRisk !== undefined || e.delayChange !== undefined) {
      features[id] = e as unknown as PersistedFeatureRisk;
      continue;
    }
    // Legacy shape: flat level + summary + raisedAtIso
    if (typeof e.level === 'string' && typeof e.summary === 'string') {
      features[id] = {
        name: typeof e.name === 'string' ? e.name : '',
        chatRisk: {
          level: e.level as ChatRiskLevel,
          summary: e.summary,
          raisedAtIso: typeof e.raisedAtIso === 'string' ? e.raisedAtIso : (typeof e.lastSeenIso === 'string' ? e.lastSeenIso : new Date().toISOString()),
        },
        lastSeenIso: typeof e.lastSeenIso === 'string' ? e.lastSeenIso : new Date().toISOString(),
      };
    }
  }
  return {
    updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt : new Date().toISOString(),
    recentRunTimes: Array.isArray(obj.recentRunTimes) ? (obj.recentRunTimes as string[]) : [],
    features,
  };
}

/**
 * Load the digest state file from GCS. Returns an empty state if the file
 * doesn't exist yet (first run) or if loading fails for any reason (so a
 * transient GCS outage doesn't break the digest). Auto-migrates from the
 * legacy single-level shape if necessary.
 */
export async function loadDigestState(): Promise<DigestStateFile> {
  try {
    const raw = await readJsonState<unknown>(STATE_PATH);
    if (!raw) {
      return { updatedAt: new Date().toISOString(), recentRunTimes: [], features: {} };
    }
    return migrateLegacy(raw);
  } catch (e) {
    console.warn('[digest-state] failed to load digest state, treating as empty:', e);
    return { updatedAt: new Date().toISOString(), recentRunTimes: [], features: {} };
  }
}

/**
 * Persist the updated digest state to GCS. Logs and swallows any error —
 * losing the state for a single run is recoverable on the next run, and
 * we'd rather not crash the digest endpoint over a write failure.
 */
export async function saveDigestState(state: DigestStateFile): Promise<void> {
  state.updatedAt = new Date().toISOString();
  try {
    await writeJsonState(STATE_PATH, state);
  } catch (e) {
    console.warn('[digest-state] failed to save digest state:', e);
  }
}

/**
 * Drop any persisted entry whose `lastSeenIso` is older than
 * STALE_RISK_MAX_AGE_DAYS. Mutates the state file in place. Called right
 * before saving so the file doesn't grow unbounded if a feature stops
 * appearing in the digest pipeline for any reason.
 */
export function pruneStaleRisks(state: DigestStateFile): string[] {
  const cutoff = Date.now() - STALE_RISK_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  const dropped: string[] = [];
  for (const [id, entry] of Object.entries(state.features)) {
    const lastSeen = Date.parse(entry.lastSeenIso);
    if (isNaN(lastSeen) || lastSeen < cutoff) {
      dropped.push(id);
      delete state.features[id];
    }
  }
  return dropped;
}

/**
 * Drop persisted entries for features that aren't in the in-dev set this
 * run. A feature that's left dev (launched, paused, archived, …) shouldn't
 * be carried forward as a risk in the next run.
 */
export function dropExitedFeatures(
  state: DigestStateFile, currentInDevIds: Set<string>,
): string[] {
  const dropped: string[] = [];
  for (const id of Object.keys(state.features)) {
    if (!currentInDevIds.has(id)) {
      dropped.push(id);
      delete state.features[id];
    }
  }
  return dropped;
}

/**
 * Append the current run's timestamp to the recentRunTimes list and trim
 * to the last RECENT_RUN_TIMES_KEEP entries.
 */
export function recordRunTime(state: DigestStateFile, nowIso: string): void {
  state.recentRunTimes = [...(state.recentRunTimes ?? []), nowIso].slice(-RECENT_RUN_TIMES_KEEP);
}

/**
 * Return the cutoff timestamp (ms) for the activity-log "since previous
 * run" lookup. This is the timestamp of the most recent run BEFORE the
 * current one. If no runs have been recorded yet, returns 0 so the
 * activity-log scanner only fires on actual edits going forward.
 */
export function previousRunCutoffMs(state: DigestStateFile): number {
  const times = state.recentRunTimes ?? [];
  if (times.length === 0) return Date.now(); // no prior run — exclude all history
  const latest = times[times.length - 1];
  const ts = Date.parse(latest);
  return isNaN(ts) ? Date.now() : ts;
}
