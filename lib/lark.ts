import { GoogleGenerativeAI } from '@google/generative-ai';

const LARK_BASE_URL          = process.env.LARK_BASE_URL ?? 'https://open.larksuite.com';
const WIKI_NODE_TOKEN        = 'RUOXwaQVaiPKAOkjoywcTRdynuf';
const HALF_DAY_WIKI_NODE_TOKEN = 'WcZtwCKifiRyxqkDeMtcE6n3ntb';
const OWNER_EMAIL            = process.env.OWNER_EMAIL!;

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

async function getWikiObjToken(accessToken: string, nodeToken = WIKI_NODE_TOKEN): Promise<string> {
  // Use separate cache slot for half-day template
  if (nodeToken === WIKI_NODE_TOKEN && cachedObjToken && Date.now() - objTokenFetchedAt < 3_600_000) return cachedObjToken;

  const res  = await fetch(`${LARK_BASE_URL}/open-apis/wiki/v2/spaces/get_node?token=${nodeToken}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await parseJson(res, 'wiki_node') as {
    code: number; msg?: string;
    data?: { node?: { obj_token?: string } };
  };
  if (data.code !== 0) throw new Error(`Lark wiki node error ${data.code}: ${data.msg}`);

  const objToken = data.data?.node?.obj_token;
  if (!objToken) throw new Error('Lark wiki node missing obj_token');

  if (nodeToken === WIKI_NODE_TOKEN) {
    cachedObjToken    = objToken;
    objTokenFetchedAt = Date.now();
  }
  return objToken;
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

// Headings to SKIP when auto-filling (these are structural, not content sections)
const PRD_SKIP_HEADINGS = [
  'version', 'changelog', 'appendix', 'reference', 'table of content',
  'revision', 'approval', 'sign-off', 'reviewer', 'stakeholder list',
  '版本', '修订', '附录', '参考', '目录', '审批',
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

  // Find fillable sections — include all heading sections that have a paragraph block,
  // EXCEPT known structural/non-content sections (version history, appendix, etc.)
  type Target = { headingText: string; blockId: string };
  const targets: Target[] = [];

  for (const section of sections) {
    const ht = section.headingText.toLowerCase();
    if (!ht.trim()) continue; // skip empty headings
    if (PRD_SKIP_HEADINGS.some(kw => ht.includes(kw))) continue; // skip structural sections
    // paragraph block_type = 2; pick the first one
    const para = section.contentBlocks.find(b => b.block_type === 2);
    if (para) targets.push({ headingText: section.headingText, blockId: para.block_id });
  }

  console.log('[PRD Builder] Found sections:', sections.map(s => s.headingText));
  console.log('[PRD Builder] Matched targets:', targets.map(t => t.headingText));
  if (targets.length === 0) return;

  // Generate content with Gemini
  const genAI      = new GoogleGenerativeAI(apiKey);
  const model      = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite-preview' });
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
    console.log('[PRD Builder] Gemini returned keys:', Object.keys(content));
  } catch {
    console.warn('PRD Builder: failed to parse Gemini response', raw.slice(0, 300));
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

  console.log('[PRD Builder] Updating', requests.length, 'blocks');
  if (requests.length > 0) await batchUpdateBlocks(docId, requests, token);
}

// ─── PRD basic info: fill Meego URL + Compliance URL ─────────────────────────

async function updatePrdBasicInfo(
  docId: string,
  fields: { meegoUrl?: string; complianceUrl?: string },
  token: string,
): Promise<void> {
  if (!fields.meegoUrl && !fields.complianceUrl) return;

  const blocks = await getDocBlocks(docId, token);
  const byId   = new Map(blocks.map(b => [b.block_id, b]));

  // Build parent map and collect all table cells
  const parentOf = new Map<string, string>();
  for (const b of blocks) {
    for (const childId of b.children ?? []) parentOf.set(childId, b.block_id);
  }

  // For each target label, find the value cell in the same row (col_index + 1)
  // and update the first paragraph block inside it.
  const LABEL_MAP: Array<{ keywords: string[]; value: string }> = [
    { keywords: ['meego', 'meego ticket', 'meego url'], value: fields.meegoUrl ?? '' },
    { keywords: ['compliance', 'compliance ticket', 'compliance url', '合规评估工单'], value: fields.complianceUrl ?? '' },
  ];

  // Build a map: tableId -> rowIndex -> colIndex -> cellBlockId
  type CellKey = `${string}:${number}:${number}`;
  const cellMap = new Map<CellKey, string>();
  for (const b of blocks) {
    if (b.table_cell) {
      const tableId = parentOf.get(b.block_id) ?? '';
      if (tableId) {
        cellMap.set(`${tableId}:${b.table_cell.row_index}:${b.table_cell.col_index}`, b.block_id);
      }
    }
  }

  const requests: UpdateRequest[] = [];

  for (const entry of LABEL_MAP) {
    if (!entry.value) continue;

    // Find a block whose text matches one of the label keywords
    for (const block of blocks) {
      const text = blockText(block).toLowerCase().trim();
      if (!entry.keywords.some(kw => text === kw || text.includes(kw))) continue;

      // Walk up to find the enclosing table_cell
      let id: string | undefined = parentOf.get(block.block_id);
      let labelCell: LarkBlock | undefined;
      while (id) {
        const b = byId.get(id);
        if (!b) break;
        if (b.table_cell) { labelCell = b; break; }
        id = parentOf.get(id);
      }
      if (!labelCell?.table_cell) continue;

      const tableId  = parentOf.get(labelCell.block_id) ?? '';
      const valueKey: CellKey = `${tableId}:${labelCell.table_cell.row_index}:${labelCell.table_cell.col_index + 1}`;
      const valueCellId = cellMap.get(valueKey);
      if (!valueCellId) continue;

      const valueCell = byId.get(valueCellId);
      if (!valueCell?.children?.length) continue;

      // Find the first paragraph (block_type 2) inside the value cell (may be nested)
      function findFirstParagraph(cellId: string): LarkBlock | undefined {
        const cell = byId.get(cellId);
        for (const childId of cell?.children ?? []) {
          const child = byId.get(childId);
          if (!child) continue;
          if (child.block_type === 2) return child;
          const nested = findFirstParagraph(childId);
          if (nested) return nested;
        }
        return undefined;
      }

      const para = findFirstParagraph(valueCellId);
      if (para) {
        requests.push({
          block_id:             para.block_id,
          update_text_elements: { elements: [{ text_run: { content: entry.value, text_element_style: {} } }] },
        });
        break; // found a match for this entry, move on
      }
    }
  }

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
 * Extracts the Figma URL from the "Relevant Links" section of a Lark PRD doc.
 * Returns an empty string if not found or if the PRD URL is invalid.
 */
export async function extractFigmaUrlFromPrd(prdUrl: string): Promise<string> {
  if (!prdUrl) return '';
  // Extract doc token from URLs like https://*.larkoffice.com/docx/TOKEN
  const m = prdUrl.match(/\/docx\/([A-Za-z0-9]+)/);
  if (!m) return '';
  const docId = m[1];

  const token  = await getAccessToken();
  const blocks = await getDocBlocks(docId, token);
  const byId   = new Map(blocks.map(b => [b.block_id, b]));

  // Walk top-level children of the page block in document order
  const pageBlock = blocks.find(b => b.block_type === 1);
  if (!pageBlock?.children) return '';

  const topLevel = pageBlock.children
    .map(id => byId.get(id))
    .filter((b): b is LarkBlock => b !== undefined);

  // Collect content blocks that belong to the "Relevant Links" section
  let capturing = false;
  const sectionBlocks: LarkBlock[] = [];

  for (const block of topLevel) {
    if (HEADING_BLOCK_TYPES.has(block.block_type)) {
      const text = blockText(block).toLowerCase();
      if (text.includes('relevant link') || text.includes('相关链接')) {
        capturing = true;
      } else if (capturing) {
        break; // reached the next heading — section is over
      }
    } else if (capturing) {
      sectionBlocks.push(block);
    }
  }

  if (sectionBlocks.length === 0) return '';

  // Recursively collect all descendant blocks
  function collectDescendants(blockId: string): LarkBlock[] {
    const b = byId.get(blockId);
    if (!b) return [];
    return [b, ...(b.children ?? []).flatMap(collectDescendants)];
  }

  const allInSection = sectionBlocks.flatMap(b => collectDescendants(b.block_id));

  // Search for a Figma URL in text element links or plain text
  for (const block of allInSection) {
    for (const el of block.text?.elements ?? []) {
      const style = el.text_run?.text_element_style as Record<string, unknown> | undefined;
      const link  = style?.link as Record<string, unknown> | undefined;
      if (typeof link?.url === 'string' && link.url.includes('figma.com')) {
        return link.url;
      }
      const content  = el.text_run?.content ?? '';
      const urlMatch = content.match(/https?:\/\/[^\s]*figma\.com[^\s]*/);
      if (urlMatch) return urlMatch[0];
    }
  }

  return '';
}

// ─── Doc helpers for chat actions ────────────────────────────────────────────

/** Resolve a Lark URL to a docx token. Wiki URLs need a node→obj_token lookup. */
async function resolveDocId(url: string): Promise<string> {
  const wikiMatch = url.match(/\/wiki\/([A-Za-z0-9]+)/);
  if (wikiMatch) {
    const token = await getAccessToken();
    return getWikiObjToken(token, wikiMatch[1]);
  }
  const docxMatch = url.match(/\/docx\/([A-Za-z0-9]+)/);
  if (docxMatch) return docxMatch[1];
  throw new Error('Invalid Lark doc URL — expected a /docx/ or /wiki/ link');
}

/**
 * Read a Lark document and return a plain-text representation with headings.
 */
export async function readDocContent(docUrl: string): Promise<string> {
  const docId = await resolveDocId(docUrl);

  const token  = await getAccessToken();
  const blocks = await getDocBlocks(docId, token);
  const byId   = new Map(blocks.map(b => [b.block_id, b]));

  const pageBlock = blocks.find(b => b.block_type === 1);
  if (!pageBlock?.children) return '(empty document)';

  const lines: string[] = [];
  for (const childId of pageBlock.children) {
    const b = byId.get(childId);
    if (!b) continue;
    const text = blockText(b);
    if (!text.trim()) continue;
    if (HEADING_BLOCK_TYPES.has(b.block_type)) {
      const level = b.block_type - 2; // block_type 3 = H1, 4 = H2, etc.
      lines.push(`${'#'.repeat(level)} ${text}`);
    } else {
      lines.push(text);
    }
  }
  return lines.join('\n') || '(empty document)';
}

/**
 * Edit a specific section (by heading) in a Lark doc, replacing its first
 * paragraph content with new text.
 */
export async function editDocSection(docUrl: string, sectionHeading: string, newContent: string): Promise<void> {
  const docId = await resolveDocId(docUrl);

  const token  = await getAccessToken();
  const blocks = await getDocBlocks(docId, token);
  const byId   = new Map(blocks.map(b => [b.block_id, b]));

  const pageBlock = blocks.find(b => b.block_type === 1);
  if (!pageBlock?.children) throw new Error('Empty document');

  const topLevel = pageBlock.children.map(id => byId.get(id)).filter((b): b is LarkBlock => !!b);

  // Find the heading that matches, then get the first paragraph after it
  let foundHeading = false;
  for (const block of topLevel) {
    if (HEADING_BLOCK_TYPES.has(block.block_type)) {
      const ht = blockText(block).toLowerCase();
      if (ht.includes(sectionHeading.toLowerCase())) {
        foundHeading = true;
      } else if (foundHeading) {
        break; // reached next heading
      }
    } else if (foundHeading && block.block_type === 2) {
      await batchUpdateBlocks(docId, [{
        block_id: block.block_id,
        update_text_elements: { elements: [{ text_run: { content: newContent, text_element_style: {} } }] },
      }], token);
      return;
    }
  }
  throw new Error(`Section "${sectionHeading}" not found in document`);
}

/**
 * Rename a section heading in a Lark doc.
 */
export async function renameDocSection(docUrl: string, oldHeading: string, newHeading: string): Promise<void> {
  const docId = await resolveDocId(docUrl);
  const token = await getAccessToken();
  const blocks = await getDocBlocks(docId, token);

  const pageBlock = blocks.find(b => b.block_type === 1);
  if (!pageBlock?.children) throw new Error('Empty document');

  const byId = new Map(blocks.map(b => [b.block_id, b]));
  const topLevel = pageBlock.children.map(id => byId.get(id)).filter((b): b is LarkBlock => !!b);

  for (const block of topLevel) {
    if (HEADING_BLOCK_TYPES.has(block.block_type)) {
      const ht = blockText(block).toLowerCase();
      if (ht.includes(oldHeading.toLowerCase())) {
        await batchUpdateBlocks(docId, [{
          block_id: block.block_id,
          update_text_elements: { elements: [{ text_run: { content: newHeading, text_element_style: {} } }] },
        }], token);
        return;
      }
    }
  }
  throw new Error(`Section "${oldHeading}" not found in document`);
}

/**
 * Add a new section (heading + paragraph) to a Lark doc.
 * Inserts at the end of the document by default, or after a specific section if `afterSection` is provided.
 */
export async function addDocSection(
  docUrl: string,
  sectionTitle: string,
  sectionContent: string,
  afterSection?: string,
): Promise<void> {
  const docId = await resolveDocId(docUrl);
  const token = await getAccessToken();
  const blocks = await getDocBlocks(docId, token);

  const pageBlock = blocks.find(b => b.block_type === 1);
  if (!pageBlock) throw new Error('Empty document');

  // Determine insert index (-1 = end of document)
  let insertIndex = -1;
  if (afterSection && pageBlock.children) {
    const byId = new Map(blocks.map(b => [b.block_id, b]));
    const topLevel = pageBlock.children.map(id => byId.get(id)).filter((b): b is LarkBlock => !!b);
    let foundTarget = false;
    for (let i = 0; i < topLevel.length; i++) {
      const b = topLevel[i];
      if (HEADING_BLOCK_TYPES.has(b.block_type) && blockText(b).toLowerCase().includes(afterSection.toLowerCase())) {
        foundTarget = true;
      } else if (foundTarget && HEADING_BLOCK_TYPES.has(b.block_type)) {
        // Found the next heading after target section — insert before it
        insertIndex = i;
        break;
      }
    }
    // If we found the target but no next heading, insert at end
  }

  const body: Record<string, unknown> = {
    children: [
      {
        block_type: 4,
        heading2: {
          elements: [{ text_run: { content: sectionTitle } }],
        },
      },
      {
        block_type: 2,
        text: {
          elements: [{ text_run: { content: sectionContent } }],
        },
      },
    ],
  };
  if (insertIndex >= 0) {
    body.index = insertIndex;
  }

  const res = await fetch(
    `${LARK_BASE_URL}/open-apis/docx/v1/documents/${docId}/blocks/${pageBlock.block_id}/children?document_revision_id=-1`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  const data = await parseJson(res, 'create_blocks') as { code: number; msg?: string };
  if (data.code !== 0) throw new Error(`Lark create blocks error ${data.code}: ${data.msg}`);
}

/**
 * Add a comment to a Lark document, optionally referencing a specific section.
 * When `section` is provided, quotes the section content in the comment body.
 */
export async function addDocComment(docUrl: string, content: string, section?: string): Promise<void> {
  const docId = await resolveDocId(docUrl);
  const token = await getAccessToken();

  // Build comment elements
  const elements: Array<{ type: string; text_run: { text: string } }> = [];

  if (section) {
    // Read the doc and extract the section text to quote
    const blocks = await getDocBlocks(docId, token);
    const byId   = new Map(blocks.map(b => [b.block_id, b]));
    const pageBlock = blocks.find(b => b.block_type === 1);
    if (pageBlock?.children) {
      const topLevel = pageBlock.children.map(id => byId.get(id)).filter((b): b is LarkBlock => !!b);
      let foundHeading = false;
      const sectionTexts: string[] = [];
      for (const block of topLevel) {
        if (HEADING_BLOCK_TYPES.has(block.block_type)) {
          if (foundHeading) break;
          if (blockText(block).toLowerCase().includes(section.toLowerCase())) {
            foundHeading = true;
          }
        } else if (foundHeading) {
          const t = blockText(block).trim();
          if (t) sectionTexts.push(t);
        }
      }
      if (sectionTexts.length > 0) {
        const quoted = sectionTexts.join(' ').slice(0, 300);
        elements.push({ type: 'text_run', text_run: { text: `Re: "${section}"\n> ${quoted}\n\n` } });
      } else {
        elements.push({ type: 'text_run', text_run: { text: `Re: "${section}"\n\n` } });
      }
    }
  }

  elements.push({ type: 'text_run', text_run: { text: content } });

  const res = await fetch(`${LARK_BASE_URL}/open-apis/drive/v1/files/${docId}/comments?file_type=docx`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      reply_list: {
        replies: [{
          content: { elements },
        }],
      },
    }),
  });
  const data = await parseJson(res, 'add_comment') as { code: number; msg?: string };
  if (data.code !== 0) throw new Error(`Lark comment error ${data.code}: ${data.msg}`);
}

/**
 * List comments on a Lark doc, optionally filtering by search text.
 */
export async function listDocComments(
  docUrl: string,
  searchText?: string,
): Promise<Array<{ commentId: string; quote: string; content: string; replies: Array<{ content: string }> }>> {
  const docId = await resolveDocId(docUrl);
  const token = await getAccessToken();

  const res = await fetch(`${LARK_BASE_URL}/open-apis/drive/v1/files/${docId}/comments?file_type=docx&page_size=50`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await parseJson(res, 'list_comments') as {
    code: number; msg?: string;
    data?: { items?: Array<{
      comment_id: string;
      quote: string;
      reply_list?: { replies?: Array<{ content?: { elements?: Array<{ text_run?: { text?: string } }> } }> };
    }> };
  };
  if (data.code !== 0) throw new Error(`Lark list comments error ${data.code}: ${data.msg}`);

  const items = (data.data?.items ?? []).map(c => {
    const replies = (c.reply_list?.replies ?? []).map(r =>
      ({ content: (r.content?.elements ?? []).map(e => e.text_run?.text ?? '').join('') })
    );
    return {
      commentId: c.comment_id,
      quote: c.quote ?? '',
      content: replies[0]?.content ?? '',
      replies: replies.slice(1),
    };
  });

  if (searchText) {
    const term = searchText.toLowerCase();
    return items.filter(c =>
      c.quote.toLowerCase().includes(term) ||
      c.content.toLowerCase().includes(term)
    );
  }
  return items;
}

/**
 * Reply to an existing comment on a Lark doc.
 */
export async function replyToComment(
  docUrl: string,
  commentId: string,
  replyText: string,
): Promise<void> {
  const docId = await resolveDocId(docUrl);
  const token = await getAccessToken();

  const res = await fetch(
    `${LARK_BASE_URL}/open-apis/drive/v1/files/${docId}/comments/${commentId}/replies?file_type=docx`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: {
          elements: [{ type: 'text_run', text_run: { text: replyText } }],
        },
      }),
    },
  );
  const data = await parseJson(res, 'reply_comment') as { code: number; msg?: string };
  if (data.code !== 0) throw new Error(`Lark reply error ${data.code}: ${data.msg}`);
}

/**
 * Duplicate a Lark doc, returning the new doc URL.
 */
export async function duplicateDoc(docUrl: string, newName?: string): Promise<string> {
  const docId = await resolveDocId(docUrl);

  const token = await getAccessToken();
  const folderToken = await getRootFolderToken(token);

  const res = await fetch(`${LARK_BASE_URL}/open-apis/drive/v1/files/${docId}/copy`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: newName ?? 'Copy', type: 'docx', folder_token: folderToken }),
  });
  const data = await parseJson(res, 'drive_copy') as {
    code: number; msg?: string;
    data?: { file?: { token?: string; url?: string } };
  };
  if (data.code !== 0) throw new Error(`Lark copy error ${data.code}: ${data.msg ?? 'unknown'}`);

  const fileToken = data.data?.file?.token;
  if (!fileToken) throw new Error('Lark response missing file token');

  await addCollaborator(fileToken, token);
  return data.data?.file?.url ?? `https://bytedance.sg.larkoffice.com/docx/${fileToken}`;
}

/**
 * Copies the PRD wiki template, names it "[PRD] {featureName}", updates the
 * "Initial version" date, optionally fills PRD sections with AI-generated
 * content, adds Thomas as full-access collaborator, and returns the doc URL.
 */
export async function copyPrdTemplate(
  featureName: string,
  prdBuilderText?: string,
  options?: { useHalfDayPrd?: boolean; meegoUrl?: string; complianceUrl?: string },
): Promise<string> {
  const token = await getAccessToken();
  const templateToken = options?.useHalfDayPrd ? HALF_DAY_WIKI_NODE_TOKEN : WIKI_NODE_TOKEN;
  const [folderToken, objToken] = await Promise.all([
    getRootFolderToken(token),
    getWikiObjToken(token, templateToken),
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
  if (data.code !== 0) {
    console.error('[lark] PRD copy failed:', { templateToken, objToken, folderToken, code: data.code, msg: data.msg });
    throw new Error(`Lark copy error ${data.code}: ${data.msg ?? 'unknown'}`);
  }

  const fileToken = data.data?.file?.token;
  if (!fileToken) throw new Error('Lark response missing file token');

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  // Doc updates (sequential) + collaborator add (parallel)
  await Promise.all([
    (async () => {
      await updateInitialVersionDate(fileToken, today, token);
      await updatePrdBasicInfo(fileToken, {
        meegoUrl: options?.meegoUrl,
        complianceUrl: options?.complianceUrl,
      }, token).catch(e => console.warn('PRD basic info fill failed:', e));
      if (prdBuilderText?.trim()) {
        await fillPrdSections(fileToken, featureName, prdBuilderText.trim(), token)
          .catch(e => console.warn('PRD Builder fill failed:', e));
      }
    })(),
    addCollaborator(fileToken, token),
  ]);

  return data.data?.file?.url ?? `https://bytedance.sg.larkoffice.com/docx/${fileToken}`;
}
