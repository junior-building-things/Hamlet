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

export async function GET(req: Request) {
  const url = new URL(req.url);
  const storyId = url.searchParams.get('id') || '15547111';

  try {
    // Get all field keys from config
    const raw = await callTool('list_workitem_field_config', {
      project_key: TIKTOK_PROJECT_KEY,
      work_item_type: 'story',
    });
    const parsed = JSON.parse(raw);
    const configKeys = (parsed.list ?? parsed).map((f: { field_key: string }) => f.field_key);

    // Also include the known custom fields that aren't in the config
    const knownCustom = ['field_due3fb', 'field_532e61', 'field_a4c558', 'field_2e7909', 'field_675419',
      'field_40694f', 'field_2177d5', 'field_894cbf', 'field_391771'];

    // Get brief with ALL fields
    const allKeys = [...new Set([...configKeys, ...knownCustom])];
    const briefRaw = await callTool('get_workitem_brief', {
      url: `https://meego.larkoffice.com/${TIKTOK_PROJECT_KEY}/story/detail/${storyId}`,
      fields: allKeys,
    });

    // Extract the 工作项字段 section
    const fieldSection = briefRaw.split('# 工作项字段')[1]?.split('# 进行中')[0] ?? '(empty)';

    // Filter for version/iOS lines
    const allLines = briefRaw.split('\n');
    const versionLines = allLines.filter((l: string) =>
      l.includes('版本') || l.includes('version') || l.includes('Version') || l.includes('iOS')
    );

    return NextResponse.json({
      storyId,
      fieldSection: fieldSection.trim(),
      versionLines,
      totalKeysRequested: allKeys.length,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
