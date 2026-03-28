const LARK_BASE_URL    = process.env.LARK_BASE_URL ?? 'https://open.larksuite.com';
const TEMPLATE_DOC_ID  = 'Z5qldS3kEoC1WAxPyMucR9RpneX';

// ─── Token cache ──────────────────────────────────────────────────────────────

let cachedToken    = '';
let tokenExpiresAt = 0;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) return cachedToken;

  const appId     = process.env.LARK_APP_ID;
  const appSecret = process.env.LARK_APP_SECRET;
  if (!appId || !appSecret) throw new Error('LARK_APP_ID / LARK_APP_SECRET not configured');

  const res  = await fetch(`${LARK_BASE_URL}/open-apis/auth/v3/tenant_access_token/internal`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const data = await res.json() as { code: number; msg?: string; tenant_access_token?: string; expire?: number };
  if (data.code !== 0) throw new Error(`Lark auth error ${data.code}: ${data.msg}`);

  cachedToken    = data.tenant_access_token!;
  tokenExpiresAt = Date.now() + (data.expire ?? 7200) * 1000;
  return cachedToken;
}

// ─── Block types ──────────────────────────────────────────────────────────────

const BLOCK_TYPE_SHEET = 30;
const BLOCK_TYPE_TABLE = 31;

interface LarkBlock {
  block_id:   string;
  block_type: number;
  parent_id?: string;
  children?:  string[];
  comment_ids?: string[];
  [key: string]: unknown;
}

interface BlocksResponse {
  code: number;
  msg?: string;
  data?: { items: LarkBlock[]; has_more: boolean; page_token?: string };
}

interface CreateBlocksResponse {
  code: number;
  msg?: string;
  data?: { children: LarkBlock[] };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Strip metadata fields that must not be sent in a create request. */
function toCreateNode(block: LarkBlock): Record<string, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { block_id, parent_id, comment_ids, children, ...content } = block;
  return content;
}

/** Replace embedded-spreadsheet blocks with a readable placeholder. */
function placeholderForSheet(): Record<string, unknown> {
  return {
    block_type: 2,
    text: {
      elements: [{ text_run: { content: '[See original PRD template for spreadsheet content]', text_element_style: {} } }],
      style: { align: 1 },
    },
  };
}

async function larkGet(token: string, path: string) {
  const res = await fetch(`${LARK_BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
}

async function larkPost(token: string, path: string, body: unknown) {
  const res = await fetch(`${LARK_BASE_URL}${path}`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  return res.json();
}

// ─── Recursive block copy ─────────────────────────────────────────────────────

/**
 * Creates `originalIds` as children of `newParentId` in the new document,
 * then recursively fills their children.
 */
async function copyChildren(
  token:       string,
  docId:       string,
  newParentId: string,
  allBlocks:   LarkBlock[],
  originalIds: string[],
): Promise<void> {
  if (originalIds.length === 0) return;

  // Build the create-node list for this level
  const nodes: Record<string, unknown>[] = [];
  const ids:   string[]                  = [];

  for (const origId of originalIds) {
    const b = allBlocks.find(x => x.block_id === origId);
    if (!b) continue;

    if (b.block_type === BLOCK_TYPE_SHEET) {
      nodes.push(placeholderForSheet());
    } else {
      nodes.push(toCreateNode(b));
    }
    ids.push(origId);
  }

  // Send in batches of 50 (API limit)
  const CHUNK = 50;
  const created: { origId: string; newBlock: LarkBlock }[] = [];

  for (let i = 0; i < nodes.length; i += CHUNK) {
    const chunk     = nodes.slice(i, i + CHUNK);
    const origChunk = ids.slice(i, i + CHUNK);

    const resp = await larkPost(
      token,
      `/open-apis/docx/v1/documents/${docId}/blocks/${newParentId}/children`,
      { children: chunk, index: i },
    ) as CreateBlocksResponse;

    if (resp.code !== 0) throw new Error(`Lark create blocks error ${resp.code}: ${resp.msg}`);

    (resp.data?.children ?? []).forEach((newBlock, idx) => {
      created.push({ origId: origChunk[idx], newBlock });
    });
  }

  // Recursively handle children
  for (const { origId, newBlock } of created) {
    const orig = allBlocks.find(x => x.block_id === origId);
    if (!orig || !orig.children?.length) continue;

    if (orig.block_type === BLOCK_TYPE_TABLE) {
      // Lark auto-creates table cells — fetch them and map by order
      const tableResp = await larkGet(
        token,
        `/open-apis/docx/v1/documents/${docId}/blocks/${newBlock.block_id}`,
      ) as { code: number; data?: { block: LarkBlock } };

      const newCellIds  = tableResp.data?.block?.children ?? [];
      const origCellIds = orig.children;

      for (let i = 0; i < Math.min(origCellIds.length, newCellIds.length); i++) {
        const origCell = allBlocks.find(x => x.block_id === origCellIds[i]);
        if (origCell?.children?.length) {
          await copyChildren(token, docId, newCellIds[i], allBlocks, origCell.children);
        }
      }
    } else if (orig.block_type !== BLOCK_TYPE_SHEET) {
      await copyChildren(token, docId, newBlock.block_id, allBlocks, orig.children);
    }
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Creates a new Lark document that is an exact copy of the PRD template,
 * named after the feature. Returns the URL of the new document.
 */
export async function copyPrdTemplate(featureName: string): Promise<string> {
  const token = await getAccessToken();

  // 1. Fetch all template blocks (paginated)
  const allBlocks: LarkBlock[] = [];
  let pageToken: string | undefined;

  do {
    const url = `/open-apis/docx/v1/documents/${TEMPLATE_DOC_ID}/blocks?page_size=500`
      + (pageToken ? `&page_token=${pageToken}` : '');
    const resp = await larkGet(token, url) as BlocksResponse;
    if (resp.code !== 0) throw new Error(`Lark read blocks error ${resp.code}: ${resp.msg}`);
    allBlocks.push(...(resp.data?.items ?? []));
    pageToken = resp.data?.has_more ? resp.data.page_token : undefined;
  } while (pageToken);

  const rootBlock = allBlocks.find(b => b.block_id === TEMPLATE_DOC_ID);
  if (!rootBlock) throw new Error('Template root block not found');

  // 2. Create a new blank document
  const createResp = await larkPost(token, '/open-apis/docx/v1/documents', { title: featureName }) as {
    code: number; msg?: string; data?: { document: { document_id: string } };
  };
  if (createResp.code !== 0) throw new Error(`Lark create doc error ${createResp.code}: ${createResp.msg}`);

  const docId = createResp.data!.document.document_id;

  // 3. Recursively copy all blocks from the template root's children
  await copyChildren(token, docId, docId, allBlocks, rootBlock.children ?? []);

  return `https://bytedance.sg.larkoffice.com/docx/${docId}`;
}
