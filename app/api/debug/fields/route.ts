import { NextResponse } from 'next/server';

const MEEGO_MCP_URL = 'https://meego.larkoffice.com/mcp_server/v1';
const TIKTOK_PROJECT_KEY = '5f105019a8b9a853da64767f';

async function callMeegoMcp(toolName: string, args: Record<string, unknown>) {
  const token = process.env.MEEGO_USER_TOKEN;
  if (!token) throw new Error('MEEGO_USER_TOKEN not configured');

  const res = await fetch(MEEGO_MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Mcp-Token': token,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
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
    // Get a sample work item brief with all default fields
    const raw = await callMeegoMcp('get_workitem_brief', {
      url: `https://meego.larkoffice.com/${TIKTOK_PROJECT_KEY}/story/detail/3752309`,
      fields: [],
    });

    // Also try MQL to find version-related fields
    let mqlResult = '';
    try {
      mqlResult = await callMeegoMcp('search_by_mql', {
        project_key: TIKTOK_PROJECT_KEY,
        mql: `SELECT * FROM \`TikTok\`.\`需求\` WHERE \`work_item_id\` = 3752309`,
      });
    } catch (e) {
      mqlResult = `MQL error: ${e}`;
    }

    return NextResponse.json({ brief: raw, mql: mqlResult });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
