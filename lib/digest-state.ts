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
  /**
   * ISO timestamp of when this risk was first detected. Drives the
   * 7-day stale-prior expiry — once this is older than the cutoff,
   * the next digest run drops the prior, evaluates the latest 7-day
   * window fresh, and resets raisedAtIso if the risk persists. So
   * the ISO is also "when the current risk window started".
   */
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

/**
 * One entry in the cached list of Lark group chats Junior is a member of,
 * paired with the Meego work item id parsed from the chat description (if
 * any). Refreshed by `discoverJuniorFeatureChats` on a TTL.
 */
export interface JuniorChatCacheEntry {
  chatId: string;
  chatName: string;
  /** Meego work item id (digits only) parsed from the chat description, or empty string if none. */
  meegoId: string;
}

export interface JuniorChatsCache {
  fetchedAtIso: string;
  chats: JuniorChatCacheEntry[];
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
  /**
   * Cache of the Lark group chats Junior is a member of, refreshed on a
   * 24h TTL. Used both to expand the discovery set (chats with a Meego ID
   * become candidate features for the risk digest) and to enumerate scan
   * targets for the daily Unanswered Q&A pipeline.
   */
  juniorChatsCache?: JuniorChatsCache;
  /**
   * Manual fallback watchlist of Meego workItemIds to always include in the
   * digest, even when list_todo / MQL / Junior's chat list don't return them.
   * Edited via `gcloud storage cp` against the state JSON file. Replaces
   * the previous hardcoded `WATCHLIST_FEATURE_IDS` constant.
   */
  watchlist?: string[];
  /**
   * Task 3: cached per-feature link fetch results. Keys are Meego workItemIds.
   * When both figmaUrl and abReportUrl are non-empty (allPopulated), the
   * feature is skipped on subsequent runs. Empty-string values mean "tried
   * but not found"; these are re-attempted after LINK_RETRY_COOLDOWN_DAYS.
   */
  featureLinks?: Record<string, CachedFeatureLinks>;
  /**
   * Lark user refresh token for Drive search. The bot's tenant token only
   * returns docs the bot itself has access to; a user_access_token from the
   * PM's account covers their full Drive scope. The refresh_token rotates on
   * each use — the latest one is persisted here so the next run can chain.
   *
   * Bootstrapped by setting `LARK_USER_REFRESH_TOKEN` env var (one-time);
   * after the first successful refresh the env var is no longer needed.
   */
  larkUserRefreshToken?: string;
  /**
   * Meego work item IDs that have already received an AB-open notification
   * card. Used so the backfill (notify every feature currently in 实验中)
   * fires exactly once per feature, even though the same features stay in
   * AB Testing for many digest runs in a row.
   */
  abOpenNotified?: string[];
  /**
   * Meego work item IDs that have already received an AB-concluded
   * notification card. Fires once per feature on the transition from
   * 实验中 → 已完成 (AB Testing → Done).
   */
  abConcludedNotified?: string[];
  /**
   * Meego work item IDs that have already received a "PRD Ready ✅"
   * (Line Review) notification card. Required because the card may
   * trigger compliance review downstream, so each feature must only
   * ever fire it once. A separate forward-only check (prev status
   * must be PRD/Design Prep) is the primary guardrail; this set is
   * the dedup safety net.
   */
  lineReviewNotified?: string[];
  /**
   * "Let Jr. Reply" proposals awaiting the owner's 👍 reaction. Keyed
   * by the message_id of the proposed-reply message Junior posted in
   * the digest chat. When the owner reacts 👍, the entry is consumed:
   * the same `replyText` is sent to `destination` (the PRD comment
   * thread or the feature group chat) tagging `askerOpenId`.
   */
  pendingLetJrReplies?: Record<string, {
    replyText: string;
    askerOpenId: string;
    destination: 'prd_comment' | 'chat';
    /** PRD URL when destination='prd_comment'. */
    prdUrl?: string;
    /** Lark drive comment_id when destination='prd_comment'. */
    commentId?: string;
    /** Feature group chat_id when destination='chat'. */
    chatId?: string;
    /** Thread parent message_id when destination='chat' (so we reply in-thread). */
    chatParentMessageId?: string;
    /** When the proposal was posted; entries older than 24h are pruned. */
    proposedAtIso: string;
  }>;

  /**
   * Per-card snapshot used to support the "Edit" button on AB-open and
   * AB-concluded cards. Keyed by the card's message_id. Stores enough
   * to (a) look up the per-feature section a user wants to edit, and
   * (b) rebuild + patch the full card after Junior applies an edit.
   */
  cardEditContexts?: Record<string, {
    cardKind: 'ab_open' | 'ab_concluded';
    chatId: string;
    headerText: string;
    headerTemplate: 'green' | 'yellow' | 'blue' | 'red' | 'orange' | 'purple' | 'turquoise' | 'wathet' | 'indigo' | 'carmine' | 'violet';
    features: Array<{
      workItemId: string;
      featureName: string;
      cardContent: string;
      cardImages: Array<{ image_key: string; alt?: string }>;
      postTitle: string;
      // Stored as JSON string to keep the DigestState type free of the
      // PostParagraph dependency (which lives in lib/lark).
      postParagraphsJson: string;
      libraUrl: string;
      abReportUrl?: string;
    }>;
    createdAt: string;
  }>;

