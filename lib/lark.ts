
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

// Heading block types in Lark Docx (Heading1–Heading9)
const HEADING_BLOCK_TYPES = new Set([3, 4, 5, 6, 7, 8, 9, 10, 11]);

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
// ─── User token refresh ──────────────────────────────────────────────────────

/**
 * Refresh an expired Lark user_access_token using its refresh_token.
 * Returns { accessToken, refreshToken } or null if refresh fails.
 */
export async function refreshUserToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string } | null> {
  const appId     = process.env.LARK_APP_ID;
  const appSecret = process.env.LARK_APP_SECRET;
  if (!appId || !appSecret || !refreshToken) return null;

  // Get app_access_token first
  const appRes  = await fetch(`${LARK_BASE_URL}/open-apis/auth/v3/app_access_token/internal`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const appData = await parseJson(appRes, 'app_token') as { code: number; app_access_token?: string };
  if (appData.code !== 0 || !appData.app_access_token) return null;

  // Refresh the user token
  const res  = await fetch(`${LARK_BASE_URL}/open-apis/authen/v1/refresh_access_token`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      app_access_token: appData.app_access_token,
      grant_type:       'refresh_token',
      refresh_token:    refreshToken,
    }),
  });
  const data = await parseJson(res, 'refresh_token') as {
    code: number; msg?: string;
    data?: { access_token?: string; refresh_token?: string };
  };
  if (data.code !== 0 || !data.data?.access_token) {
    console.warn('[lark] refresh token failed:', data.code, data.msg, '— user may need to re-login');
    return null;
  }

  return {
    accessToken:  data.data.access_token,
    refreshToken: data.data.refresh_token ?? refreshToken,
  };
}

// ─── Search for AB Report on Lark Drive ──────────────────────────────────────

/**
 * Search Lark Drive for an AB report matching a feature name.
 * Uses flexible keyword matching: tries multiple AB-related prefixes
 * combined with the feature name (or key words from it).
 * Returns the URL of the best match, or '' if nothing found.
 */
