import { NextResponse } from 'next/server';
import { fetchUserStories } from '@/lib/meego';
import { readFeatureCache, writeFeatureCache, isCacheFresh } from '@/lib/feature-cache';

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
    const features = await fetchUserStories(projectKey);
    // Write to GCS cache in background (don't block the response).
    writeFeatureCache(features).catch(e => console.warn('[features] cache write failed:', e));
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
