/**
 * Snapshot of the latest Meego feature pull, used by the split digest jobs.
 *
 * The daily digest used to be one big cron that pulled Meego + sent every
 * card in one shot. Splitting into per-section Cloud Scheduler jobs means
 * the section jobs need somewhere to read the (already-fetched) feature
 * data without each one calling Meego itself.
 *
 * The `refresh-feature-cache` cron writes this file (after pulling Meego
 * + resolving deadlines + chat IDs). The section crons read from it.
 *
 * Stored at gs://tiktok-im-hamlet-state/digests/feature-snapshots.json.
 *
 * This is intentionally a SEPARATE file from `feature-cache.json`
 * (which holds the flatter `Feature` shape consumed by the Hamlet UI).
 * Snapshots store the full `MeegoFeature` shape — raw Chinese statuses,
 * roles, deadline dates, chat IDs — that the digest pipeline needs.
 */

import { readJsonState, writeJsonState } from './gcs-state';
import type { MeegoFeature } from './digests';
import type { JuniorChatCacheEntry } from './digest-state';

const SNAPSHOTS_PATH = 'digests/feature-snapshots.json';

export interface FeatureSnapshotsFile {
  /** ISO timestamp the refresh job wrote this file. */
  refreshedAtIso: string;
  /** Full MeegoFeature payload, keyed by workItemId. */
  features: Record<string, MeegoFeature>;
  /** workItemIds the refresh classified as in-dev (subset of features). */
  inDevIds: string[];
  /** Junior's Lark chat list at refresh time (so section jobs can iterate). */
  juniorChats: JuniorChatCacheEntry[];
}

export async function loadFeatureSnapshots(): Promise<FeatureSnapshotsFile | null> {
  try {
    const raw = await readJsonState<FeatureSnapshotsFile>(SNAPSHOTS_PATH);
    return raw ?? null;
  } catch (e) {
    console.warn('[feature-snapshots] load failed:', e);
    return null;
  }
}

export async function saveFeatureSnapshots(file: FeatureSnapshotsFile): Promise<void> {
  try {
    await writeJsonState(SNAPSHOTS_PATH, file);
  } catch (e) {
    console.warn('[feature-snapshots] save failed:', e);
  }
}
