/**
 * Server-side feature cache backed by GCS.
 *
 * Stores the full Feature[] list at gs://tiktok-im-hamlet-state/hamlet/features.json
 * so the Hamlet UI doesn't need browser localStorage for feature data. The cache
 * is shared across browsers/devices and survives page refreshes.
 */

import { readJsonState, writeJsonState } from './gcs-state';
import { Feature } from './types';

const FEATURES_PATH = 'hamlet/features.json';
const DELETED_IDS_PATH = 'hamlet/deleted-ids.json';
const CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

interface FeatureCache {
  updatedAt: string;
  features: Feature[];
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
export async function writeFeatureCache(features: Feature[]): Promise<void> {
  try {
    await writeJsonState(FEATURES_PATH, {
      updatedAt: new Date().toISOString(),
      features,
    } satisfies FeatureCache);
  } catch (e) {
    console.warn('[feature-cache] write failed:', e);
  }
}

/**
 * Update a single feature in the GCS cache (by id). Reads the current
 * cache, merges the updated fields, and writes back. If the cache doesn't
 * exist or the feature isn't in it, this is a no-op.
 */
export async function updateFeatureInCache(
  featureId: string,
  updates: Partial<Feature>,
): Promise<void> {
  try {
    const cache = await readJsonState<FeatureCache>(FEATURES_PATH);
    if (!cache) return;
    const idx = cache.features.findIndex(f => f.id === featureId);
    if (idx === -1) return;
    cache.features[idx] = { ...cache.features[idx], ...updates };
    cache.updatedAt = new Date().toISOString();
    await writeJsonState(FEATURES_PATH, cache);
  } catch (e) {
    console.warn('[feature-cache] update failed:', e);
  }
}

/**
 * Check if the cache is fresh (< CACHE_TTL_MS old).
 */
export function isCacheFresh(cache: FeatureCache): boolean {
  const age = Date.now() - Date.parse(cache.updatedAt);
  return !isNaN(age) && age < CACHE_TTL_MS;
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
