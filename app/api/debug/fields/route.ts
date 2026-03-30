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
    // 1. Get all fields and search for 预计上车 or iOS预计
    const raw = await callTool('list_workitem_field_config', {
      project_key: TIKTOK_PROJECT_KEY,
      work_item_type: 'story',
    });
    const parsed = JSON.parse(raw);
    const fields = (parsed.list ?? parsed) as Array<{ field_key: string; field_name: string; field_type: string }>;

    const iosFields = fields.filter((f: { field_name: string }) =>
      f.field_name.includes('预计上车') || f.field_name.includes('上车版本') ||
      f.field_name.includes('iOS预计') || f.field_name.includes('预计版本')
    );

    // 2. Try get_workitem_brief with likely field keys to see if value comes through
    // Try some common patterns for the field
    const testKeys = ['ios_estimated_version', 'field_ios_estimated_version', 'ios_planned_version',
      'ios_release_version', 'estimated_version',
      // Try all field_XXX keys from the list that weren't in the filtered results
      ...fields.filter((f: { field_key: string }) => f.field_key.startsWith('field_')).map((f: { field_key: string }) => f.field_key)
    ];

    // Get a real work item with a known iOS version
    const briefRaw = await callTool('get_workitem_brief', {
      url: `https://meego.larkoffice.com/${TIKTOK_PROJECT_KEY}/story/detail/15547111`,
      fields: testKeys,
    });

    // Extract just the 工作项字段 section
    const fieldSection = briefRaw.split('# 工作项字段')[1]?.split('# 进行中')[0] ?? '';

    // 3. Also try node-level fields
    const nodeFields = await callTool('list_node_field_config', {
      project_key: TIKTOK_PROJECT_KEY,
      work_item_type: 'story',
    });
    const nodeParsed = JSON.parse(nodeFields);
    const nodeList = (nodeParsed.list ?? nodeParsed) as Array<{ field_key: string; field_name: string }>;
    const iosNodeFields = nodeList.filter((f: { field_name: string }) =>
      f.field_name.includes('预计') || f.field_name.includes('上车') || f.field_name.includes('iOS')
    );

    return NextResponse.json({
      iosFields,
      fieldSection: fieldSection.trim(),
      iosNodeFields,
      allFieldNames: fields.map((f: { field_key: string; field_name: string }) => `${f.field_key}: ${f.field_name}`),
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
