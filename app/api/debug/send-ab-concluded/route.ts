import { NextRequest, NextResponse } from 'next/server';
import { sendAbConcludedDigestCard } from '@/lib/digests';
import { loadFeatureSnapshots } from '@/lib/feature-snapshots';
import { readFeatureCache } from '@/lib/feature-cache';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Diagnostic / one-off: force-send an AB-concluded card for a single
 * feature. Bypasses the AB-Brief detection scan and the
 * abConcludedNotified dedup so you can re-trigger as needed.
 *
 *   GET /api/debug/send-ab-concluded?workItemId=6840098152
 */
export async function GET(req: NextRequest) {
  const workItemId = req.nextUrl.searchParams.get('workItemId');
  if (!workItemId) return NextResponse.json({ error: 'workItemId param required' }, { status: 400 });

  const snapshots = await loadFeatureSnapshots();
  if (!snapshots) return NextResponse.json({ error: 'no feature-snapshots.json' }, { status: 500 });
  const feature = snapshots.features[workItemId];
  if (!feature) return NextResponse.json({ error: `feature ${workItemId} not in snapshots` }, { status: 404 });

  // Resolve abReportUrl + libraUrl the same way the scan does (Hamlet
  // feature cache first, then digest link cache).
  const cache = await readFeatureCache();
  const cached = cache?.features.find(f => (f.meegoIssueId ?? f.id) === workItemId);
  const abReportUrl = cached?.abReportUrl ?? '';
  const libraUrl = cached?.libraUrl ?? '';
  if (!abReportUrl) {
    return NextResponse.json({
      error: 'no abReportUrl on feature — card needs an AB Report link to summarise',
      featureName: feature.name,
    }, { status: 400 });
  }

  try {
    await sendAbConcludedDigestCard([{ feature, abReportUrl, libraUrl }]);
    return NextResponse.json({
      ok: true,
      featureName: feature.name,
      workItemId,
      abReportUrl,
      libraUrl,
    });
  } catch (e) {
    return NextResponse.json({
      error: e instanceof Error ? e.message : String(e),
    }, { status: 500 });
  }
}
