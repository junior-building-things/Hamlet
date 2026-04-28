import { NextRequest, NextResponse } from 'next/server';

// Temporary diagnostic endpoint: returns the Meego MCP tool catalog so we
// can see whether a comment-fetching tool exists. Auth via JUNIOR_CRON_SECRET.
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? '';
  if (auth !== `Bearer ${process.env.JUNIOR_CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const token = process.env.MEEGO_USER_TOKEN;
  if (!token) {
    return NextResponse.json({ error: 'MEEGO_USER_TOKEN not configured' }, { status: 500 });
  }

  const res = await fetch('https://meego.larkoffice.com/mcp_server/v1', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Mcp-Token': token },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });

  const data = await res.json();
  const tools = (data.result?.tools ?? []) as Array<{ name: string; description?: string; inputSchema?: unknown }>;
  const filter = req.nextUrl.searchParams.get('filter');
  const filtered = filter
    ? tools.filter(t => t.name.toLowerCase().includes(filter.toLowerCase()))
    : tools;
  return NextResponse.json({
    count: tools.length,
    tools: filtered.map(t => ({
      name: t.name,
      description: (t.description ?? '').slice(0, 600),
      inputSchema: filter ? t.inputSchema : undefined,
    })),
  });
}
