import { NextResponse } from 'next/server';

const MEEGO_MCP_URL = 'https://meego.larkoffice.com/mcp_server/v1';
const TIKTOK_PROJECT_KEY = '5f105019a8b9a853da64767f';

async function mcpCall(method: string, params: Record<string, unknown> = {}) {
  const token = process.env.MEEGO_USER_TOKEN;
  if (!token) throw new Error('MEEGO_USER_TOKEN not configured');

  const res = await fetch(MEEGO_MCP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Mcp-Token': token },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function callTool(toolName: string, args: Record<string, unknown>) {
  const data = await mcpCall('tools/call', { name: toolName, arguments: args });
  if (data.error) throw new Error(data.error.message);
  return data.result?.content?.[0]?.text ?? '';
}

export async function GET() {
  try {
    // 1. List all MCP tools
    const toolsData = await mcpCall('tools/list');
    const tools = toolsData.result?.tools?.map((t: { name: string; description?: string }) => ({
      name: t.name,
      desc: t.description?.slice(0, 120),
    })) ?? [];

    // 2. Try get_field_list or similar if available
    let fieldList = null;
    const fieldTool = tools.find((t: { name: string }) =>
      t.name.includes('field') && (t.name.includes('list') || t.name.includes('schema') || t.name.includes('def'))
    );
    if (fieldTool) {
      try {
        fieldList = await callTool(fieldTool.name, { project_key: TIKTOK_PROJECT_KEY, work_item_type: 'story' });
      } catch (e) {
        fieldList = `Error: ${e}`;
      }
    }

    // 3. Try get_workitem_brief with many potential iOS version field keys
    const testFields = [
      'field_ios_version', 'ios_planned_version', 'field_ios_planned_version',
      'planned_version', 'version', 'ios_version',
    ];
    let briefWithFields = '';
    try {
      briefWithFields = await callTool('get_workitem_brief', {
        url: `https://meego.larkoffice.com/${TIKTOK_PROJECT_KEY}/story/detail/15547111`,
        fields: testFields,
      });
    } catch (e) {
      briefWithFields = `Error: ${e}`;
    }

    return NextResponse.json({ tools, fieldTool: fieldTool?.name, fieldList, briefWithFields });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
