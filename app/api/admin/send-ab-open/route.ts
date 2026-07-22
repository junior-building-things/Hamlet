import { NextRequest, NextResponse } from 'next/server';
import { sendAbOpenDigestCard, fetchMeegoFeature } from '@/lib/digests';
import { readFeatureCache } from '@/lib/feature-cache';

const TIKTOK_PROJECT_KEY = '5f105019a8b9a853da64767f';

export const dynamic = 'force-dynamic';
export const maxDuration = 600;

const AGENT_RUN_SECRET = process.env.AGENT_RUN_SECRET;

/**
 * Manually fire the AB-open card for a specific feature, bypassing the
 * daily-scan transition detector. Useful for one-off testing or
 * regenerating a card after Hamlet ships a new field.
 *
 * POST { workItemId: string, libraUrl?: string }
 *
 * libraUrl overrides the cached value — handy when firing a card for a
 * feature whose Libra link hasn't been saved to the cache yet.
 */
export async function POST(req: NextRequest) {
  if (AGENT_RUN_SECRET) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${AGENT_RUN_SECRET}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }
  try {
    const body = await req.json() as { workItemId?: string; libraUrl?: string };
    const workItemId = String(body.workItemId ?? '');
    if (!workItemId) return NextResponse.json({ error: 'missing workItemId' }, { status: 400 });

    const cache = await readFeatureCache();
    const cached = cache?.features.find(f => (f.meegoIssueId ?? f.id) === workItemId);
    if (!cached) return NextResponse.json({ error: 'feature not found in cache' }, { status: 404 });

    const feature = await fetchMeegoFeature(workItemId, cached.name, TIKTOK_PROJECT_KEY);
    if (!feature) return NextResponse.json({ error: 'meego fetch failed' }, { status: 500 });

    await sendAbOpenDigestCard([{
      feature,
      libraUrl: body.libraUrl?.trim() || cached.libraUrl || '',
    }]);

    return NextResponse.json({ ok: true, sent: feature.name });
  } catch (e) {
    console.error('[admin/send-ab-open] error:', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 });
  }
}
