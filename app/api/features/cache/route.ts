import { NextRequest, NextResponse } from 'next/server';
import { readFeatureCache, writeFeatureCache } from '@/lib/feature-cache';

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

/**
 * DELETE /api/features/cache
 *
 * Remove a feature from the GCS cache by its ID. Used when a sync
 * detects a deleted work item — prevents it from reappearing on refresh.
 */
export async function DELETE(req: NextRequest) {
  const { featureId } = await req.json() as { featureId?: string };
  if (!featureId) {
    return NextResponse.json({ error: 'featureId required' }, { status: 400 });
  }
  try {
    const cache = await readFeatureCache();
    if (!cache) return NextResponse.json({ ok: true });
    const before = cache.features.length;
    cache.features = cache.features.filter(
      f => f.id !== featureId && f.meegoIssueId !== featureId,
    );
    if (cache.features.length < before) {
      await writeFeatureCache(cache.features);
    }
    return NextResponse.json({ ok: true, removed: before - cache.features.length });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Delete failed' },
      { status: 500 },
    );
  }
}
