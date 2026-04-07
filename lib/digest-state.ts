/**
 * Persistent chat-risk state for the daily digest.
 *
 * Stored as a single JSON file at `gs://tiktok-im-hamlet-state/digests/chat-risks.json`
 * containing a map keyed by Meego work item id. The digest pipeline loads
 * this on every run, uses prior risks to inform Gemini's qualitative
 * evaluation, and writes back the updated state at the end.
 *
 * Why a single file: the dataset is tiny (a handful of in-dev features per
 * day) and reads/writes happen exactly once per digest run, so we don't
 * need per-feature objects or any locking story.
 */

import { readJsonState, writeJsonState } from './gcs-state';

const STATE_PATH = 'digests/chat-risks.json';

/**
 * Hard cap on how long a risk can sit in the state file without being
 * re-confirmed. After this, the entry is dropped on the next save even
 * if Gemini hasn't explicitly cleared it — covers cases where a feature
 * gets stuck in a state we never observed cleanly.
 */
const STALE_RISK_MAX_AGE_DAYS = 14;

export type ChatRiskLevel = 'yellow' | 'red';

export interface PersistedChatRisk {
  /** Feature display name (cached for log readability — not authoritative). */
  name: string;
  level: ChatRiskLevel;
  summary: string;
  /** ISO timestamp of when this risk was first detected. */
  raisedAtIso: string;
  /** ISO timestamp of the most recent run that confirmed (or carried forward) this risk. */
  lastSeenIso: string;
}

export interface ChatRiskStateFile {
  updatedAt: string;
  /** Keyed by Meego workItemId. */
  features: Record<string, PersistedChatRisk>;
}

/**
 * Load the chat-risk state file from GCS. Returns an empty state if the
 * file doesn't exist yet (first run) or if loading fails for any reason
 * (so a transient GCS outage doesn't break the digest).
 */
export async function loadChatRiskState(): Promise<ChatRiskStateFile> {
  try {
    const state = await readJsonState<ChatRiskStateFile>(STATE_PATH);
    if (!state) {
      return { updatedAt: new Date().toISOString(), features: {} };
    }
    return state;
  } catch (e) {
    console.warn('[digest-state] failed to load chat-risk state, treating as empty:', e);
    return { updatedAt: new Date().toISOString(), features: {} };
  }
}

/**
 * Persist the updated chat-risk state to GCS. Logs and swallows any error
 * — losing the state for a single run is recoverable on the next run, and
 * we'd rather not crash the digest endpoint over a write failure.
 */
export async function saveChatRiskState(state: ChatRiskStateFile): Promise<void> {
  state.updatedAt = new Date().toISOString();
  try {
    await writeJsonState(STATE_PATH, state);
  } catch (e) {
    console.warn('[digest-state] failed to save chat-risk state:', e);
  }
}

/**
 * Drop any persisted entry whose `lastSeenIso` is older than
 * STALE_RISK_MAX_AGE_DAYS. Mutates the state file in place. Called right
 * before saving so the file doesn't grow unbounded if a feature stops
 * appearing in the digest pipeline for any reason (renamed, archived, etc.).
 *
 * Returns the list of feature ids that were dropped (for logging).
 */
export function pruneStaleRisks(state: ChatRiskStateFile): string[] {
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
 *
 * Returns the list of dropped ids.
 */
export function dropExitedFeatures(
  state: ChatRiskStateFile, currentInDevIds: Set<string>,
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
