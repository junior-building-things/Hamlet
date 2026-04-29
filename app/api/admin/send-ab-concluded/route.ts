import { NextRequest, NextResponse } from 'next/server';
import { sendAbConcludedDigestCard } from '@/lib/digests';
import { fetchMeegoFeature, TIKTOK_PROJECT_KEY } from '@/lib/meego';
import { readFeatureCache } from '@/lib/feature-cache';

export const dynamic = 'force-dynamic';
export const maxDuration = 600;

const AGENT_RUN_SECRET = process.env.AGENT_RUN_SECRET;

/**
 * Manually fire the AB-concluded card for a specific feature, bypassing
 * the AB Brief calendar-invite gate. Useful for one-off testing /
 * regenerating a card after Hamlet ships a new field.
 *
 * POST { workItemId: string }
 */
export async function POST(req: NextRequest) {
  if (AGENT_RUN_SECRET) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${AGENT_RUN_SECRET}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }
  try {
    const body = await req.json() as { workItemId?: string };
    const workItemId = String(body.workItemId ?? '');
    if (!workItemId) return NextResponse.json({ error: 'missing workItemId' }, { status: 400 });

    const cache = await readFeatureCache();
    const cached = cache?.features.find(f => (f.meegoIssueId ?? f.id) === workItemId);
    if (!cached) return NextResponse.json({ error: 'feature not found in cache' }, { status: 404 });

    const feature = await fetchMeegoFeature(workItemId, cached.name, TIKTOK_PROJECT_KEY);
    if (!feature) return NextResponse.json({ error: 'meego fetch failed' }, { status: 500 });

    await sendAbConcludedDigestCard([{
      feature,
      abReportUrl: cached.abReportUrl ?? '',
      libraUrl: cached.libraUrl ?? '',
    }]);

    return NextResponse.json({ ok: true, sent: feature.name });
  } catch (e) {
    console.error('[admin/send-ab-concluded] error:', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 });
  }
}
