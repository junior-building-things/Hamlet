/**
 * Each feature's overall status as of the previous digest run, keyed by
 * workItemId. Meego only knows the current status, so this is what lets the
 * digest spot a transition (e.g. PRD/Design Prep → Line Review). Written on
 * every run, full or refresh. Holds nothing else — the digest reads the rest
 * of a feature live from Meego.
 *
 * Stored at gs://tiktok-im-hamlet-state/digests/last-statuses.json.
 */

import { readJsonState, writeJsonState } from './gcs-state';

const PATH = 'digests/last-statuses.json';

interface LastStatusesFile {
  updatedAtIso: string;
  /** workItemId → display status (resolveDisplayStatus output). */
  statuses: Record<string, string>;
}

export async function loadLastStatuses(): Promise<Map<string, string>> {
  try {
    const file = await readJsonState<LastStatusesFile>(PATH);
    return new Map(Object.entries(file?.statuses ?? {}));
  } catch (e) {
    console.warn('[last-statuses] load failed:', e);
    return new Map();
  }
}

export async function saveLastStatuses(statuses: Map<string, string>): Promise<void> {
  try {
    await writeJsonState(PATH, {
      updatedAtIso: new Date().toISOString(),
      statuses: Object.fromEntries(statuses),
    } satisfies LastStatusesFile);
  } catch (e) {
    console.warn('[last-statuses] save failed:', e);
  }
}
