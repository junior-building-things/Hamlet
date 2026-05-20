import { NextRequest, NextResponse } from 'next/server';
import { callMeegoMcp } from '@/lib/meego';

const TIKTOK_PROJECT_KEY = '5f105019a8b9a853da64767f';
const SECRET = process.env.AGENT_RUN_SECRET;

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Dump select Meego field values for a workItem so option IDs can be
 * harvested (e.g. for the FeatureModal's BUSINESS_LINES list).
 *
 * GET /api/admin/inspect-workitem-fields?workItemId=...
 */
export async function GET(req: NextRequest) {
  if (!SECRET) return NextResponse.json({ error: 'AGENT_RUN_SECRET not configured' }, { status: 500 });
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${SECRET}`) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const workItemId = req.nextUrl.searchParams.get('workItemId');
  if (!workItemId) return NextResponse.json({ error: 'missing workItemId' }, { status: 400 });

  try {
    const fieldsParam = req.nextUrl.searchParams.get('fields');
    const args: Record<string, unknown> = {
      project_key: TIKTOK_PROJECT_KEY,
      work_item_id: workItemId,
    };
    if (fieldsParam) args.fields = fieldsParam.split(',');
    const raw = await callMeegoMcp('get_workitem_brief', args);
    return NextResponse.json({ workItemId, raw });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 });
  }
}
