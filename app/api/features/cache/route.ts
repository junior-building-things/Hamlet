import { NextRequest, NextResponse } from 'next/server';
import { readFeatureCache, writeFeatureCache } from '@/lib/feature-cache';

export const dynamic = 'force-dynamic';

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