  /**
   * Active "Edit" requests in flight. Keyed by the message_id of the
   * bot's "What would you like to change?" thread reply — Junior looks
   * up the entry when it gets a reply in that thread.
   */
  pendingCardEdits?: Record<string, {
    cardMsgId: string;
    cardKind: 'ab_open' | 'ab_concluded';
    featureWorkItemId: string;
    featureName: string;
    chatId: string;
    requestedByOpenId: string;
    requestedAtIso: string;
  }>;

  /**
   * PRD comment threads Junior has posted a reply into. Keyed by
   * `${docId}:${commentId}`. When a Lark drive comment event arrives
   * for a tracked thread, Junior will draft + propose a follow-up
   * reply via the same letjr_reply flow.
   *
   * Phase 1: tracker is saved but webhook handler is a no-op log
   * (we need to see the actual event payload from Lark first).
   */
  juniorCommentThreads?: Record<string, {
    docId: string;
    commentId: string;
    featureWorkItemId?: string;
    featureName?: string;
    prdUrl: string;
    askerOpenId: string;
    lastJuniorReplyAtIso: string;
  }>;

  /**
   * Lark `post` message_id (sent to the PM group via Send-to-PM-Group)
   * → originating feature. Lets Junior auto-resolve the feature
   * context when someone @-mentions the bot in a thread reply on the
   * PM-group post (the chat itself isnt a feature chat, so chatId
   * lookup misses).
   */
  postFeatureMap?: Record<string, {
    workItemId: string;
    featureName: string;
    prdUrl: string;
    sentAtIso: string;
  }>;

  /**
   * Active cron runs — written when an entry-point handler starts and
   * cleared when it ends. Frontend polls this to render the
   * "Junior is working" sidebar status. Stale entries (>15 min) are
   * filtered out on read so a crashed handler doesn't pin the UI.
   */
  cronRuns?: Record<string, {
    /** Cron job's display name from CRON_REGISTRY (cached for the UI). */
    label: string;
    /** ISO timestamp of when the run started. */
    startedAt: string;
    /** 'manual' if triggered from the UI, 'scheduled' when fired by Cloud Scheduler. */
    source: 'manual' | 'scheduled';
  }>;

  /**
   * IDs of cron jobs / digest sub-sections currently paused. When a
   * digest sub-section's id is in this list, lib/digests.ts skips its
   * card. For cloud_scheduler-kind crons the pause is enforced at the
   * Cloud Scheduler level (job state = PAUSED), but we mirror the
   * flag here for consistent UI rendering.
   */
  cronPaused?: string[];

  /**
   * Pending Line Review (PRD Ready ✅) cards queued by the
   * `refresh-feature-cache` job. Consumed + cleared by the
   * `digest-line-review` cron. Each entry produces one feature card
   * sent to the feature's group chat.
   */
  pendingLineReviewCards?: Array<{
    workItemId: string;
    name: string;
    meegoUrl: string;
    prdUrl?: string;
    priority: string;
    queuedAtIso: string;
  }>;

  /**
   * Pending AB-open cards queued by the refresh job. Consumed + cleared
   * by the `digest-ab-open` cron, which loads the full MeegoFeature
   * from the feature-snapshots file by workItemId before sending the
   * aggregate card.
   */
  pendingAbOpenCards?: Array<{
    workItemId: string;
    libraUrl: string;
    queuedAtIso: string;
  }>;

  /**
   * Pending PRD-change cards queued by the refresh job. The refresh
   * job runs the PRD content diff + Gemini summarisation and stores
   * the result here; the `digest-prd-changes` cron sends the aggregate
   * card and clears the queue.
   */
  pendingPrdChanges?: Array<{
    name: string;
    prdUrl: string;
    meegoUrl: string;
    summary: string;
    chatId?: string;
    workItemId?: string;
    pocEmails?: string[];
    queuedAtIso: string;
  }>;
}

/**
 * Cached link-fetch result per feature. Empty-string values mean the link
 * was searched for but not found. A cooldown prevents re-searching too
 * frequently.
 */
export interface CachedFeatureLinks {
  figmaUrl: string;
  abReportUrl: string;
  /** Computed short version number (e.g. "44.9"). Lowest launched version, else lowest planned. */
  versionNumber?: string;
  /** ISO timestamp of the last fetch attempt. Used for retry cooldown. */
  lastFetchedIso: string;
  /** True when ALL fields are non-empty — skip this feature on future runs. */
  allPopulated: boolean;
  /** The PRD URL at the time of fetch — if it changes, re-fetch Figma. */
  prdAtFetch?: string;
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

