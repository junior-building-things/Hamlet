import { NextResponse } from 'next/server';
import { fetchUserStories } from '@/lib/meego';
import { readFeatureCache, writeFeatureCache, isCacheFresh, readDeletedIds } from '@/lib/feature-cache';

export const dynamic = 'force-dynamic';

/**
 * GET /api/meego/features
 *
 * Returns the full feature list. Checks GCS cache first — if fresh (<2h),
 * returns cached data immediately. Otherwise fetches live from Meego MCP,
 * writes to cache, and returns.
 *
 * Query param: ?force=1 bypasses the cache (used by Sync All).
 */
export async function GET(req: Request) {
  const force = new URL(req.url).searchParams.get('force') === '1';
  const projectKey = process.env.MEEGO_PROJECT_KEY ?? '5f105019a8b9a853da64767f';

  // Check GCS cache first (unless force-refresh).
  if (!force) {
    try {
      const cache = await readFeatureCache();
      if (cache && isCacheFresh(cache)) {
        return NextResponse.json({ features: cache.features, cached: true });
      }
    } catch { /* fall through to live fetch */ }
  }

  // Live fetch from Meego.
  try {
    const raw = await fetchUserStories(projectKey);
    // Filter out features that were previously detected as deleted in Meego.
    // list_todo and MQL can still return deleted work items.
    const deletedIds = await readDeletedIds();
    const features = deletedIds.size > 0
      ? raw.filter(f => !deletedIds.has(f.id) && !deletedIds.has(f.meegoIssueId ?? ''))
      : raw;
    // Merge with existing cache to preserve enriched fields that fetchUserStories
    // doesn't return (versionHistory, avatars, risk, team roles, package URLs,
    // chatId, etc.) plus manualEdits and the manually edited field values.
    try {
      const prevCache = await readFeatureCache();
      if (prevCache) {
        const prevById = new Map(prevCache.features.map(f => [f.meegoIssueId ?? f.id, f]));
        for (let i = 0; i < features.length; i++) {
          const prev = prevById.get(features[i].meegoIssueId ?? features[i].id);
          if (!prev) continue;
          // Start from prev (has all enriched fields), then overwrite with
          // fresh fields the live fetch is authoritative for.
          const merged = {
            ...prev,
            name: features[i].name,
            priority: features[i].priority,
            meegoUrl: features[i].meegoUrl,
            meegoProjectKey: features[i].meegoProjectKey,
            meegoIssueId: features[i].meegoIssueId,
            meegoNodeKey: features[i].meegoNodeKey || prev.meegoNodeKey,
            lastUpdated: features[i].lastUpdated || prev.lastUpdated,
            prd: features[i].prd || prev.prd,
            complianceUrl: features[i].complianceUrl || prev.complianceUrl,
          };
          // Restore manually edited field values (override the fresh data)
          if (prev.manualEdits && prev.manualEdits.length > 0) {
            for (const key of prev.manualEdits) {
              if (key in prev) (merged as unknown as Record<string, unknown>)[key] = (prev as unknown as Record<string, unknown>)[key];
            }
          }
          features[i] = merged;
        }
      }
      await writeFeatureCache(features);
    } catch (e) { console.warn('[features] cache write failed:', e); }
    return NextResponse.json({ features, cached: false });
  } catch (err) {
    console.error('Failed to fetch Meego features:', err);
    // If live fetch fails, try returning stale cache as fallback.
    try {
      const stale = await readFeatureCache();
      if (stale) {
        return NextResponse.json({ features: stale.features, cached: true, stale: true });
      }
    } catch { /* ignore */ }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch features' },
      { status: 500 },
    );
  }
}
