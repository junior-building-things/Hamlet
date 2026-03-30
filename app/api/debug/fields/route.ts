import { NextResponse } from 'next/server';

const MEEGO_MCP_URL = 'https://meego.larkoffice.com/mcp_server/v1';
const TIKTOK_PROJECT_KEY = '5f105019a8b9a853da64767f';

async function callTool(toolName: string, args: Record<string, unknown>) {
  const token = process.env.MEEGO_USER_TOKEN;
  if (!token) throw new Error('MEEGO_USER_TOKEN not configured');

  const res = await fetch(MEEGO_MCP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Mcp-Token': token },
    body: JSON.stringify({
      jsonrpc: '2.0', id: Date.now(), method: 'tools/call',
      params: { name: toolName, arguments: args },
    }),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.result?.content?.[0]?.text ?? '';
}

export async function GET() {
  try {
    const raw = await callTool('list_workitem_field_config', {
      project_key: TIKTOK_PROJECT_KEY,
      work_item_type: 'story',
    });

    const parsed = JSON.parse(raw);
    const fields = (parsed.list ?? parsed) as Array<{ field_key: string; field_name: string; field_type: string }>;

    // Find iOS/version related fields
    const versionFields = fields.filter((f: { field_name: string; field_key: string }) =>
      f.field_name.includes('版本') || f.field_name.toLowerCase().includes('version') ||
      f.field_name.toLowerCase().includes('ios') || f.field_name.includes('planned')
    );

    return NextResponse.json({
      totalFields: fields.length,
      versionFields,
      // Also return all field names for reference
      allFields: fields.map((f: { field_key: string; field_name: string; field_type: string }) => ({
        key: f.field_key, name: f.field_name, type: f.field_type,
      })),
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
