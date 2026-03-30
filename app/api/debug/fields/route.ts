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
    // Step 1: Get a real TikTok story ID from list_todo
    const todoRaw = await callMeegoMcp('list_todo', { action: 'todo', page_num: 1 });
    const todoData = JSON.parse(todoRaw);
    const tiktokItem = (todoData.list ?? []).find(
      (item: { project_key: string; work_item_info: { work_item_type_key: string } }) =>
        item.project_key === TIKTOK_PROJECT_KEY &&
        item.work_item_info.work_item_type_key === 'story'
    );

    if (!tiktokItem) {
      return NextResponse.json({ error: 'No TikTok story found in todo list' });
    }

    const workItemId = tiktokItem.work_item_info.work_item_id;
    const url = `https://meego.larkoffice.com/${TIKTOK_PROJECT_KEY}/story/detail/${workItemId}`;

    // Step 2: Get full brief for this actual TikTok story
    const raw = await callMeegoMcp('get_workitem_brief', { url });

    // Extract lines containing version/iOS related content
    const versionLines = raw.split('\n').filter((l: string) =>
      l.includes('版本') || l.toLowerCase().includes('version') || l.toLowerCase().includes('ios') || l.toLowerCase().includes('planned')
    );

    return NextResponse.json({
      workItemId,
      versionRelatedLines: versionLines,
      fullBrief: raw,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
