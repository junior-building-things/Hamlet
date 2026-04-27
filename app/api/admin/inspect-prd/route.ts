/**
 * TEMPORARY admin endpoint to dump a PRD's Lark block structure for
 * debugging the AB-Setup table extractor. Authenticated by the same
 * AGENT_RUN_SECRET used for the digest endpoint.
 *
 * Usage:
 *   curl -H "Authorization: Bearer $AGENT_RUN_SECRET" \
 *     "https://hamlet-…run.app/api/admin/inspect-prd?url=<PRD_URL>"
 */

import { NextRequest, NextResponse } from 'next/server';
import { extractAbSetupTable } from '@/lib/lark';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SECRET = process.env.AGENT_RUN_SECRET;

interface LarkBlock {
  block_id: string;
  block_type: number;
  children?: string[];
  text?: { elements?: Array<{ text_run?: { content?: string } }> };
  table_cell?: { row_index: number; col_index: number };
  table?: unknown;
  [k: string]: unknown;
}

const LARK_BASE_URL = 'https://open.larksuite.com';

async function getBotToken(): Promise<string> {
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

async function getDocBlocks(docId: string, token: string): Promise<LarkBlock[]> {
  const all: LarkBlock[] = [];
  let pageToken: string | undefined;
  for (let p = 0; p < 20; p++) {
    const params = new URLSearchParams({ page_size: '500', document_revision_id: '-1' });
    if (pageToken) params.set('page_token', pageToken);
    const res = await fetch(
      `${LARK_BASE_URL}/open-apis/docx/v1/documents/${docId}/blocks?${params.toString()}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const data = await res.json() as { data?: { items?: LarkBlock[]; has_more?: boolean; page_token?: string } };
    all.push(...(data.data?.items ?? []));
    if (!data.data?.has_more || !data.data.page_token) break;
    pageToken = data.data.page_token;
  }
  return all;
}

const TEXT_BEARING_KEYS = ['text','heading1','heading2','heading3','heading4','heading5','heading6','heading7','heading8','heading9','bullet','ordered','code','quote','todo','callout'] as const;
function blockText(b: LarkBlock): string {
  for (const key of TEXT_BEARING_KEYS) {
    const container = b[key as string] as { elements?: Array<{ text_run?: { content?: string } }> } | undefined;
    const elements = container?.elements;
    if (elements && elements.length > 0) {
      return elements.map(e => e.text_run?.content ?? '').join('');
    }
  }
  return '';
}

export async function GET(req: NextRequest) {
  if (SECRET) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${SECRET}`) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const url = req.nextUrl.searchParams.get('url') ?? '';
  if (!url) return NextResponse.json({ error: 'url query param required' }, { status: 400 });

  try {
    const token = await getBotToken();
    if (!token) return NextResponse.json({ error: 'no bot token' }, { status: 500 });
    const docId = await resolveDocId(url, token);
    if (!docId) return NextResponse.json({ error: 'could not resolve doc id' }, { status: 400 });
    const blocks = await getDocBlocks(docId, token);

    const ABSETUP_ALIASES = ['ab set-up', 'a/b set-up', 'a/b testing setup', 'ab testing setup', 'a/b testing set-up', 'ab testing set-up', 'a/b setup', 'ab setup'];
    const tableExtraction = await extractAbSetupTable(url, ABSETUP_ALIASES);

    // Build a compact view: for each block, type / text-snippet / has table_cell / children count
    const summary = blocks.map((b, i) => {
      const t = blockText(b).trim().slice(0, 80);
      return {
        i,
        block_id: b.block_id,
        block_type: b.block_type,
        text: t,
        is_table_cell: !!b.table_cell,
        cell_pos: b.table_cell ? `${b.table_cell.row_index},${b.table_cell.col_index}` : undefined,
        children_count: b.children?.length ?? 0,
      };
    });
    // Also dump full raw JSON for any block with block_type ∈ {31, 32}
    // so we can see the real shape of table / cell metadata.
    const rawTableBlocks = blocks
      .filter(b => b.block_type === 31 || b.block_type === 32)
      .slice(0, 20);
    // Dump the page's direct children list so we can see what the
    // top-level walk in extractAbSetupTable actually encounters.
    const page = blocks.find(b => b.block_type === 1);
    const byId2 = new Map(blocks.map(b => [b.block_id, b]));
    const pageChildrenSummary = (page?.children ?? []).map(cid => {
      const b = byId2.get(cid);
      if (!b) return { block_id: cid, missing: true };
      return {
        block_id: cid,
        block_type: b.block_type,
        text: blockText(b).slice(0, 80),
        children_count: b.children?.length ?? 0,
        is_table_cell: !!b.table_cell,
      };
    });
    return NextResponse.json({
      docId,
      blockCount: blocks.length,
      tableExtraction,
      blocks: summary,
      rawTableBlocks,
      pageChildrenCount: page?.children?.length ?? 0,
      pageChildrenSummary,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