export async function searchAbReport(featureName: string, userAccessToken?: string): Promise<string> {
  if (!featureName) return '';
  // Drive search requires user_access_token; fall back to tenant token (may not return results)
  const token = userAccessToken || await getAccessToken();

  // Extract meaningful words from the feature name (skip very short/common words)
  const words = featureName
    .replace(/[\[\](){}]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2)
    .slice(0, 5);

  if (words.length === 0) return '';
  const nameQuery = words.join(' ');

  // Try multiple search queries with different AB patterns
  const queries = [
    `AB Report ${nameQuery}`,
    `A/B ${nameQuery}`,
    `AB ${nameQuery}`,
  ];

  for (const query of queries) {
    let docs: Array<{ token: string; type: string; title: string; url?: string }> = [];

    // Try the legacy search endpoint first (works with user_access_token + docs:doc scope)
    const searchRes = await fetch(`${LARK_BASE_URL}/open-apis/suite/docs-api/search/object`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        search_key: query, count: 5, offset: 0, owner_ids: [],
        docs_types: ['doc', 'docx', 'sheet', 'bitable'],
      }),
    });
    const searchData = await parseJson(searchRes, 'drive_search') as {
      code: number; msg?: string;
      data?: { docs_entities?: Array<{ docs_token: string; docs_type: string; title: string }> };
    };
    console.log('[AB search] query:', JSON.stringify(query), 'code:', searchData.code, 'msg:', searchData.msg);

    if (searchData.code === 0) {
      docs = (searchData.data?.docs_entities ?? []).map(d => ({
        token: d.docs_token, type: d.docs_type, title: d.title,
      }));
    } else {
      console.warn('[lark] drive search failed:', searchData.code, searchData.msg);
      // If unauthorized, try the tenant token as fallback (limited results)
      if (searchData.code === 99991679 && userAccessToken) {
        const tenantToken = await getAccessToken();
        const fallbackRes = await fetch(`${LARK_BASE_URL}/open-apis/suite/docs-api/search/object`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${tenantToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            search_key: query, count: 5, offset: 0, owner_ids: [],
            docs_types: ['doc', 'docx', 'sheet', 'bitable'],
          }),
        });
        const fallbackData = await parseJson(fallbackRes, 'drive_search_tenant') as {
          code: number; msg?: string;
          data?: { docs_entities?: Array<{ docs_token: string; docs_type: string; title: string }> };
        };
        console.log('[AB search] tenant fallback code:', fallbackData.code, 'msg:', fallbackData.msg);
        if (fallbackData.code === 0) {
          docs = (fallbackData.data?.docs_entities ?? []).map(d => ({
            token: d.docs_token, type: d.docs_type, title: d.title,
          }));
        }
      }
      if (docs.length === 0) continue;
    }

    console.log('[AB search] found:', docs.length, 'docs:', docs.map(d => d.title));
    if (docs.length === 0) continue;

    // Score each result by how well it matches an AB report for this feature
    const stopWords = new Set([
      'the', 'and', 'for', 'with', 'from', 'that', 'this', 'are', 'was', 'were',
      'not', 'but', 'have', 'has', 'had', 'will', 'can', 'may', 'new', 'add',
      'update', 'fix', 'bug', 'feature', 'report', 'test', 'user', 'users',
    ]);
    const lowerName = featureName.toLowerCase();
    const nameTokens = lowerName
      .replace(/[\[\](){}]/g, '')
      .split(/[\s\-_]+/)
      .filter(w => w.length > 2 && !stopWords.has(w));

    if (nameTokens.length === 0) continue;
    // Require at least half of significant tokens (min 2) to match
    const minMatches = Math.max(2, Math.ceil(nameTokens.length * 0.5));

    for (const doc of docs) {
      const t = doc.title.toLowerCase();
      // Must contain some AB indicator
      const hasAb = /\bab\b|a\/b|ab\s*report|ab\s*test|实验报告/.test(t);
      if (!hasAb) continue;
      // Count how many significant words from the feature name appear in the title
      const matchCount = nameTokens.filter(w => t.includes(w)).length;
      console.log('[AB match]', JSON.stringify(doc.title), 'matches:', matchCount, '/', nameTokens.length, 'need:', minMatches);
      if (matchCount >= minMatches) {
        if (doc.url) return doc.url;
        return `https://bytedance.sg.larkoffice.com/${doc.type}/${doc.token}`;
      }
    }
  }

  return '';
}

export async function extractFigmaUrlFromPrd(prdUrl: string): Promise<string> {
  if (!prdUrl) return '';
  // Extract doc token from URLs like https://*.larkoffice.com/docx/TOKEN
  const m = prdUrl.match(/\/docx\/([A-Za-z0-9]+)/);
  if (!m) return '';
  const docId = m[1];

  const token  = await getAccessToken();
  const blocks = await getDocBlocks(docId, token);
  const byId   = new Map(blocks.map(b => [b.block_id, b]));

  // Search ALL blocks in the document for a Figma URL
  for (const block of blocks) {
    for (const el of block.text?.elements ?? []) {
      // Check hyperlinked text
      const style = el.text_run?.text_element_style as Record<string, unknown> | undefined;
      const link  = style?.link as Record<string, unknown> | undefined;
      if (typeof link?.url === 'string' && link.url.includes('figma.com')) {
        return link.url;
      }
      // Check plain-text URLs
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

// ─── Fill "What are we building" section ──────────────────────────────────────

async function fillWhatWeAreBuilding(
  docId: string,
  description: string,
  token: string,
): Promise<void> {
  const blocks   = await getDocBlocks(docId, token);
  const byId     = new Map(blocks.map(b => [b.block_id, b]));
  const pageBlock = blocks.find(b => b.block_type === 1);
  if (!pageBlock?.children) return;

  const topLevel = pageBlock.children
    .map(id => byId.get(id))
    .filter((b): b is LarkBlock => b !== undefined);

  // Walk top-level blocks to find the "What are we building" heading,
  // then pick the first paragraph block after it.
  let foundHeading = false;
  for (const block of topLevel) {
    if (HEADING_BLOCK_TYPES.has(block.block_type)) {
      const text = blockText(block).toLowerCase();
      if (text.includes('what are we building') || text.includes('what we are building')) {
        foundHeading = true;
        continue;
      }
      if (foundHeading) break; // next heading — stop
    }
    if (foundHeading && block.block_type === 2) {
      // Found the first paragraph under the heading — update it
      await batchUpdateBlocks(docId, [{
        block_id: block.block_id,
        update_text_elements: {
          elements: [{ text_run: { content: description, text_element_style: {} } }],
        },
      }], token);
      return;
    }
  }
  console.warn('[lark] "What are we building" section not found in PRD template');
}

/**
 * Copies the PRD wiki template, names it "[PRD] {featureName}", updates the
 * "Initial version" date, optionally fills the "What are we building" section
 * with the feature description, adds Thomas as full-access collaborator, and returns the doc URL.
 */
export async function copyPrdTemplate(
  featureName: string,
  featureDescription?: string,
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
      if (featureDescription?.trim()) {
        await fillWhatWeAreBuilding(fileToken, featureDescription.trim(), token)
          .catch(e => console.warn('Fill "What are we building" failed:', e));
      }
    })(),
    addCollaborator(fileToken, token),
  ]);

  return data.data?.file?.url ?? `https://bytedance.sg.larkoffice.com/docx/${fileToken}`;
}

