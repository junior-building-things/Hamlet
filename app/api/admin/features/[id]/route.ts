import { NextRequest, NextResponse } from 'next/server';
import { getLiveFeature } from '@/lib/live-features';

export const dynamic = 'force-dynamic';

const AGENT_RUN_SECRET = process.env.AGENT_RUN_SECRET;

/**
 * GET /api/admin/features/<workItemId> — one feature with every Meego field
 * fetched live (overall status, node, roles, version, comments), plus Hamlet's
 * stored fields. For Junior. Requires Authorization: Bearer $AGENT_RUN_SECRET.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (AGENT_RUN_SECRET && req.headers.get('authorization') !== `Bearer ${AGENT_RUN_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  try {
    const feature = await getLiveFeature(id);
    if (!feature) return NextResponse.json({ error: 'not found in Meego' }, { status: 404 });
    return NextResponse.json({ feature });
  } catch (e) {
    console.error('[admin/features/:id] error:', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 });
  }
}
