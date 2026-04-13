import { NextResponse } from 'next/server';
import { readFeatureCache } from '@/lib/feature-cache';

export const dynamic = 'force-dynamic';

/**
 * GET /api/features/cache
 *
 * Fast read-only endpoint: returns the cached feature list from GCS without
 * touching Meego. Used for instant page loads — the frontend calls this
 * first, then triggers a background sync if the data is stale.
 *
 * Returns { features, updatedAt } or 404 if no cache exists.
 */
export async function GET() {
  try {
    const cache = await readFeatureCache();
    if (!cache) {
      return NextResponse.json({ error: 'No cached data' }, { status: 404 });
    }
    return NextResponse.json({
      features: cache.features,
      updatedAt: cache.updatedAt,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Cache read failed' },
      { status: 500 },
    );
  }
}
