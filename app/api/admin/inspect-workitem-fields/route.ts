import { NextRequest, NextResponse } from 'next/server';
import { callMeegoMcp } from '@/lib/meego';

const TIKTOK_PROJECT_KEY = '5f105019a8b9a853da64767f';
const SECRET = process.env.AGENT_RUN_SECRET;
const MEEGO_MCP_URL = 'https://meego.larkoffice.com/mcp_server/v1';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Debug endpoint for Meego MCP — list tools, dump fields, or call any
 * tool by name. Used to harvest field/option IDs.
 *
 *   GET /api/admin/inspect-workitem-fields?action=list-tools
 *   GET /api/admin/inspect-workitem-fields?workItemId=...
 *   GET /api/admin/inspect-workitem-fields?tool=<name>&args=<json>
 */
export async function GET(req: NextRequest) {
  if (!SECRET) return NextResponse.json({ error: 'AGENT_RUN_SECRET not configured' }, { status: 500 });
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${SECRET}`) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const action = req.nextUrl.searchParams.get('action');
  const tool = req.nextUrl.searchParams.get('tool');
  const argsParam = req.nextUrl.searchParams.get('args');
  const workItemId = req.nextUrl.searchParams.get('workItemId');

  try {
    if (action === 'list-tools') {
      const token = process.env.MEEGO_USER_TOKEN;
      if (!token) throw new Error('MEEGO_USER_TOKEN not set');
      const res = await fetch(MEEGO_MCP_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Mcp-Token': token },
        body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/list' }),
      });
      const data = await res.json();
      return NextResponse.json(data);
    }

    if (tool) {
      const args = argsParam ? JSON.parse(argsParam) : {};
      const raw = await callMeegoMcp(tool, args);
      return NextResponse.json({ tool, raw });
    }

    if (workItemId) {
      const fieldsParam = req.nextUrl.searchParams.get('fields');
      const args: Record<string, unknown> = {
        project_key: TIKTOK_PROJECT_KEY,
        work_item_id: workItemId,
      };
      if (fieldsParam) args.fields = fieldsParam.split(',');
      const raw = await callMeegoMcp('get_workitem_brief', args);
      return NextResponse.json({ workItemId, raw });
    }

    return NextResponse.json({ error: 'specify action, tool, or workItemId' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 });
  }
}
