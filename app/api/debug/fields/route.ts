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
    // Get a sample work item brief — request ALL fields by omitting fields param
    const raw = await callMeegoMcp('get_workitem_brief', {
      url: `https://meego.larkoffice.com/${TIKTOK_PROJECT_KEY}/story/detail/3752309`,
    });

    // Extract lines containing "版本" (version) or "iOS" or "version"
    const versionLines = raw.split('\n').filter((l: string) =>
      l.includes('版本') || l.toLowerCase().includes('version') || l.toLowerCase().includes('ios')
    );

    return NextResponse.json({
      versionRelatedLines: versionLines,
      fullBrief: raw,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
