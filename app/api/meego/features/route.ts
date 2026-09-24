import { NextResponse } from 'next/server';
import { getLiveFeatureList } from '@/lib/live-features';
import { readFeatureCache, writeFeatureCache, toStored } from '@/lib/feature-cache';

export const dynamic = 'force-dynamic';

/**
 * GET /api/meego/features
 *
 * The feature list, always fetched live from Meego, with Hamlet's stored
 * fields (notes, toggles, hand-edited links, Libra / package lookups) laid on
 * top. Also records any newly discovered features so their Hamlet fields
 * have somewhere to live.
 */
export async function GET() {
  try {
    const features = await getLiveFeatureList();
    try {
      const prev = await readFeatureCache();
      const byId = new Map((prev?.features ?? []).map(f => [f.meegoIssueId ?? f.id, f]));
      for (const f of features) {
        const id = f.meegoIssueId ?? f.id;
        if (!byId.has(id)) byId.set(id, toStored(f));
      }
      if (byId.size !== (prev?.features.length ?? 0)) await writeFeatureCache([...byId.values()]);
    } catch (e) { console.warn('[features] recording new features failed:', e); }
    return NextResponse.json({ features, cached: false });
  } catch (err) {
    console.error('Failed to fetch Meego features:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch features' },
      { status: 500 },
    );
  }
}