// ─── Batch-fetch user avatars by email ────────────────────────────────────────

/**
 * Given a map of { name → email }, resolves each email to a Lark user ID
 * and fetches their avatar URL. Returns { name → avatarUrl }.
 */
export async function batchFetchAvatars(
  nameEmailMap: Record<string, string>,
): Promise<Record<string, string>> {
  const entries = Object.entries(nameEmailMap);
  if (entries.length === 0) return {};

  const token = await getAccessToken();

  // Step 1: Batch resolve emails → user IDs
  const emails = [...new Set(entries.map(([, email]) => email))];
  const res = await fetch(`${LARK_BASE_URL}/open-apis/contact/v3/users/batch_get_id`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ emails }),
  });
  const idData = await parseJson(res, 'batch_get_id') as {
    code: number; msg?: string;
    data?: { email_users?: Record<string, Array<{ user_id: string }>> };
  };
  if (idData.code !== 0) {
    console.warn('[lark] batch_get_id failed:', idData.code, idData.msg);
    return {};
  }

  // Build email → user_id map
  const emailToUserId = new Map<string, string>();
  for (const [email, users] of Object.entries(idData.data?.email_users ?? {})) {
    if (users?.[0]?.user_id) emailToUserId.set(email, users[0].user_id);
  }

  // Step 2: Batch fetch user details (up to 50 at a time)
  const userIds = [...new Set(emailToUserId.values())];
  if (userIds.length === 0) return {};

  const userIdToAvatar = new Map<string, string>();
  for (let i = 0; i < userIds.length; i += 50) {
    const batch = userIds.slice(i, i + 50);
    const params = batch.map(id => `user_ids=${id}`).join('&');
    const userRes = await fetch(
      `${LARK_BASE_URL}/open-apis/contact/v3/users/batch?${params}&user_id_type=user_id`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const userData = await parseJson(userRes, 'users_batch') as {
      code: number; msg?: string;
      data?: { items?: Array<{ user_id: string; avatar?: { avatar_72?: string; avatar_240?: string } }> };
    };
    if (userData.code !== 0) {
      console.warn('[lark] users/batch failed:', userData.code, userData.msg);
      continue;
    }
    for (const user of userData.data?.items ?? []) {
      const url = user.avatar?.avatar_72 || user.avatar?.avatar_240;
      if (url) userIdToAvatar.set(user.user_id, url);
    }
  }

  // Step 3: Map back to name → avatarUrl
  const result: Record<string, string> = {};
  for (const [name, email] of entries) {
    const userId = emailToUserId.get(email);
    if (userId) {
      const avatar = userIdToAvatar.get(userId);
      if (avatar) result[name] = avatar;
    }
  }
  return result;
}

// ─── Add bot to Meego feature group chat ──────────────────────────────────────

/**
 * Search for a Lark group chat matching the feature name and add the bot to it.
 * Returns true if the bot was successfully added (or was already a member).
 */
