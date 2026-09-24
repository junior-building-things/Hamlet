/**
 * Hamlet's own per-feature data, backed by GCS at
 * gs://tiktok-im-hamlet-state/hamlet/features.json.
 *
 * Only fields Meego doesn't have are stored here (see HAMLET_FIELDS): notes,
 * toggles, hand-edited links, and slow lookups like Libra / packages / chat.
 * Name, status, node, priority, roles and version come from Meego live
 * (lib/live-features.ts) and are never read from this file.
 */

import { readJsonState, writeJsonState, updateJsonState } from './gcs-state';
import { Feature } from './types';

const FEATURES_PATH = 'hamlet/features.json';
const DELETED_IDS_PATH = 'hamlet/deleted-ids.json';

/** Fields Hamlet owns. Everything else on a Feature is Meego's and is fetched live. */
const HAMLET_FIELDS = [
  'id', 'meegoIssueId', 'meegoUrl', 'description', 'tasks', 'manualEdits',
  'notes', 'notesEditedAt', 'prdChangeLogEnabled', 'agents', 'agentLastRun',
  'chatId', 'avatars', 'figmaUrl', 'abReportUrl', 'libraUrl',
  'bitsAndroidUrl', 'bitsIosUrl',
  'packageQrUrl', 'packageDownloadUrl', 'packageName', 'packageBuildTime',
  'iosPackageQrUrl', 'iosPackageDownloadUrl', 'iosPackageName', 'iosPackageBuildTime',
  'commentSummary', 'riskLevel', 'riskNotes', 'riskHistory',
  'versionHistory', 'versionChanges', 'versionChangesScannedThroughIso',
  'prdUpdates', 'unansweredQuestions',
] as const satisfies readonly (keyof Feature)[];

type HamletField = typeof HAMLET_FIELDS[number];
/** A stored entry: Hamlet-owned fields, plus Meego fields only where hand-edited (listed in manualEdits). */
export type StoredFeature = Pick<Feature, 'id'> & Partial<Pick<Feature, HamletField>> & Partial<Feature>;

interface FeatureCache {
  updatedAt: string;
  features: StoredFeature[];
}

/** Drop every Meego-owned field, keeping ones the user edited by hand. */
export function toStored(f: Partial<Feature> & { id: string }): StoredFeature {
  const out: Record<string, unknown> = {};
  const keep = new Set<string>([...HAMLET_FIELDS, ...(f.manualEdits ?? [])]);
  for (const [k, v] of Object.entries(f)) if (keep.has(k) && v !== undefined) out[k] = v;
  return out as StoredFeature;
}

/** Stored Hamlet fields laid over live Meego data; hand-edited fields win. */
export function overlayStored(live: Feature, stored: StoredFeature | undefined): Feature {
  return stored ? { ...live, ...toStored(stored) } : live;
}

/**
 * Read the cached features from GCS. Returns null if the cache doesn't
 * exist or can't be read. The caller checks freshness via `updatedAt`.
 */
export async function readFeatureCache(): Promise<FeatureCache | null> {
  try {
    return await readJsonState<FeatureCache>(FEATURES_PATH);
  } catch (e) {
    console.warn('[feature-cache] read failed:', e);
    return null;
  }
}

/**
 * Write the feature list to the GCS cache with the current timestamp.
 */
export async function writeFeatureCache(features: StoredFeature[]): Promise<void> {
  try {
    await writeJsonState(FEATURES_PATH, {
      updatedAt: new Date().toISOString(),
      features: features.map(toStored),
    } satisfies FeatureCache);
  } catch (e) {
    console.warn('[feature-cache] write failed:', e);
  }
}

/**
 * Update a single feature in the GCS cache (by id). Uses an optimistic
 * read-modify-write loop with GCS generation preconditions, so a
 * concurrent writer (e.g. the digest pipeline rewriting the cache from
 * Step 6b) can't silently lose this update or vice versa. If the cache
 * doesn't exist or the feature isn't in it, this is a no-op.
 */
export async function updateFeatureInCache(
  featureId: string,
  updates: Partial<Feature>,
): Promise<void> {
  try {
    await updateJsonState<FeatureCache>(FEATURES_PATH, (cache) => {
      if (!cache) return { updatedAt: new Date().toISOString(), features: [] };
      const idx = cache.features.findIndex(f => f.id === featureId);
      if (idx !== -1) {
        cache.features[idx] = toStored({ ...cache.features[idx], ...updates });
      }
      cache.updatedAt = new Date().toISOString();
      return cache;
    });
  } catch (e) {
    console.warn('[feature-cache] update failed:', e);
  }
}

/**
 * Apply per-feature field deltas to the GCS cache atomically. Used by
 * the digest pipeline so Step 6b's risk + versionChanges writes don't
 * race with concurrent per-card sync calls. Each entry's value is
 * shallow-merged onto the matching cached feature (looked up by id or
 * meegoIssueId). Features not present in the cache are skipped.
 */
export async function patchFeaturesInCache(
  deltas: Map<string, Partial<Feature>>,
): Promise<void> {
  if (deltas.size === 0) return;
  try {
    await updateJsonState<FeatureCache>(FEATURES_PATH, (cache) => {
      if (!cache) return { updatedAt: new Date().toISOString(), features: [] };
      for (const [id, delta] of deltas) {
        const idx = cache.features.findIndex(f => (f.meegoIssueId ?? f.id) === id || f.id === id);
        if (idx !== -1) {
          cache.features[idx] = toStored({ ...cache.features[idx], ...delta });
        }
      }
      cache.updatedAt = new Date().toISOString();
      return cache;
    });
  } catch (e) {
    console.warn('[feature-cache] patch failed:', e);
  }
}

// ─── Deleted feature IDs ────────────────────────────────────────────────────

/**
 * Read the set of deleted feature IDs from GCS.
 * These are features that were confirmed deleted in Meego and should
 * be filtered out of any list_todo / MQL results.
 */
export async function readDeletedIds(): Promise<Set<string>> {
  try {
    const data = await readJsonState<{ ids: string[] }>(DELETED_IDS_PATH);
    return new Set(data?.ids ?? []);
  } catch {
    return new Set();
  }
}

/**
 * Add a feature ID to the persistent deleted-IDs list.
 */
export async function markFeatureDeleted(featureId: string): Promise<void> {
  try {
    const existing = await readDeletedIds();
    existing.add(featureId);
    await writeJsonState(DELETED_IDS_PATH, { ids: [...existing] });
  } catch (e) {
    console.warn('[feature-cache] markFeatureDeleted failed:', e);
  }
}
