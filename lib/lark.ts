import { GoogleGenerativeAI } from '@google/generative-ai';

const LARK_BASE_URL   = process.env.LARK_BASE_URL ?? 'https://open.larksuite.com';
const WIKI_NODE_TOKEN = 'RUOXwaQVaiPKAOkjoywcTRdynuf';
const OWNER_EMAIL     = 'thomas.oefverstroem@bytedance.com';

// ─── JSON parsing helper ──────────────────────────────────────────────────────

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

// ─── Root folder cache ────────────────────────────────────────────────────────

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

// ─── Wiki node → drive obj_token cache ───────────────────────────────────────

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

// ─── Block types ──────────────────────────────────────────────────────────────

interface TextRun     { content: string; text_element_style?: Record<string, unknown> }
interface TextElement { text_run?: TextRun }
interface LarkBlock {
  block_id:    string;
  block_type:  number;
  children?:   string[];
  text?:       { elements: TextElement[] };
  table_cell?: { row_index: number; col_index: number };
  table?:      unknown;
}

function blockText(b: LarkBlock): string {
  return (b.text?.elements ?? []).map(e => e.text_run?.content ?? '').join('');
}

// ─── Shared doc block helpers ─────────────────────────────────────────────────

async function getDocBlocks(docId: string, token: string): Promise<LarkBlock[]> {
  const res  = await fetch(
    `${LARK_BASE_URL}/open-apis/docx/v1/documents/${docId}/blocks?page_size=500&document_revision_id=-1`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const data = await parseJson(res, 'get_blocks') as {
    code: number; msg?: string;
    data?: { items?: LarkBlock[] };
  };
  if (data.code !== 0) throw new Error(`get_blocks error ${data.code}: ${data.msg}`);
  return data.data?.items ?? [];
}

type UpdateRequest = {
  block_id: string;
  update_text_elements: { elements: { text_run: { content: string; text_element_style: Record<string, unknown> } }[] };
};

async function batchUpdateBlocks(docId: string, requests: UpdateRequest[], token: string): Promise<void> {
  if (requests.length === 0) return;
  const res  = await fetch(
    `${LARK_BASE_URL}/open-apis/docx/v1/documents/${docId}/blocks/batch_update`,
    {
      method:  'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ requests, document_revision_id: -1 }),
    },
  );
  const data = await parseJson(res, 'update_blocks') as { code: number; msg?: string };
  if (data.code !== 0) throw new Error(`update_blocks error ${data.code}: ${data.msg}`);
}

// ─── Update "Initial version" date ───────────────────────────────────────────

async function updateInitialVersionDate(docId: string, date: string, token: string): Promise<void> {
  const blocks   = await getDocBlocks(docId, token);
  const byId     = new Map(blocks.map(b => [b.block_id, b]));

  // Build parent map
  const parentOf = new Map<string, string>();
  for (const b of blocks) {
    for (const childId of b.children ?? []) parentOf.set(childId, b.block_id);
  }

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

  // Locate the table_cell containing "Initial version"
  let targetRowIndex = -1;
  let targetTableId  = '';

  for (const block of blocks) {
    if (!blockText(block).includes('Initial version')) continue;
    const cell    = findAncestorWithProp(block.block_id, 'table_cell');
    const tableId = cell ? parentOf.get(cell.block_id) : undefined;
    if (cell?.table_cell && tableId) {
      targetRowIndex = cell.table_cell.row_index;
      targetTableId  = tableId;
      break;
    }
  }

  if (targetRowIndex === -1) return;

  // Find date-pattern blocks in the same row
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

  await batchUpdateBlocks(
    docId,
    toUpdate.map(b => ({
      block_id:             b.block_id,
      update_text_elements: { elements: [{ text_run: { content: date, text_element_style: {} } }] },
    })),
    token,
  );
}

// ─── PRD Builder: fill sections with AI-generated content ────────────────────

// Heading block types in Lark Docx (Heading1–Heading9)
const HEADING_BLOCK_TYPES = new Set([3, 4, 5, 6, 7, 8, 9, 10, 11]);

// Keywords that identify PRD sections worth filling
const PRD_KEYWORDS = [
  'background', 'problem', 'goal', 'objective', 'metric', 'requirement',
  'scope', 'overview', 'summary', 'context', 'why', 'impact', 'success',
  'solution', 'description', 'motivation', 'hypothesis',
];

async function fillPrdSections(
  docId:       string,
  featureName: string,
  description: string,
  token:       string,
): Promise<void> {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) return; // skip silently if no key configured

  const blocks  = await getDocBlocks(docId, token);
  const byId    = new Map(blocks.map(b => [b.block_id, b]));

  // Find the page block and walk its top-level children in order
  const pageBlock = blocks.find(b => b.block_type === 1);
  if (!pageBlock?.children) return;

  const topLevel = pageBlock.children
    .map(id => byId.get(id))
    .filter((b): b is LarkBlock => b !== undefined);

  // Build sections: heading → following sibling blocks (until next heading)
  type Section = { headingText: string; contentBlocks: LarkBlock[] };
  const sections: Section[] = [];
  let current: Section | null = null;

  for (const block of topLevel) {
    if (HEADING_BLOCK_TYPES.has(block.block_type)) {
      if (current) sections.push(current);
      current = { headingText: blockText(block), contentBlocks: [] };
    } else if (current) {
      current.contentBlocks.push(block);
    }
  }
  if (current) sections.push(current);

  // Find relevant sections with at least one empty text block
  type Target = { headingText: string; blockId: string };
  const targets: Target[] = [];

  for (const section of sections) {
    const ht = section.headingText.toLowerCase();
    if (!PRD_KEYWORDS.some(kw => ht.includes(kw))) continue;
    // paragraph block_type = 2
    const empty = section.contentBlocks.find(b => b.block_type === 2 && !blockText(b).trim());
    if (empty) targets.push({ headingText: section.headingText, blockId: empty.block_id });
  }

  if (targets.length === 0) return;

  // Generate content with Gemini
  const genAI      = new GoogleGenerativeAI(apiKey);
  const model      = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
  const headingList = targets.map(t => `"${t.headingText}"`).join(', ');

  const result = await model.generateContent(
    `You are a senior product manager at TikTok writing a PRD for the Direct Messaging (DM) team.

Feature: "${featureName}"
What we're building: "${description}"

Write concise, professional content for these PRD sections: ${headingList}

Rules:
- Return ONLY a valid JSON object — no markdown, no extra text
- Keys must exactly match the section names listed above
- Values are 2–4 sentence plain-text paragraphs (no bullet points, no formatting)`,
  );

  const raw = result.response.text().trim();
  let content: Record<string, string>;
  try {
    // Strip any accidental markdown code fences
    const cleaned = raw.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '');
    content = JSON.parse(cleaned) as Record<string, string>;
  } catch {
    console.warn('PRD Builder: failed to parse Claude response', raw.slice(0, 200));
    return;
  }

  const requests: UpdateRequest[] = targets
    .filter(t => content[t.headingText]?.trim())
    .map(t => ({
      block_id:             t.blockId,
      update_text_elements: {
        elements: [{ text_run: { content: content[t.headingText].trim(), text_element_style: {} } }],
      },
    }));

  await batchUpdateBlocks(docId, requests, token);
}