export async function joinFeatureChat(featureName: string, userAccessToken?: string, meegoUrl?: string, skipJoin?: boolean): Promise<string | null> {
  if (!featureName) return null;

  const botToken = await getAccessToken();
  const appId = process.env.LARK_APP_ID;
  if (!appId) return null;

  // Try user token first (can find all chats), fall back to bot token (only chats bot is in)
  let searchToken = userAccessToken || botToken;
  console.log('[lark] joinFeatureChat:', featureName, 'using', userAccessToken ? 'user token' : 'bot token');

  // Search with full feature name, fetch more results for description-based matching
  let searchRes = await fetch(
    `${LARK_BASE_URL}/open-apis/im/v1/chats/search?query=${encodeURIComponent(featureName)}&page_size=20`,
    { headers: { Authorization: `Bearer ${searchToken}` } },
  );
  let searchData = await parseJson(searchRes, 'chat_search') as {
    code: number; msg?: string;
    data?: { items?: Array<{ chat_id: string; name: string }> };
  };

  // If user token expired, retry with bot token
  if (searchData.code !== 0 && userAccessToken && searchData.code === 99991677) {
    console.log('[lark] user token expired, retrying chat search with bot token');
    searchToken = botToken;
    searchRes = await fetch(
      `${LARK_BASE_URL}/open-apis/im/v1/chats/search?query=${encodeURIComponent(featureName)}&page_size=20`,
      { headers: { Authorization: `Bearer ${botToken}` } },
    );
    searchData = await parseJson(searchRes, 'chat_search_bot') as {
      code: number; msg?: string;
      data?: { items?: Array<{ chat_id: string; name: string }> };
    };
  }

  if (searchData.code !== 0) {
    console.warn('[lark] chat search failed:', searchData.code, searchData.msg);
    return null;
  }

  const chats = searchData.data?.items ?? [];
  if (chats.length === 0) {
    console.log('[lark] no chat found for feature:', featureName);
    return null;
  }

  // Extract Meego work item ID for description matching
  const meegoId = meegoUrl?.match(/\/detail\/(\d+)/)?.[1] ?? '';

  // Exclude known non-feature groups
  const EXCLUDE_PATTERNS = ['libra', 'checkpoint', '管控'];
  const candidates = chats.filter(c => {
    const chatLower = c.name.toLowerCase();
    if (EXCLUDE_PATTERNS.some(p => chatLower.includes(p))) return false;
    return true;
  });

  // If we have a Meego ID, check each candidate's description for a match
  let bestChat: { chat_id: string; name: string } | null = null;
  if (meegoId && candidates.length > 0) {
    for (const c of candidates) {
      try {
        const infoRes = await fetch(
          `${LARK_BASE_URL}/open-apis/im/v1/chats/${c.chat_id}`,
          { headers: { Authorization: `Bearer ${searchToken}` } },
        );
        const infoData = await infoRes.json() as { code: number; data?: Record<string, unknown> };
        if (infoData.code === 0 && infoData.data?.description && String(infoData.data.description).includes(meegoId)) {
          bestChat = c;
          console.log('[lark] matched chat by Meego ID in description:', c.name);
          break;
        }
      } catch { /* skip */ }
    }
  }

  if (!bestChat) {
    console.log('[lark] no chat with Meego ID in description for:', featureName, '— candidates:', chats.map(c => c.name));
    return null;
  }

  if (skipJoin) {
    console.log('[lark] found chat:', bestChat.name, '— skip join (old story)');
    return bestChat.chat_id;
  }

  console.log('[lark] found chat:', bestChat.name, '— adding bot');

  // Try bot self-join first, then fall back to user adding bot
  let joined = false;

  // Attempt 1: Bot adds itself via members endpoint with bot token
  const selfAddRes = await fetch(
    `${LARK_BASE_URL}/open-apis/im/v1/chats/${bestChat.chat_id}/members?member_id_type=app_id`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${botToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id_list: [appId] }),
    },
  );
  const selfAddData = await parseJson(selfAddRes, 'chat_add_bot_self') as { code: number; msg?: string };
  if (selfAddData.code === 0 || selfAddData.code === 230001) {
    joined = true;
    console.log('[lark] bot joined chat (bot token):', bestChat.name);
  }

  // Attempt 2: User adds the bot (if user token available and bot couldn't self-join)
  if (!joined && userAccessToken) {
    const addRes = await fetch(
      `${LARK_BASE_URL}/open-apis/im/v1/chats/${bestChat.chat_id}/members?member_id_type=app_id`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${userAccessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_list: [appId] }),
      },
    );
    const addData = await parseJson(addRes, 'chat_add_bot_user') as { code: number; msg?: string };
    if (addData.code === 0 || addData.code === 230001) {
      joined = true;
      console.log('[lark] bot joined chat (user token):', bestChat.name);
    } else {
      console.warn('[lark] failed to add bot to chat:', addData.code, addData.msg);
    }
  }

  if (!joined) {
    console.warn('[lark] could not join chat, returning chatId anyway:', bestChat.chat_id);
  }

  return bestChat.chat_id;
}

