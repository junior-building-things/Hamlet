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

  // Get page block
  const blocksRes = await fetch(
    `${LARK_BASE_URL}/open-apis/docx/v1/documents/${docId}/blocks?page_size=500&document_revision_id=-1`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const blocksData = await blocksRes.json() as { data?: { items?: Array<{ block_id: string; block_type: number }> } };
  const blocks = blocksData.data?.items ?? [];
  const pageBlock = blocks.find(b => b.block_type === 1);

  if (!pageBlock) return NextResponse.json({ error: 'No page block found', blocks: blocks.slice(0, 5) });

  // Try creating a test paragraph
  const body = {
    children: [
      {
        block_type: 2,
        text: {
          elements: [{ text_run: { content: 'Test paragraph from debug endpoint' } }],
        },
      },
    ],
  };

  const createRes = await fetch(
    `${LARK_BASE_URL}/open-apis/docx/v1/documents/${docId}/blocks/${pageBlock.block_id}/children?document_revision_id=-1`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  const createData = await createRes.json();

  return NextResponse.json({
    docId,
    pageBlockId: pageBlock.block_id,
    requestBody: body,
    response: createData,
  });
}
