/**
 * Features as Meego sees them right now, with Hamlet's stored fields laid on top.
 * Anything that decides or answers from feature state (status, node, roles,
 * version, priority) reads through here — never from the stored file directly.
 */

import { fetchUserStories, syncFeatureStatus } from './meego';
import { readFeatureCache, readDeletedIds, overlayStored, StoredFeature } from './feature-cache';
import type { Feature, Status } from './types';

const PROJECT_KEY = process.env.MEEGO_PROJECT_KEY ?? '5f105019a8b9a853da64767f';

function storedById(features: StoredFeature[] | undefined): Map<string, StoredFeature> {
  return new Map((features ?? []).map(f => [f.meegoIssueId ?? f.id, f]));
}

/** The feature list with Meego's list-level fields (name, node status, priority, PRD). */
export async function getLiveFeatureList(): Promise<Feature[]> {
  const [raw, deleted, cache] = await Promise.all([
    fetchUserStories(PROJECT_KEY),
    readDeletedIds(),
    readFeatureCache(),
  ]);
  const stored = storedById(cache?.features);
  return raw
    .filter(f => !deleted.has(f.id) && !deleted.has(f.meegoIssueId ?? ''))
    .map(f => overlayStored(f, stored.get(f.meegoIssueId ?? f.id)));
}

/** One feature with every Meego field fetched live. Null if Meego has no such work item. */
export async function getLiveFeature(workItemId: string): Promise<Feature | null> {
  const cache = await readFeatureCache();
  const stored = storedById(cache?.features).get(workItemId);
  const meegoUrl = stored?.meegoUrl || `https://meego.larkoffice.com/${PROJECT_KEY}/story/detail/${workItemId}`;
  const d = await syncFeatureStatus(meegoUrl, undefined, stored?.chatId, { meegoOnly: true });
  if (!d.name) return null;
  const live: Feature = {
    id: workItemId,
    meegoIssueId: workItemId,
    meegoUrl,
    meegoProjectKey: PROJECT_KEY,
    name: d.name,
    description: '',
    status: d.status as Status,
    priority: d.priority ?? 'P1',
    owner: d.owner,
    tasks: [],
    lastUpdated: d.lastUpdated,
    meegoNodeKey: d.meegoNodeKey,
    canCompleteNode: d.canCompleteNode,
    prd: d.prd || undefined,
    complianceUrl: d.complianceUrl || undefined,
    libraUrl: d.libraUrl || undefined,
    quarterlyCycle: d.quarterlyCycle,
    businessLine: d.businessLine,
    socialComponent: d.socialComponent,
    pmOwner: d.pmOwner,
    tpmOwner: d.tpmOwner,
    techOwner: d.techOwner,
    iosOwner: d.iosOwner,
    androidOwner: d.androidOwner,
    serverOwner: d.serverOwner,
    qaOwner: d.qaOwner,
    daOwner: d.daOwner,
    uiuxOwner: d.uiuxOwner,
    contentDesigner: d.contentDesigner,
    iosVersion: d.iosVersion,
    pocEmails: d.pocEmails,
    meegoComments: d.meegoComments,
    avatars: d.meegoAvatars,
  };
  const merged = overlayStored(live, stored);
  // Meego's own experiment-link field beats a stored lookup, unless the link was set by hand.
  if (live.libraUrl && !stored?.manualEdits?.includes('libraUrl')) merged.libraUrl = live.libraUrl;
  merged.avatars = { ...live.avatars, ...stored?.avatars };
  return merged;
}