  // Carry forward optional new fields if present, otherwise leave undefined.
  const discoveredIdsCache = (obj.discoveredIdsCache && typeof obj.discoveredIdsCache === 'object')
    ? (obj.discoveredIdsCache as DigestStateFile['discoveredIdsCache'])
    : undefined;
  const juniorChatsCache = (obj.juniorChatsCache && typeof obj.juniorChatsCache === 'object')
    ? (obj.juniorChatsCache as DigestStateFile['juniorChatsCache'])
    : undefined;
  const watchlist = Array.isArray(obj.watchlist)
    ? (obj.watchlist as unknown[]).filter((x): x is string => typeof x === 'string')
    : undefined;

  const featureLinks = (obj.featureLinks && typeof obj.featureLinks === 'object')
    ? (obj.featureLinks as DigestStateFile['featureLinks'])
    : undefined;
  const larkUserRefreshToken = typeof obj.larkUserRefreshToken === 'string'
    ? obj.larkUserRefreshToken
    : undefined;
  const abOpenNotified = Array.isArray(obj.abOpenNotified)
    ? (obj.abOpenNotified as unknown[]).map(String)
    : undefined;
  const abConcludedNotified = Array.isArray(obj.abConcludedNotified)
    ? (obj.abConcludedNotified as unknown[]).map(String)
    : undefined;
  const lineReviewNotified = Array.isArray(obj.lineReviewNotified)
    ? (obj.lineReviewNotified as unknown[]).map(String)
    : undefined;
  const pendingLetJrReplies = (obj.pendingLetJrReplies && typeof obj.pendingLetJrReplies === 'object')
    ? (obj.pendingLetJrReplies as DigestStateFile['pendingLetJrReplies'])
    : undefined;
  const cardEditContexts = (obj.cardEditContexts && typeof obj.cardEditContexts === 'object')
    ? (obj.cardEditContexts as DigestStateFile['cardEditContexts'])
    : undefined;
  const pendingCardEdits = (obj.pendingCardEdits && typeof obj.pendingCardEdits === 'object')
    ? (obj.pendingCardEdits as DigestStateFile['pendingCardEdits'])
    : undefined;
  const juniorCommentThreads = (obj.juniorCommentThreads && typeof obj.juniorCommentThreads === 'object')
    ? (obj.juniorCommentThreads as DigestStateFile['juniorCommentThreads'])
    : undefined;
  const postFeatureMap = (obj.postFeatureMap && typeof obj.postFeatureMap === 'object')
    ? (obj.postFeatureMap as DigestStateFile['postFeatureMap'])
    : undefined;
  const cronPaused = Array.isArray(obj.cronPaused)
    ? (obj.cronPaused as unknown[]).map(String)
    : undefined;
  const cronRuns = (obj.cronRuns && typeof obj.cronRuns === 'object')
    ? (obj.cronRuns as DigestStateFile['cronRuns'])
    : undefined;
  const pendingLineReviewCards = Array.isArray(obj.pendingLineReviewCards)
    ? (obj.pendingLineReviewCards as DigestStateFile['pendingLineReviewCards'])
    : undefined;
  const pendingAbOpenCards = Array.isArray(obj.pendingAbOpenCards)
    ? (obj.pendingAbOpenCards as DigestStateFile['pendingAbOpenCards'])
    : undefined;
  const pendingPrdChanges = Array.isArray(obj.pendingPrdChanges)
    ? (obj.pendingPrdChanges as DigestStateFile['pendingPrdChanges'])
    : undefined;

  return {
    updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt : new Date().toISOString(),
    recentRunTimes: Array.isArray(obj.recentRunTimes) ? (obj.recentRunTimes as string[]) : [],
    features,
    discoveredIdsCache,
    juniorChatsCache,
    watchlist,
    featureLinks,
    larkUserRefreshToken,
    abOpenNotified,
    abConcludedNotified,
    lineReviewNotified,
    pendingLetJrReplies,
    cardEditContexts,
    pendingCardEdits,
    juniorCommentThreads,
    postFeatureMap,
    cronPaused,
    cronRuns,
    pendingLineReviewCards,
    pendingAbOpenCards,
    pendingPrdChanges,
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

/** TTL for the Junior chats cache (24h). */
const JUNIOR_CHATS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Returns true if the Junior chats cache exists and is younger than the TTL.
 * Used by the discovery flow to decide whether to refetch the chat list from
 * Lark or reuse the cached one.
 */
export function isJuniorChatsCacheFresh(state: DigestStateFile): boolean {
  const cache = state.juniorChatsCache;
  if (!cache || !Array.isArray(cache.chats)) return false;
  const fetchedAt = Date.parse(cache.fetchedAtIso);
  if (isNaN(fetchedAt)) return false;
  return Date.now() - fetchedAt < JUNIOR_CHATS_CACHE_TTL_MS;
}

/** Read the watchlist (manual fallback feature ids), defaulting to empty. */
export function getWatchlist(state: DigestStateFile): string[] {
  return state.watchlist ?? [];
}
