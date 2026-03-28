const LARK_BASE_URL   = process.env.LARK_BASE_URL ?? 'https://open.larksuite.com';
const WIKI_NODE_TOKEN = 'RUOXwaQVaiPKAOkjoywcTRdynuf';
const OWNER_EMAIL     = 'thomas.oefverstroem@bytedance.com';

async function parseJson(res: Response, label: string): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} returned non-JSON (${res.status}): ${text.slice(0, 200)}`);
  }
}

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
  const data = await parseJson(res, 'auth') as { code: number; msg?: string; tenant_access_token?: string; expire?: number };
  if (data.code !== 0) throw new Error(`Lark auth error ${data.code}: ${data.msg}`);

  cachedToken    = data.tenant_access_token!;
  tokenExpiresAt = Date.now() + (data.expire ?? 7200) * 1000;
  return cachedToken;
}

// ─── Root folder ──────────────────────────────────────────────────────────────

let cachedRootFolder    = '';
let rootFolderFetchedAt = 0;

async function getRootFolderToken(accessToken: string): Promise<string> {
  if (cachedRootFolder && Date.now() - rootFolderFetchedAt < 3_600_000) return cachedRootFolder;

  const res  = await fetch(`${LARK_BASE_URL}/open-apis/drive/explorer/v2/root_folder/meta`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await parseJson(res, 'root_folder') as { code: number; msg?: string; data?: { token: string } };
  if (data.code !== 0) throw new Error(`Lark root folder error ${data.code}: ${data.msg}`);

  cachedRootFolder    = data.data!.token;
  rootFolderFetchedAt = Date.now();
  return cachedRootFolder;
}

// ─── Wiki node → drive obj_token ──────────────────────────────────────────────

let cachedObjToken    = '';
let objTokenFetchedAt = 0;

async function getWikiObjToken(accessToken: string): Promise<string> {
  if (cachedObjToken && Date.now() - objTokenFetchedAt < 3_600_000) return cachedObjToken;

  const res  = await fetch(`${LARK_BASE_URL}/open-apis/wiki/v2/spaces/get_node?token=${WIKI_NODE_TOKEN}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await parseJson(res, 'wiki_node') as {
    code: number; msg?: string;
    data?: { node?: { obj_token?: string } };
  };
  if (data.code !== 0) throw new Error(`Lark wiki node error ${data.code}: ${data.msg}`);

  const objToken = data.data?.node?.obj_token;
  if (!objToken) throw new Error('Lark wiki node missing obj_token');

  cachedObjToken    = objToken;
  objTokenFetchedAt = Date.now();
  return cachedObjToken;
}

// ─── Doc block types ──────────────────────────────────────────────────────────

interface TextRun     { content: string; text_element_style?: Record<string, unknown> }
interface TextElement { text_run?: TextRun }
interface LarkBlock {
  block_id:   string;
  block_type: number;
  children?:  string[];
  text?:      { elements: TextElement[] };
  table_cell?: { row_index: number; col_index: number };
  table?:     unknown;
}

function blockText(b: LarkBlock): string {
  return (b.text?.elements ?? []).map(e => e.text_run?.content ?? '').join('');
}

// ─── Update "Initial version" date in the freshly copied doc ─────────────────

