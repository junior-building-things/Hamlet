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
  const storyId = url.searchParams.get('id') || '6740389019';

  try {
    // 1. Get node details for the iOS development node
    const nodeDetail = await callTool('get_node_detail', {
      url: `https://meego.larkoffice.com/${TIKTOK_PROJECT_KEY}/story/detail/${storyId}`,
      node_id: 'state_41',  // iOS 开发 node from previous response
    });

    // 2. Also try getting ALL nodes to see all fields
    const allNodes = await callTool('get_node_detail', {
      url: `https://meego.larkoffice.com/${TIKTOK_PROJECT_KEY}/story/detail/${storyId}`,
    });

    // Filter for version-related content
    const versionLines = allNodes.split('\n').filter((l: string) =>
      l.includes('版本') || l.includes('version') || l.includes('Version') || l.includes('预计上车')
    );

    return NextResponse.json({
      storyId,
      iosNodeDetail: nodeDetail,
      versionLines,
      allNodesRaw: allNodes,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
