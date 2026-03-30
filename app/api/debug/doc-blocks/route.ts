import { NextRequest, NextResponse } from 'next/server';

const LARK_BASE_URL = process.env.LARK_BASE_URL ?? 'https://open.larksuite.com';

async function getToken(): Promise<string> {
  const res = await fetch(`${LARK_BASE_URL}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: process.env.LARK_APP_ID, app_secret: process.env.LARK_APP_SECRET }),
  });
  const data = await res.json() as { tenant_access_token?: string };
  return data.tenant_access_token ?? '';
}

async function resolveDocId(url: string, token: string): Promise<string> {
  const wikiMatch = url.match(/\/wiki\/([A-Za-z0-9]+)/);
  if (wikiMatch) {
    const res = await fetch(`${LARK_BASE_URL}/open-apis/wiki/v2/spaces/get_node?token=${wikiMatch[1]}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json() as { data?: { node?: { obj_token?: string } } };
    return data.data?.node?.obj_token ?? '';
  }
  const docxMatch = url.match(/\/docx\/([A-Za-z0-9]+)/);
  return docxMatch?.[1] ?? '';
}

export async function GET(req: NextRequest) {
  const docUrl = req.nextUrl.searchParams.get('url');
  if (!docUrl) return NextResponse.json({ error: 'Pass ?url=<lark doc url>' });

  const token = await getToken();
  const docId = await resolveDocId(docUrl, token);

  const res = await fetch(
    `${LARK_BASE_URL}/open-apis/docx/v1/documents/${docId}/blocks?page_size=500&document_revision_id=-1`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const data = await res.json() as { data?: { items?: unknown[] } };
  const blocks = (data.data?.items ?? []) as Array<Record<string, unknown>>;

  const HEADING_TYPES = new Set([3, 4, 5, 6, 7, 8, 9, 10, 11]);
  const pageBlock = blocks.find((b: Record<string, unknown>) => b.block_type === 1) as Record<string, unknown> | undefined;
  const topLevelIds = new Set((pageBlock?.children as string[]) ?? []);

  // Show top-level blocks with their full structure for headings
  const summary = blocks
    .filter(b => topLevelIds.has(b.block_id as string))
    .map(b => {
      const type = b.block_type as number;
      if (HEADING_TYPES.has(type) || type === 2) {
        return { block_type: type, keys: Object.keys(b), block: b };
      }
      return { block_type: type, keys: Object.keys(b), childCount: ((b.children as string[]) ?? []).length };
    })
    .slice(0, 30);

  // Also show one raw heading block
  const sampleHeading = blocks.find(b => HEADING_TYPES.has(b.block_type as number));

  return NextResponse.json({
    docId,
    totalBlocks: blocks.length,
    sampleHeading,
    topLevel: summary,
  });
}