async function updateInitialVersionDate(docId: string, date: string, token: string): Promise<void> {
  const res = await fetch(
    `${LARK_BASE_URL}/open-apis/docx/v1/documents/${docId}/blocks?page_size=500&document_revision_id=-1`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const data = await parseJson(res, 'get_blocks') as {
    code: number; msg?: string;
    data?: { items?: LarkBlock[] };
  };
  if (data.code !== 0) throw new Error(`get_blocks error ${data.code}: ${data.msg}`);

  const blocks = data.data?.items ?? [];
  const byId   = new Map(blocks.map(b => [b.block_id, b]));

  // Build parent map from children arrays
  const parentOf = new Map<string, string>();
  for (const b of blocks) {
    for (const childId of b.children ?? []) parentOf.set(childId, b.block_id);
  }

  // Walk up ancestors looking for a block with a given property
  function findAncestorWithProp(blockId: string, prop: keyof LarkBlock): LarkBlock | undefined {
    let id = parentOf.get(blockId);
    while (id) {
      const b = byId.get(id);
      if (!b) break;
      if (b[prop] !== undefined) return b;
      id = parentOf.get(id);
    }
    return undefined;
  }

  // Locate the table_cell (and its parent table) that contains "Initial version"
  let targetRowIndex = -1;
  let targetTableId  = '';

  for (const block of blocks) {
    if (!blockText(block).includes('Initial version')) continue;
    const cell  = findAncestorWithProp(block.block_id, 'table_cell');
    const tableId = cell ? parentOf.get(cell.block_id) : undefined;
    if (cell?.table_cell && tableId) {
      targetRowIndex = cell.table_cell.row_index;
      targetTableId  = tableId;
      break;
    }
  }

  if (targetRowIndex === -1) return; // "Initial version" row not found — skip silently

  // Find date-like blocks in the same table row
  const dateRe   = /\d{4}-\d{2}-\d{2}/;
  const toUpdate: LarkBlock[] = [];

  for (const block of blocks) {
    if (!dateRe.test(blockText(block))) continue;
    const cell    = findAncestorWithProp(block.block_id, 'table_cell');
    const tableId = cell ? parentOf.get(cell.block_id) : undefined;
    if (cell?.table_cell?.row_index === targetRowIndex && tableId === targetTableId) {
      toUpdate.push(block);
    }
  }

  if (toUpdate.length === 0) return;

  const requests = toUpdate.map(b => ({
    block_id:             b.block_id,
    update_text_elements: {
      elements: [{ text_run: { content: date, text_element_style: {} } }],
    },
  }));

  const upRes  = await fetch(
    `${LARK_BASE_URL}/open-apis/docx/v1/documents/${docId}/blocks/batch_update`,
    {
      method:  'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ requests, document_revision_id: -1 }),
    },
  );
  const upData = await parseJson(upRes, 'update_blocks') as { code: number; msg?: string };
  if (upData.code !== 0) throw new Error(`update_blocks error ${upData.code}: ${upData.msg}`);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Copies the PRD wiki template into the bot's root folder, names it
 * "[PRD] {featureName}", updates the "Initial version" date, adds Thomas
 * as full-access collaborator, and returns the document URL.
 */
export async function copyPrdTemplate(featureName: string): Promise<string> {
  const token = await getAccessToken();
  const [folderToken, objToken] = await Promise.all([
    getRootFolderToken(token),
    getWikiObjToken(token),
  ]);

  const prdName = `[PRD] ${featureName}`;

  const res  = await fetch(`${LARK_BASE_URL}/open-apis/drive/v1/files/${objToken}/copy`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ name: prdName, type: 'docx', folder_token: folderToken }),
  });
  const data = await parseJson(res, 'drive_copy') as {
    code: number; msg?: string;
    data?: { file?: { token?: string; url?: string } };
  };
  if (data.code !== 0) throw new Error(`Lark copy error ${data.code}: ${data.msg ?? 'unknown'}`);

  const fileToken = data.data?.file?.token;
  if (!fileToken) throw new Error('Lark response missing file token');

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  // Update date + add collaborator in parallel
  await Promise.all([
    updateInitialVersionDate(fileToken, today, token),
    fetch(
      `${LARK_BASE_URL}/open-apis/drive/v1/permissions/${fileToken}/members?type=docx&need_notification=false`,
      {
        method:  'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ member_type: 'email', member_id: OWNER_EMAIL, perm: 'full_access', type: 'user' }),
      },
    ),
  ]);

  return data.data?.file?.url ?? `https://bytedance.sg.larkoffice.com/docx/${fileToken}`;
}