// ─── Find package QR code from chat messages ─────────────────────────────────

interface LarkMessage {
  message_id: string;
  msg_type: string;
  body?: { content?: string };
}

export interface PackageResult {
  android?: { qrUrl: string; downloadUrl: string };
  ios?: { qrUrl: string; downloadUrl: string };
}

/**
 * Search a chat's recent messages for the latest package releases.
 * Returns Android and/or iOS package info.
 */
export async function getPackageQrUrl(chatId: string): Promise<PackageResult | null> {
  const token = await getAccessToken();

  // Fetch recent messages (newest first)
  const res = await fetch(
    `${LARK_BASE_URL}/open-apis/im/v1/messages?container_id_type=chat&container_id=${chatId}&page_size=50&sort_type=ByCreateTimeDesc`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const data = await parseJson(res, 'list_messages') as {
    code: number; msg?: string;
    data?: { items?: LarkMessage[] };
  };

  if (data.code !== 0) {
    console.warn('[lark] list messages failed:', data.code, data.msg);
    return null;
  }

  const messages = data.data?.items ?? [];

  const result: PackageResult = {};

  // Search messages for Android package download URLs (newest first)
  for (const msg of messages) {
    if (result.android) break;
    if (!msg.body?.content) continue;
    const content = msg.body.content;
    if (!content.includes('released') && !content.includes('artifacts') && !content.includes('已发布')) continue;

    const urlPatterns = [
      /https:\/\/ttidevops[^"'\s]+package_id=\d+/,
      /https:\/\/voffline\.byted\.org\/download[^"'\s]+\.apk/,
      /https:\/\/[^"'\s]+\.apk/,
    ];

    for (const pattern of urlPatterns) {
      const match = content.match(pattern);
      if (match) {
        const downloadUrl = match[0];
        if (/ttlite|lite_android|app-lite/i.test(downloadUrl)) continue;
        console.log('[lark] found Android package:', downloadUrl.slice(0, 100));
        result.android = {
          qrUrl: `/api/lark/qr?url=${encodeURIComponent(downloadUrl)}`,
          downloadUrl,
        };
        break;
      }
    }
  }

  // Search for iOS packages: extract commit hash from card messages and use Bits API
  for (const msg of messages) {
    if (result.ios) break;
    if (!msg.body?.content) continue;
    const content = msg.body.content;
    if (!content.includes('released') && !content.includes('artifacts')) continue;
    if (!/musically|tiktok.*inhouse/i.test(content)) continue;

    const commitMatch = content.match(/code\.byted\.org\/[^/]+\/[^/]+\/commit\/([a-f0-9]{40})/);
    if (!commitMatch) continue;

    const commitHash = commitMatch[1];
    console.log('[lark] iOS card found, looking up package for commit:', commitHash.slice(0, 8));

    const { getIosPackageUrl } = await import('@/lib/bits');
    const installUrl = await getIosPackageUrl(commitHash);
    if (installUrl) {
      result.ios = {
        qrUrl: `/api/lark/qr?url=${encodeURIComponent(installUrl)}`,
        downloadUrl: installUrl,
      };
    }
  }

  if (!result.android && !result.ios) {
    console.log('[lark] no packages found in', messages.length, 'messages');
    return null;
  }

  return result;
}
