import { NextRequest, NextResponse } from 'next/server';
import { getLiveFeatureList } from '@/lib/live-features';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const AGENT_RUN_SECRET = process.env.AGENT_RUN_SECRET;

/**
 * GET /api/admin/features — Thomas's features, live from Meego, with Hamlet's
 * stored fields on top. List-level Meego fields only (name, node status,
 * priority, PRD); use /api/admin/features/<workItemId> for the full detail.
 * For Junior. Requires Authorization: Bearer $AGENT_RUN_SECRET.
 */
export async function GET(req: NextRequest) {
  if (AGENT_RUN_SECRET && req.headers.get('authorization') !== `Bearer ${AGENT_RUN_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    return NextResponse.json({ features: await getLiveFeatureList() });
  } catch (e) {
    console.error('[admin/features] error:', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 });
  }
}