// ─── Add collaborator helper ──────────────────────────────────────────────────

async function addCollaborator(fileToken: string, token: string): Promise<void> {
  await fetch(
    `${LARK_BASE_URL}/open-apis/drive/v1/permissions/${fileToken}/members?type=docx&need_notification=false`,
    {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ member_type: 'email', member_id: OWNER_EMAIL, perm: 'full_access', type: 'user' }),
    },
  );
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Copies the PRD wiki template, names it "[PRD] {featureName}", updates the
 * "Initial version" date, optionally fills PRD sections with AI-generated
 * content, adds Thomas as full-access collaborator, and returns the doc URL.
 */
export async function copyPrdTemplate(featureName: string, prdBuilderText?: string): Promise<string> {
  const token = await getAccessToken();
  const [folderToken, objToken] = await Promise.all([
    getRootFolderToken(token),
    getWikiObjToken(token),
  ]);

  const res  = await fetch(`${LARK_BASE_URL}/open-apis/drive/v1/files/${objToken}/copy`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ name: `[PRD] ${featureName}`, type: 'docx', folder_token: folderToken }),
  });
  const data = await parseJson(res, 'drive_copy') as {
    code: number; msg?: string;
    data?: { file?: { token?: string; url?: string } };
  };
  if (data.code !== 0) throw new Error(`Lark copy error ${data.code}: ${data.msg ?? 'unknown'}`);

  const fileToken = data.data?.file?.token;
  if (!fileToken) throw new Error('Lark response missing file token');

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  // Doc updates (sequential) + collaborator add (parallel)
  await Promise.all([
    (async () => {
      await updateInitialVersionDate(fileToken, today, token);
      if (prdBuilderText?.trim()) {
        await fillPrdSections(fileToken, featureName, prdBuilderText.trim(), token)
          .catch(e => console.warn('PRD Builder fill failed:', e));
      }
    })(),
    addCollaborator(fileToken, token),
  ]);

  return data.data?.file?.url ?? `https://bytedance.sg.larkoffice.com/docx/${fileToken}`;
}
