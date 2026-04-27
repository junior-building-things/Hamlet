
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

/**
 * Public accessor for the main Lark app's tenant access token. Used by the
 * digest pipeline (which lives outside this file) to call chat search /
 * message read endpoints with the same scopes the rest of the codebase
 * relies on. Cached + refreshed by the same logic as getAccessToken.
 */
export async function getLarkBotToken(): Promise<string> {
  return getAccessToken();
}

// ─── Bot identity ───────────────────────────────────────────────────────────

/**
 * Get the bot's own open_id from the LARK_BOT_OPEN_ID env var.
 * Used for @-mentioning the bot in doc cells.
 */
export function getBotOpenId(): string {
  return process.env.LARK_BOT_OPEN_ID ?? '';
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
interface MentionDoc  { token?: string; url?: string; title?: string }
interface TextElement { text_run?: TextRun; mention_doc?: MentionDoc }
interface ElementsContainer { elements?: TextElement[] }
interface LarkBlock {
  block_id:    string;
  block_type:  number;
  children?:   string[];
  text?:       ElementsContainer;
  heading1?:   ElementsContainer;
  heading2?:   ElementsContainer;
  heading3?:   ElementsContainer;
  heading4?:   ElementsContainer;
  heading5?:   ElementsContainer;
  heading6?:   ElementsContainer;
  heading7?:   ElementsContainer;
  heading8?:   ElementsContainer;
  heading9?:   ElementsContainer;
  bullet?:     ElementsContainer;
  ordered?:    ElementsContainer;
  code?:       ElementsContainer;
  quote?:      ElementsContainer;
  todo?:       ElementsContainer;
  callout?:    ElementsContainer;
  table_cell?: { row_index: number; col_index: number };
  table?:      unknown;
  /** Image block (block_type 27). `token` is a Drive media file_token. */
  image?:      { token?: string; width?: number; height?: number };
  [key: string]: unknown;
}

// All block-type properties that may carry an `elements` array. Different
// Lark docx block types store their text under different keys (heading2 under
// `heading2.elements`, bullet items under `bullet.elements`, etc.) — not all
// under `text.elements`. Missing these meant a doc full of headings and bullet
// list items came back as "(empty document)".
const TEXT_BEARING_KEYS = [
  'text',
  'heading1', 'heading2', 'heading3', 'heading4', 'heading5',
  'heading6', 'heading7', 'heading8', 'heading9',
  'bullet', 'ordered', 'code', 'quote', 'todo', 'callout',
] as const;

function blockText(b: LarkBlock): string {
  for (const key of TEXT_BEARING_KEYS) {
    const container = b[key] as ElementsContainer | undefined;
    const elements = container?.elements;
    if (elements && elements.length > 0) {
      return elements.map(e => e.text_run?.content ?? '').join('');
    }
  }
  return '';
}

// ─── Shared doc block helpers ─────────────────────────────────────────────────

async function getDocBlocks(docId: string, token: string): Promise<LarkBlock[]> {
  // Lark caps page_size at 500. Long PRDs (>500 blocks) need
  // pagination via page_token. We retry per-page on rate-limit
  // errors (99991400) with exponential backoff so a busy digest
  // run that fans out across many PRDs in parallel doesn't fail
  // outright when Lark briefly throttles us.
  const all: LarkBlock[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 20; page++) {
    const params = new URLSearchParams({ page_size: '500', document_revision_id: '-1' });
    if (pageToken) params.set('page_token', pageToken);
    type PageData = { code: number; msg?: string; data?: { items?: LarkBlock[]; has_more?: boolean; page_token?: string } };
    let attempt = 0;
    let pageData: PageData | null = null;
    while (attempt < 5) {
      const res = await fetch(
        `${LARK_BASE_URL}/open-apis/docx/v1/documents/${docId}/blocks?${params.toString()}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      pageData = await parseJson(res, 'get_blocks') as PageData;
      if (pageData.code === 99991400) {
        const wait = 500 * (attempt + 1) * (attempt + 1); // 500, 2000, 4500, 8000, 12500ms
        console.warn(`[lark] get_blocks rate limited, retrying in ${wait}ms (attempt ${attempt + 1})`);
        await new Promise(r => setTimeout(r, wait));
        attempt++;
        continue;
      }
      break;
    }
    if (!pageData || pageData.code !== 0) {
      throw new Error(`get_blocks error ${pageData?.code}: ${pageData?.msg}`);
    }
    all.push(...(pageData.data?.items ?? []));
    if (!pageData.data?.has_more || !pageData.data.page_token) break;
    pageToken = pageData.data.page_token;
  }
  return all;
}

type UpdateTextElement =
  | { text_run: { content: string; text_element_style: Record<string, unknown> } }
  | { mention_user: { user_id: string; text_element_style: Record<string, unknown> } };

type UpdateRequest = {
  block_id: string;
  update_text_elements: { elements: UpdateTextElement[] };
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

/**
 * Grant the bot edit access to a doc using the user's access token.
 * Used when the bot needs to modify a PRD it wasn't originally a collaborator on.
 * Returns true if the grant succeeded.
 */
export async function grantBotEditAccess(
  prdUrl: string,
  userAccessToken: string,
): Promise<boolean> {
  const botOpenId = getBotOpenId();
  if (!botOpenId) return false;
  try {
    const fileToken = await resolveDocId(prdUrl);
    const res = await fetch(
      `${LARK_BASE_URL}/open-apis/drive/v1/permissions/${fileToken}/members?type=docx&need_notification=false`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${userAccessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ member_type: 'openid', member_id: botOpenId, perm: 'edit', type: 'user' }),
      },
    );
    const data = await parseJson(res, 'grant_bot_access') as { code: number; msg?: string };
    if (data.code === 0) return true;
    console.warn(`[lark] grantBotEditAccess failed (code ${data.code}): ${data.msg}`);
    return false;
  } catch (e) {
    console.warn('[lark] grantBotEditAccess error:', e);
    return false;
  }
}

// ─── Transfer doc ownership ─────────────────────────────────────────────────

/**
 * Transfer ownership of a Lark doc from the bot to the PM.
 * Uses the docs:permission.member:transfer scope.
 */
async function transferOwnership(fileToken: string, token: string): Promise<void> {
  const res = await fetch(
    `${LARK_BASE_URL}/open-apis/drive/v1/permissions/${fileToken}/members/transfer_owner?type=docx&need_notification=false`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ member_type: 'email', member_id: OWNER_EMAIL }),
    },
  );
  const data = await parseJson(res, 'transfer_owner') as { code: number; msg?: string };
  if (data.code !== 0) {
    console.warn(`[lark] ownership transfer failed (code ${data.code}): ${data.msg}`);
  }
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
const LIBRA_URL_RE = /https?:\/\/libra[^\s"')<>]*\/flight\/\d+[^\s"')<>]*/i;
const LIBRA_PEER_REVIEW_RE = /https?:\/\/libra[^\s"')<>]*\/peer-review\/(\d+)[^\s"')<>]*/i;

/**
 * Normalize a Libra URL: peer-review URLs are reformatted to the canonical
 * flight/edit form. E.g.:
 *   https://libra-sg.tiktok-row.net/libra/peer-review/71914392/view/101162049?version=new
 *   → https://libra-sg.tiktok-row.net/libra/flight/71914392/edit
 */
function normalizeLibraUrl(raw: string): string {
  const prMatch = raw.match(LIBRA_PEER_REVIEW_RE);
  if (prMatch) {
    const host = raw.match(/https?:\/\/[^/]+/)?.[0] ?? 'https://libra-sg.tiktok-row.net';
    return `${host}/libra/flight/${prMatch[1]}/edit`;
  }
  return raw;
}

/**
 * Clean up a matched URL by stripping trailing HTML-encoded tags (%3C, %3E)
 * and other junk that the regex might have captured from rich-text content.
 */
function cleanLibraUrl(url: string): string {
  return url.replace(/%3[CEce].*/i, '').replace(/[<>].*/, '');
}

/**
 * Try to extract a Libra URL from a string. Checks both /flight/ and
 * /peer-review/ patterns. Returns the normalized + cleaned URL or empty string.
 */
function extractLibraUrl(text: string): string {
  const flightMatch = text.match(LIBRA_URL_RE);
  if (flightMatch) return cleanLibraUrl(flightMatch[0]);
  const prMatch = text.match(LIBRA_PEER_REVIEW_RE);
  if (prMatch) return normalizeLibraUrl(cleanLibraUrl(prMatch[0]));
  return '';
}

export async function searchAbReport(
  featureName: string, userAccessToken?: string, prdUrl?: string,
): Promise<{ abReportUrl: string; libraUrl: string }> {
  const empty = { abReportUrl: '', libraUrl: '' };
  if (!featureName || !prdUrl) return empty;

  // Extract doc token from PRD URL (if available) to check inside AB report docs
  // Use lowercase for case-insensitive matching (Lark URLs sometimes lowercase the token)
  const prdDocToken = (prdUrl?.match(/\/(docx|wiki)\/([A-Za-z0-9]+)/)?.[2] ?? '').toLowerCase();

  // Drive search requires user_access_token; fall back to tenant token
  const searchToken = userAccessToken || await getAccessToken();
  const readToken = userAccessToken || await getAccessToken();

  // Extract keywords from feature name for the search query
  const stopWords = new Set([
    'the', 'and', 'for', 'with', 'from', 'that', 'this', 'are', 'was', 'were',
    'not', 'but', 'have', 'has', 'had', 'will', 'can', 'may', 'new', 'add',
    'update', 'fix', 'bug', 'feature', 'report', 'test', 'user', 'users',
    'phase', 'part', 'version',
  ]);
  const nameTokens = featureName
    .replace(/[\[\](){}]/g, '')
    .split(/[\s\-_]+/)
    .filter(w => w.length > 2 && !stopWords.has(w.toLowerCase()))
    .slice(0, 6);
  if (nameTokens.length === 0) return empty;
  const nameQuery = nameTokens.join(' ');

  // Search for AB-related docs mentioning the feature
  const queries = [
    `AB Report ${nameQuery}`,
    `A/B ${nameQuery}`,
    `AB ${nameQuery}`,
  ];

  // Collect all AB candidates across queries (dedup by token)
  const seen = new Set<string>();
  const candidates: Array<{ token: string; type: string; title: string }> = [];

  for (const query of queries) {
    const searchRes = await fetch(`${LARK_BASE_URL}/open-apis/suite/docs-api/search/object`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${searchToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        search_key: query, count: 5, offset: 0, owner_ids: [],
        docs_types: ['doc', 'docx', 'sheet', 'bitable'],
      }),
    });
    const searchData = await parseJson(searchRes, 'drive_search') as {
      code: number; msg?: string;
      data?: { docs_entities?: Array<{ docs_token: string; docs_type: string; title: string }> };
    };
    if (searchData.code !== 0) {
      console.warn(`[lark] Drive search failed for query="${query}": code=${searchData.code} msg=${searchData.msg}`);
      continue;
    }
    const rawResults = searchData.data?.docs_entities ?? [];
    for (const doc of rawResults) {
      if (seen.has(doc.docs_token)) continue;
      seen.add(doc.docs_token);
      const t = doc.title.toLowerCase();
      if (/\bab\b|a\/b/i.test(t)) {
        candidates.push({ token: doc.docs_token, type: doc.docs_type, title: doc.title });
      }
    }
  }

  if (candidates.length === 0) return empty;

  // Score candidates by title keyword overlap with feature name
  const lowerTokens = nameTokens.map(w => w.toLowerCase());
  const minMatches = Math.max(1, Math.ceil(lowerTokens.length * 0.4));

  // Sort by match count (best first)
  const scored = candidates.map(doc => {
    const t = doc.title.toLowerCase();
    const matchCount = lowerTokens.filter(w => t.includes(w)).length;
    return { ...doc, matchCount };
  }).filter(d => d.matchCount >= minMatches)
    .sort((a, b) => b.matchCount - a.matchCount);

  // Try top candidates: prefer PRD-link match, fall back to best title match
  for (let di = 0; di < Math.min(scored.length, 3); di++) {
    const doc = scored[di];
    if (di > 0) await new Promise(r => setTimeout(r, 300)); // rate limit

    try {
      const blocks = await getDocBlocks(doc.token, readToken);
      let containsPrd = false;
      let libraUrl = '';

      for (const block of blocks) {
        for (const el of block.text?.elements ?? []) {
          // Check text_run hyperlinks and content
          const style = el.text_run?.text_element_style as Record<string, unknown> | undefined;
          const link = style?.link as Record<string, unknown> | undefined;
          const linkUrl = typeof link?.url === 'string' ? link.url : '';
          const content = el.text_run?.content ?? '';

          const decodedLink = linkUrl ? decodeURIComponent(linkUrl).toLowerCase() : '';
          const lowerContent = content.toLowerCase();
          if (prdDocToken && (decodedLink.includes(prdDocToken) || lowerContent.includes(prdDocToken))) {
            containsPrd = true;
          }

          // Check mention_doc elements (document mentions like "[PRD] Feature Name")
          if (prdDocToken && el.mention_doc) {
            const mentionToken = (el.mention_doc.token ?? '').toLowerCase();
            const mentionUrl = el.mention_doc.url ? decodeURIComponent(el.mention_doc.url).toLowerCase() : '';
            if (mentionToken.includes(prdDocToken) || mentionUrl.includes(prdDocToken)) {
              containsPrd = true;
            }
          }

          // Check for Libra URL in all sources
          if (!libraUrl) {
            const allUrls = [linkUrl, content, el.mention_doc?.url ?? ''];
            for (const u of allUrls) {
              const found = extractLibraUrl(u);
              if (found) { libraUrl = found; break; }
            }
          }
        }
      }

      if (containsPrd) {
        console.log('[AB match] PRD match:', doc.title);
        return {
          abReportUrl: `https://bytedance.sg.larkoffice.com/${doc.type}/${doc.token}`,
          libraUrl,
        };
      }

    } catch (e) {
      console.warn('[AB match] failed to read doc:', doc.title, e);
    }
  }

  return empty;
}

/**
 * Search a Lark group chat for the latest Libra (AB test) URL.
 */
export async function searchLibraInChat(chatId: string): Promise<string> {
  if (!chatId) return '';
  const token = await getAccessToken();

  // Include a time window (last 30 days) — without start_time/end_time the
  // API may return stale messages instead of the most recent ones.
  // Paginate up to 4 pages (200 messages) to catch thread replies and older
  // messages. Sort newest-first so the most recent Libra link wins.
  const endTime = Math.floor(Date.now() / 1000);
  const startTime = endTime - 30 * 24 * 60 * 60; // 30 days ago
  let pageToken = '';

  for (let page = 0; page < 4; page++) {
    const params = new URLSearchParams({
      container_id_type: 'chat',
      container_id: chatId,
      start_time: String(startTime),
      end_time: String(endTime),
      sort_type: 'ByCreateTimeDesc',
      page_size: '50',
    });
    if (pageToken) params.set('page_token', pageToken);

    const res = await fetch(
      `${LARK_BASE_URL}/open-apis/im/v1/messages?${params}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    interface MsgItem { message_id: string; msg_type: string; body?: { content?: string }; thread_id?: string }
    const data = await parseJson(res, 'chat_messages_libra') as {
      code: number; msg?: string;
      data?: {
        items?: MsgItem[];
        has_more?: boolean;
        page_token?: string;
      };
    };
    if (data.code !== 0) {
      console.warn(`[libra chat] message fetch failed for ${chatId}: code=${data.code} msg=${data.msg}`);
      return '';
    }

    const items = data.data?.items ?? [];

    // Two-pass search: first check all top-level messages, collecting any
    // that mention "libra" as candidates for thread-reply search. Then
    // check thread replies ONLY for those candidates. This avoids the
    // expensive thread-reply API call for every message (~40 calls per
    // feature down to ~1-2).
    const libraParents: MsgItem[] = [];
    for (const msg of items) {
      const content = msg.body?.content ?? '';
      const flat = typeof content === 'string' ? content : JSON.stringify(content);

      // Check the top-level message itself.
      if (flat.toLowerCase().includes('libra')) {
        libraParents.push(msg);
      }
    }

    // Check thread replies for messages that mention libra (newest parent first).
    // A thread reply with a newer Libra URL takes priority.
    for (const msg of libraParents) {
      try {
        const replyRes = await fetch(
          `${LARK_BASE_URL}/open-apis/im/v1/messages/${msg.message_id}/replies?page_size=50`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        const replyData = await replyRes.json() as {
          code: number;
          data?: { items?: MsgItem[] };
        };
        if (replyData.code === 0) {
          const replies = (replyData.data?.items ?? []).reverse();
          for (const reply of replies) {
            const rc = reply.body?.content ?? '';
            const rf = typeof rc === 'string' ? rc : JSON.stringify(rc);
            const found = extractLibraUrl(rf);
            if (found) return found;
          }
        }
      } catch { /* ignore thread fetch errors */ }
    }

    // Fall back to the top-level match if no thread reply had a Libra URL.
    for (const msg of libraParents) {
      const content = msg.body?.content ?? '';
      const flat = typeof content === 'string' ? content : JSON.stringify(content);
      const found = extractLibraUrl(flat);
      if (found) return found;
    }

    if (!data.data?.has_more || !data.data?.page_token) break;
    pageToken = data.data.page_token;
  }
  return '';
}

export async function extractFigmaUrlFromPrd(prdUrl: string): Promise<string> {
  if (!prdUrl) return '';
  // Resolve both /docx/TOKEN and /wiki/TOKEN URLs to a docx ID.
  let docId: string;
  try {
    docId = await resolveDocId(prdUrl);
  } catch {
    return ''; // not a Lark doc URL
  }

  const token  = await getAccessToken();
  const blocks = await getDocBlocks(docId, token);

  // Search ALL blocks in the document for a Figma URL. Check every
  // text-bearing container (text, heading*, bullet, ordered, etc.) since
  // the Figma link could be inside a heading or bullet, not just a plain
  // paragraph.
  for (const block of blocks) {
    for (const key of TEXT_BEARING_KEYS) {
      const container = block[key] as ElementsContainer | undefined;
      const elements = container?.elements;
      if (!elements) continue;
      for (const el of elements) {
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
 *
 * Walks ALL blocks in the document (not just direct children of the page)
 * so nested blocks inside tables, quotes, grids, etc. are included. This is
 * required for docs where the useful content lives inside a table — e.g. the
 * merge calendar, whose version → freeze date rows are all table cells.
 */
export async function readDocContent(docUrl: string): Promise<string> {
  const docId = await resolveDocId(docUrl);
  console.log(`[readDocContent] resolved docId=${docId} from url=${docUrl}`);

  const token  = await getAccessToken();
  const blocks = await getDocBlocks(docId, token);
  console.log(`[readDocContent] got ${blocks.length} blocks`);

  // Distribution of block_type values (for diagnosing docs that return zero text)
  const typeCounts = new Map<number, number>();
  let withText = 0;
  for (const b of blocks) {
    typeCounts.set(b.block_type, (typeCounts.get(b.block_type) ?? 0) + 1);
    if (blockText(b).trim()) withText++;
  }
  console.log(
    `[readDocContent] block_type counts: ${[...typeCounts.entries()].map(([t, n]) => `${t}:${n}`).join(', ')}, ${withText} have text`,
  );

  const lines: string[] = [];
  for (const b of blocks) {
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
 * Like readDocContent, but reads using the supplied access token
 * instead of the bot tenant token. Used when the bot doesn't have
 * permission on a doc but the PM (who already does) is invoking
 * the read on the bot's behalf.
 */
export async function readDocContentWithToken(docUrl: string, token: string): Promise<string> {
  const docId = await resolveDocId(docUrl);
  const blocks = await getDocBlocks(docId, token);
  const lines: string[] = [];
  for (const b of blocks) {
    const text = blockText(b);
    if (!text.trim()) continue;
    if (HEADING_BLOCK_TYPES.has(b.block_type)) {
      const level = b.block_type - 2;
      lines.push(`${'#'.repeat(level)} ${text}`);
    } else {
      lines.push(text);
    }
  }
  return lines.join('\n') || '(empty document)';
}

/**
 * Pull the body text under each named section from a markdown-ish doc
 * representation (the kind `readDocContent` produces — `#`/`##`/`###`
 * prefixes denote heading levels, plain lines are body content).
 *
 * Recognises THREE patterns for section starts:
 *   1. Heading line:      `## Background` / `### 背景`
 *   2. Inline bold label: `**Background**: …`
 *   3. Inline plain label:`Background: …` (must lead the line, may be
 *                         preceded by bullet markers `•`, `-`, `*`)
 *
 * For headings, the body is every following non-heading line until the
 * next heading. For inline labels, the body is the rest of the same
 * line PLUS any following non-label, non-heading lines until the next
 * trigger — so multi-paragraph descriptions still come through.
 *
 * Returns a Map of canonical name → joined body text. `maxChars` caps
 * each body to keep downstream card content compact.
 */
export function extractDocSections(
  markdown: string,
  sections: Array<{ canonical: string; aliases: string[] }>,
  maxChars = 600,
): Map<string, string> {
  const out = new Map<string, string>();
  const lines = markdown.split('\n');
  // Build the alias → canonical map and a single regex that matches any
  // alias as an inline label (with or without bold + leading bullet).
  const aliasMap = new Map<string, string>();
  for (const s of sections) {
    for (const a of s.aliases) aliasMap.set(a.toLowerCase(), s.canonical);
  }
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const aliasUnion = [...aliasMap.keys()].map(escape).join('|');
  // Optional leading whitespace + bullet glyph + optional bold + alias
  // + optional bold close + optional version-style "(43.9)" + colon.
  const inlineLabelRe = new RegExp(
    `^[\\s]*[•*\\-]?[\\s]*(?:\\*\\*)?(${aliasUnion})(?:\\*\\*)?[\\s]*(?:\\([^)]*\\))?[\\s]*[::][\\s]*(.*)$`,
    'i',
  );
  let activeCanonical: string | null = null;
  let activeBody: string[] = [];
  const flush = () => {
    if (activeCanonical && activeBody.length > 0) {
      const joined = activeBody.join(' ').replace(/\s+/g, ' ').trim();
      if (joined && !out.has(activeCanonical)) {
        out.set(activeCanonical, joined.length > maxChars ? joined.slice(0, maxChars - 1) + '…' : joined);
      }
    }
    activeBody = [];
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    // Pattern 1: heading line.
    const headingMatch = line.match(/^(#+)\s*(.*)$/);
    if (headingMatch) {
      flush();
      const headingText = headingMatch[2].toLowerCase();
      activeCanonical = null;
      for (const [alias, canonical] of aliasMap) {
        if (headingText === alias || headingText.startsWith(alias)) {
          activeCanonical = canonical;
          break;
        }
      }
      continue;
    }
    // Pattern 2/3: inline label at line start.
    const inlineMatch = line.match(inlineLabelRe);
    if (inlineMatch) {
      flush();
      const alias = inlineMatch[1].toLowerCase();
      activeCanonical = aliasMap.get(alias) ?? null;
      const rest = inlineMatch[2].trim();
      if (rest) activeBody.push(rest);
      continue;
    }
    // Continuation body for the active section.
    if (activeCanonical) activeBody.push(line);
  }
  flush();
  return out;
}

/**
 * Find the AB Setup table in a PRD and return a compact one-liner of
 * each variant's treatment description, in the form
 *   "v0 (Control) Online version (SA PGC...); v1 SA PGC + UGC..."
 *
 * The heading is matched by the same alias list used elsewhere ("AB
 * set-up" / "A/B testing setup" / etc.). After the heading, the next
 * Lark table block is treated as the variants table — column 0 is
 * the group name (v0/v1/...), column 1 is the treatment description.
 * Header rows are filtered out heuristically (any row whose group
 * cell text doesn't start with "v" + digit).
 *
 * Lark stores table cells in row-major order under `table.cells`. Cell
 * blocks themselves carry an empty `table_cell: {}` — no row/col index
 * — so positions are derived from cell ordering and the table's
 * `table.property.column_size`.
 *
 * Returns '' if the heading or table can't be located.
 */
export async function extractAbSetupTable(docUrl: string, headingAliases: string[]): Promise<string> {
  let docId: string;
  try { docId = await resolveDocId(docUrl); } catch { return ''; }
  const token  = await getAccessToken();
  let blocks: LarkBlock[];
  try { blocks = await getDocBlocks(docId, token); } catch { return ''; }
  if (blocks.length === 0) return '';

  const byId = new Map(blocks.map(b => [b.block_id, b]));

  const pageBlock = blocks.find(b => b.block_type === 1);
  if (!pageBlock?.children) return '';

  // Walk top-level blocks (children of the page) to find the heading
  // and then the next table after it. Subheadings between the matched
  // heading and the table are allowed (lower in the page hierarchy
  // = higher block_type number, since heading1=3, heading2=4, …);
  // only a heading at the SAME-or-higher level terminates the scan.
  const aliases = headingAliases.map(a => a.toLowerCase());
  let foundHeadingLevel: number | undefined;
  let tableBlock: LarkBlock | undefined;
  // A table block has block_type 31 in Lark's docx schema. It carries
  // its cell ids under both `children` and `table.cells`, plus a
  // `table.property.column_size` that tells us how to slice them
  // into rows.
  const isTableBlock = (b: LarkBlock | undefined) => !!b && b.block_type === 31;
  for (const childId of pageBlock.children) {
    const block = byId.get(childId);
    if (!block) continue;
    if (HEADING_BLOCK_TYPES.has(block.block_type)) {
      const text = blockText(block).toLowerCase().trim();
      if (aliases.some(a => text === a || text.startsWith(a))) {
        foundHeadingLevel = block.block_type;
        continue;
      }
      if (foundHeadingLevel !== undefined && block.block_type <= foundHeadingLevel) break;
    }
    if (foundHeadingLevel !== undefined && isTableBlock(block)) {
      tableBlock = block;
      break;
    }
  }
  if (!tableBlock) return '';

  // Pull cell ids (row-major) and the column count from the table
  // block's `table` property.
  type TableProp = { table?: { cells?: string[]; property?: { column_size?: number; row_size?: number } } };
  const tableMeta = (tableBlock as unknown as TableProp).table;
  const cellIds = tableMeta?.cells ?? tableBlock.children ?? [];
  const columnSize = tableMeta?.property?.column_size ?? 0;
  if (cellIds.length === 0 || columnSize <= 0) return '';

  // Read the joined plain text of every paragraph block inside a cell
  // (cells can hold multiple paragraphs). Returns trimmed content.
  function cellText(cellId: string): string {
    const out: string[] = [];
    function walk(blockId: string) {
      const b = byId.get(blockId);
      if (!b) return;
      const t = blockText(b);
      if (t) out.push(t);
      for (const cid of b.children ?? []) walk(cid);
    }
    walk(cellId);
    return out.join(' ').replace(/\s+/g, ' ').trim();
  }

  const lines: string[] = [];
  const rowCount = Math.ceil(cellIds.length / columnSize);
  for (let row = 0; row < rowCount; row++) {
    const groupCellId = cellIds[row * columnSize + 0];
    const treatmentCellId = cellIds[row * columnSize + 1];
    if (!groupCellId || !treatmentCellId) continue;
    const group = cellText(groupCellId);
    const treatment = cellText(treatmentCellId);
    if (!group || !treatment) continue;
    // Filter out the header row: only keep rows whose group looks
    // like a variant (v0, v1, V2 (Control), etc.).
    if (!/^v\d/i.test(group)) continue;
    lines.push(`${group} ${treatment}`);
  }
  return lines.join('; ');
}

/**
 * Walk the page-level blocks of a doc looking for a heading whose text
 * matches one of the supplied aliases. Once found, collect the Drive
 * media file_tokens of every image block (block_type 27) that appears
 * BEFORE the next same-or-higher-level heading. Recurses into the
 * children of intermediate blocks (so images nested inside callouts
 * or lists are picked up too).
 *
 * Returns the file_tokens in document order, deduplicated.
 */
export async function extractSectionImageTokens(
  docUrl: string,
  headingAliases: string[],
): Promise<string[]> {
  let docId: string;
  try { docId = await resolveDocId(docUrl); } catch { return []; }
  const token  = await getAccessToken();
  let blocks: LarkBlock[];
  try { blocks = await getDocBlocks(docId, token); } catch { return []; }
  if (blocks.length === 0) return [];

  const byId = new Map(blocks.map(b => [b.block_id, b]));
  const pageBlock = blocks.find(b => b.block_type === 1);
  if (!pageBlock?.children) return [];

  const aliases = headingAliases.map(a => a.toLowerCase());
  let foundHeadingLevel: number | undefined;
  const tokens: string[] = [];

  // Recursively collect image file_tokens from a block subtree.
  const collectImages = (rootId: string) => {
    const visit = (blockId: string) => {
      const b = byId.get(blockId);
      if (!b) return;
      if (b.block_type === 27 && b.image?.token) tokens.push(b.image.token);
      for (const cid of b.children ?? []) visit(cid);
    };
    visit(rootId);
  };

  for (const childId of pageBlock.children) {
    const block = byId.get(childId);
    if (!block) continue;
    if (HEADING_BLOCK_TYPES.has(block.block_type)) {
      const text = blockText(block).toLowerCase().trim();
      if (aliases.some(a => text === a || text.startsWith(a))) {
        foundHeadingLevel = block.block_type;
        continue;
      }
      if (foundHeadingLevel !== undefined && block.block_type <= foundHeadingLevel) break;
    }
    if (foundHeadingLevel !== undefined) collectImages(childId);
  }

  // Dedupe while preserving order.
  return [...new Set(tokens)];
}

/**
 * Download an image referenced by a Lark Drive media `file_token`
 * that's embedded in a docx, then re-upload it via `/im/v1/images`
 * so it can be embedded in a Lark `post` message via
 * `{tag: 'img', image_key, …}`. Returns the resulting `image_key`
 * or null on any failure.
 *
 * The `parentDocToken` is the docx's own file_token — Lark's media
 * download API requires it via the `extra` query param to authorise
 * access to images that live inside a doc. Without it the download
 * returns 400 Bad Request.
 */
export async function uploadDocImageForMessage(
  imageFileToken: string,
  parentDocToken: string,
  userAccessToken?: string,
): Promise<{ image_key: string; width?: number; height?: number } | null> {
  const tenantToken = await getAccessToken();
  // 1) Download the binary from Drive media API. The `extra` param
  // tells Lark which docx the image belongs to so it can verify
  // access on our behalf. Try the bot tenant token first (it has
  // the docs:document.media:download scope), then fall back to the
  // PM's user_access_token if the bot is denied (e.g. the scope
  // was revoked, or the doc is restricted to the user's identity).
  const extra = encodeURIComponent(JSON.stringify({ doc_type: 'docx', doc_token: parentDocToken }));
  const tryDownload = async (auth: string, label: string) => {
    const res = await fetch(
      `${LARK_BASE_URL}/open-apis/drive/v1/medias/${imageFileToken}/download?extra=${extra}`,
      { headers: { Authorization: `Bearer ${auth}` } },
    );
    if (res.ok) return res;
    const body = await res.text().catch(() => '');
    console.warn(`[lark] image download failed (${label}): ${res.status} ${res.statusText} token=${imageFileToken} body=${body.slice(0, 300)}`);
    return null;
  };
  let dlRes = await tryDownload(tenantToken, 'bot');
  if (!dlRes && userAccessToken) {
    dlRes = await tryDownload(userAccessToken, 'user');
  }
  if (!dlRes) return null;
  const blob = await dlRes.blob();
  if (blob.size === 0) return null;

  // 2) Re-upload to IM messages — must use the BOT tenant token here
  // because the resulting image_key needs to be usable by the bot
  // when it sends the post.
  const fd = new FormData();
  fd.append('image_type', 'message');
  fd.append('image', blob, 'image.png');
  const upRes = await fetch(`${LARK_BASE_URL}/open-apis/im/v1/images`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tenantToken}` },
    body: fd,
  });
  const upData = await upRes.json() as { code: number; msg?: string; data?: { image_key?: string } };
  if (upData.code !== 0 || !upData.data?.image_key) {
    console.warn(`[lark] image reupload failed: code=${upData.code} msg=${upData.msg}`);
    return null;
  }
  return { image_key: upData.data.image_key };
}

/**
 * Resolve a Lark wiki / docx URL to its underlying document `obj_token`
 * (a.k.a. doc_token). Exposed so callers that already need the token
 * for things like `uploadDocImageForMessage` don't have to round-trip
 * through `readDocContent`.
 */
export async function resolveDocIdFromUrl(url: string): Promise<string> {
  return resolveDocId(url);
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
 * Append an entry to the PRD's Change Log section. Creates the section
 * if it doesn't exist. Each entry is a bullet-style paragraph prepended
 * after the section heading (newest first).
 *
 * Format: "[YYYY-MM-DD] description"
 */
/**
 * Get the last modifier's name for a Lark document.
 * Uses the Drive file meta API to find who last edited the doc.
 */
export async function getDocLastModifier(docUrl: string): Promise<string> {
  const docId = await resolveDocId(docUrl);
  const token = await getAccessToken();
  const res = await fetch(
    `${LARK_BASE_URL}/open-apis/drive/v1/metas/batch_query`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        request_docs: [{ doc_token: docId, doc_type: 'docx' }],
        with_url: false,
      }),
    },
  );
  const data = await parseJson(res, 'drive_meta') as {
    code: number;
    data?: { metas?: Array<{ latest_modify_user?: { display_name?: string; en_name?: string } }> };
  };
  if (data.code !== 0) return '';
  const meta = data.data?.metas?.[0];
  // latest_modify_user can be a string (open_id) or an object with name fields
  const rawUser = meta?.latest_modify_user;
  if (!rawUser) return '';
  if (typeof rawUser === 'object') return rawUser.en_name || rawUser.display_name || '';

  // It's an open_id string — resolve to a name via contact API
  const userId = rawUser as unknown as string;
  try {
    const userRes = await fetch(
      `${LARK_BASE_URL}/open-apis/contact/v3/users/${userId}?user_id_type=open_id`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const userData = await parseJson(userRes, 'get_user') as {
      code: number;
      data?: { user?: { en_name?: string; name?: string } };
    };
    if (userData.code === 0) {
      return userData.data?.user?.en_name || userData.data?.user?.name || '';
    }
  } catch { /* ignore */ }
  return '';
}

function formatChangeLogEntry(e: { date: string; detail: string; by?: string }): string {
  return e.by ? `[${e.date}] ${e.detail} — ${e.by}` : `[${e.date}] ${e.detail}`;
}

export async function appendPrdChangeLog(
  prdUrl: string,
  entries: Array<{ date: string; detail: string; by?: string }>,
): Promise<void> {
  if (entries.length === 0) return;

  const docId = await resolveDocId(prdUrl);
  const token = await getAccessToken();
  const blocks = await getDocBlocks(docId, token);

  // Build parent map
  const parentOf = new Map<string, string>();
  for (const b of blocks) {
    for (const childId of b.children ?? []) parentOf.set(childId, b.block_id);
  }
  const byId = new Map(blocks.map(b => [b.block_id, b]));

  // Find the Change Log table by looking for header row cells with matching keywords.
  // The table may be under any heading — search all table cells in row 0.
  const KEYWORDS = ['change log', 'changelog', 'version history', 'date//日期', '修改人', 'date//日期'];
  let tableBlockId = '';

  // Collect all text from a block and its descendants
  function allText(blockId: string): string {
    const b = byId.get(blockId);
    if (!b) return '';
    const parts = [blockText(b)];
    for (const childId of b.children ?? []) parts.push(allText(childId));
    return parts.join(' ').toLowerCase();
  }

  for (const b of blocks) {
    if (!b.table_cell) continue;
    const cellText = allText(b.block_id);
    if (KEYWORDS.some(kw => cellText.includes(kw))) {
      // Walk up to find the table block (parent of the cell)
      let parentId = parentOf.get(b.block_id);
      // table_cell → table (may be one or two levels up)
      while (parentId) {
        const parent = byId.get(parentId);
        if (parent?.table) { tableBlockId = parentId; break; }
        parentId = parentOf.get(parentId);
      }
      if (tableBlockId) {
        console.log(`[lark] found Change Log table: ${tableBlockId} (matched: "${cellText.trim().slice(0, 40)}")`);
        break;
      }
    }
  }

  if (tableBlockId) {
    // Collect existing cell IDs before insertion
    const existingCellIds = new Set(blocks.filter(b => b.table_cell).map(b => b.block_id));
    const tableBlock = byId.get(tableBlockId);
    const tableProps = tableBlock?.table as { property?: { row_size?: number; column_size?: number } } | undefined;
    const colCount = tableProps?.property?.column_size ?? 3;
    let rowCount = tableProps?.property?.row_size ?? 0;

    for (const entry of entries) {
      // Step 1: Insert a new row via batch_update
      const insertRes = await fetch(
        `${LARK_BASE_URL}/open-apis/docx/v1/documents/${docId}/blocks/batch_update`,
        {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requests: [{
              block_id: tableBlockId,
              insert_table_row: { row_index: rowCount },
            }],
            document_revision_id: -1,
          }),
        },
      );
      const insertData = await parseJson(insertRes, 'insert_table_row') as { code: number; msg?: string };
      if (insertData.code !== 0) {
        throw new Error(`insert_table_row failed (code ${insertData.code}): ${insertData.msg}`);
      }

      // Step 2: Re-fetch blocks and find NEW cells (IDs that didn't exist before)
      const freshBlocks = await getDocBlocks(docId, token);
      const newCells = freshBlocks.filter(nb =>
        nb.table_cell && !existingCellIds.has(nb.block_id),
      );
      // Add new cell IDs to the set for subsequent iterations
      for (const nc of newCells) existingCellIds.add(nc.block_id);

      console.log(`[lark] inserted row: ${newCells.length} new cells (expected ${colCount})`);

      // Step 3: Fill cells — col0=date, col1=description, col2=by (as @mention)
      const botOpenId = getBotOpenId();
      const cells: Array<{ text: string; mention?: string }> = [
        { text: entry.date },
        { text: entry.detail },
        { text: entry.by ?? '@Junior', mention: botOpenId },
      ];
      for (let col = 0; col < Math.min(newCells.length, cells.length); col++) {
        // Find the paragraph block inside the cell
        let paraId = '';
        for (const childId of newCells[col].children ?? []) {
          const child = freshBlocks.find(nb => nb.block_id === childId);
          if (child?.block_type === 2) { paraId = child.block_id; break; }
        }
        if (paraId) {
          const cell = cells[col];
          const elements: UpdateTextElement[] = cell.mention
            ? [{ mention_user: { user_id: cell.mention, text_element_style: {} } }]
            : [{ text_run: { content: cell.text, text_element_style: {} } }];
          await batchUpdateBlocks(docId, [{
            block_id: paraId,
            update_text_elements: { elements },
          }], token);
        }
      }
      console.log(`[lark] Change Log row added: ${entry.date} | ${entry.detail} | ${entry.by ?? '@Junior'}`);
      rowCount++;
    }
    return;
  }

  console.warn('[lark] no Change Log table found, falling back to text paragraphs');
  // Fallback: add text paragraphs
  const pageBlock = blocks.find(b => b.block_type === 1);
  if (!pageBlock?.children) throw new Error('Empty document');
  const topLevel = pageBlock.children.map(id => byId.get(id)).filter((b): b is LarkBlock => !!b);

  const HEADING_ALIASES = ['change log', 'changelog', 'version history'];
  let headingIndex = -1;
  for (let i = 0; i < topLevel.length; i++) {
    if (HEADING_BLOCK_TYPES.has(topLevel[i].block_type)) {
      const text = blockText(topLevel[i]).toLowerCase();
      if (HEADING_ALIASES.some(alias => text.includes(alias))) { headingIndex = i; break; }
    }
  }

  const newBlocks = entries.map(e => ({
    block_type: 2,
    text: { elements: [{ text_run: { content: formatChangeLogEntry(e) } }] },
  }));

  const insertBody = headingIndex === -1
    ? { children: [{ block_type: 4, heading2: { elements: [{ text_run: { content: 'Change Log' } }] } }, ...newBlocks] }
    : { children: newBlocks, index: headingIndex + 1 };

  await fetch(
    `${LARK_BASE_URL}/open-apis/docx/v1/documents/${docId}/blocks/${pageBlock.block_id}/children?document_revision_id=-1`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(insertBody),
    },
  );
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
 * Rename a Lark document's title (the page block).
 * PRD docs are titled "[PRD] Feature Name" — this updates that title.
 */
export async function renameDocument(docUrl: string, newTitle: string): Promise<void> {
  const docId = await resolveDocId(docUrl);
  const token = await getAccessToken();
  const blocks = await getDocBlocks(docId, token);

  const pageBlock = blocks.find(b => b.block_type === 1);
  if (!pageBlock) throw new Error('No page block found in document');

  await batchUpdateBlocks(docId, [{
    block_id: pageBlock.block_id,
    update_text_elements: { elements: [{ text_run: { content: newTitle, text_element_style: {} } }] },
  }], token);
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
  options?: { useHalfDayPrd?: boolean; meegoUrl?: string; complianceUrl?: string; folderToken?: string; copyToken?: string },
): Promise<string> {
  const botToken = await getAccessToken();
  // Use copyToken (user's token) for the copy so the file is owned by the
  // user and lands in their "My Document Library". Fall back to bot token
  // if no user token is provided.
  const copyAsToken = options?.copyToken || botToken;
  const templateToken = options?.useHalfDayPrd ? HALF_DAY_WIKI_NODE_TOKEN : WIKI_NODE_TOKEN;
  const [folderToken, objToken] = await Promise.all([
    options?.folderToken ? Promise.resolve(options.folderToken) : getRootFolderToken(copyAsToken),
    getWikiObjToken(botToken, templateToken),
  ]);

  const res  = await fetch(`${LARK_BASE_URL}/open-apis/drive/v1/files/${objToken}/copy`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${copyAsToken}`, 'Content-Type': 'application/json' },
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

  // Doc updates (sequential) + collaborator/ownership (parallel).
  // The bot creates the doc, fills in template fields, then transfers
  // ownership to the PM so the file appears in their "My Documents".
  await Promise.all([
    (async () => {
      await updateInitialVersionDate(fileToken, today, botToken);
      await updatePrdBasicInfo(fileToken, {
        meegoUrl: options?.meegoUrl,
        complianceUrl: options?.complianceUrl,
      }, botToken).catch(e => console.warn('PRD basic info fill failed:', e));
      if (featureDescription?.trim()) {
        await fillWhatWeAreBuilding(fileToken, featureDescription.trim(), botToken)
          .catch(e => console.warn('Fill "What are we building" failed:', e));
      }
    })(),
    (async () => {
      // Add PM as collaborator first, then transfer ownership to them.
      // The bot keeps edit access since the new owner can't revoke the app.
      await addCollaborator(fileToken, botToken);
      if (!options?.copyToken) {
        // Only transfer if bot created the doc (no user copyToken)
        await transferOwnership(fileToken, botToken);
      }
    })(),
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
  userAccessToken?: string,
): Promise<Record<string, string>> {
  const entries = Object.entries(nameEmailMap);
  if (entries.length === 0) return {};

  // Prefer user token (has contact:user.base:readonly for avatar access)
  const token = userAccessToken || await getAccessToken();

  // Resolve emails to user IDs, then fetch avatars
  const result: Record<string, string> = {};
  const emailToAvatar = new Map<string, string>();
  const uniqueEmails = [...new Set(entries.map(([, email]) => email))];

  // Batch resolve emails → user IDs using user_id type (works with @bytedance.com emails)
  const emailToUserId = new Map<string, string>();
  for (let i = 0; i < uniqueEmails.length; i += 5) {
    const batch = uniqueEmails.slice(i, i + 5);
    try {
      const res = await fetch(
        `${LARK_BASE_URL}/open-apis/contact/v3/users/batch_get_id?user_id_type=user_id`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ emails: batch }),
        },
      );
      const d = await res.json() as {
        code: number; msg?: string;
        data?: { user_list?: Array<{ email?: string; user_id?: string }> };
      };
      if (d.code === 0) {
        for (const u of d.data?.user_list ?? []) {
          if (u.email && u.user_id) emailToUserId.set(u.email, u.user_id);
        }
      }
    } catch { /* skip */ }
  }

  // Batch fetch user avatars
  const userIds = [...new Set(emailToUserId.values())];
  const userIdToAvatar = new Map<string, string>();
  for (let i = 0; i < userIds.length; i += 50) {
    const batch = userIds.slice(i, i + 50);
    try {
      const params = batch.map(id => `user_ids=${id}`).join('&');
      const res = await fetch(
        `${LARK_BASE_URL}/open-apis/contact/v3/users/batch?${params}&user_id_type=user_id`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const d = await res.json() as {
        code: number;
        data?: { items?: Array<{ user_id: string; avatar?: { avatar_72?: string; avatar_240?: string } }> };
      };
      if (d.code === 0) {
        for (const u of d.data?.items ?? []) {
          const avatar = u.avatar?.avatar_72 || u.avatar?.avatar_240;
          if (avatar) userIdToAvatar.set(u.user_id, avatar);
        }
      }
    } catch { /* skip */ }
  }

  // Map email → avatar
  for (const email of uniqueEmails) {
    const userId = emailToUserId.get(email);
    if (userId) {
      const avatar = userIdToAvatar.get(userId);
      if (avatar) emailToAvatar.set(email, avatar);
    }
  }

  console.log('[lark] avatar resolved:', emailToAvatar.size, '/', uniqueEmails.length);

  for (const [name, email] of entries) {
    const avatar = emailToAvatar.get(email);
    if (avatar) result[name] = avatar;
  }
  return result;
}

// ─── List every chat the bot is a member of ──────────────────────────────────

export interface JuniorChatInfo {
  chatId: string;
  name: string;
  description: string;
}

/**
 * List every group chat the calling bot is a member of, including the chat
 * description (which is where Meego work item IDs live for feature group
 * chats). Two-stage fetch:
 *   1. /im/v1/chats — paginated, returns chat_id + name only
 *   2. /im/v1/chats/{chat_id} — per-chat detail call to read the description
 *
 * Hard cap of 500 chats so a runaway membership doesn't explode runtime.
 * If the bot is in more than 500 chats this will silently truncate — fine
 * for the digest pipeline since we only care about feature groups.
 */
export async function listJuniorChats(token: string): Promise<JuniorChatInfo[]> {
  const summaries: Array<{ chatId: string; name: string }> = [];
  let pageToken = '';
  for (let page = 0; page < 10; page++) {
    const url = new URL(`${LARK_BASE_URL}/open-apis/im/v1/chats`);
    url.searchParams.set('page_size', '100');
    if (pageToken) url.searchParams.set('page_token', pageToken);
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
    const data = await parseJson(res, 'list_chats') as {
      code: number;
      msg?: string;
      data?: { items?: Array<{ chat_id: string; name: string }>; has_more?: boolean; page_token?: string };
    };
    if (data.code !== 0) {
      console.warn('[lark] list_chats failed:', data.code, data.msg);
      break;
    }
    for (const c of data.data?.items ?? []) {
      summaries.push({ chatId: c.chat_id, name: c.name });
    }
    if (!data.data?.has_more || !data.data?.page_token) break;
    pageToken = data.data.page_token;
    if (summaries.length >= 500) break;
  }

  // Stage 2: per-chat detail call to fetch description.
  // Done sequentially to respect Lark's per-app rate limit (100 req/s default
  // is comfortable here, but we don't need to push it).
  const out: JuniorChatInfo[] = [];
  for (const s of summaries) {
    try {
      const infoRes = await fetch(`${LARK_BASE_URL}/open-apis/im/v1/chats/${s.chatId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const infoData = await infoRes.json() as {
        code: number;
        data?: { name?: string; description?: string };
      };
      if (infoData.code !== 0) continue;
      out.push({
        chatId: s.chatId,
        name: infoData.data?.name ?? s.name,
        description: infoData.data?.description ?? '',
      });
    } catch {
      // Skip this chat — one failed detail call shouldn't blank the whole list.
    }
  }
  return out;
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
    if (data.code !== 230002) console.warn('[lark] list messages failed:', data.code, data.msg);
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

// ─── Send feature card to PM group chat ──────────────────────────────────────

export const PM_GROUP_CHAT_ID = 'oc_d1f9b0ad6b325ef6699e0422fa1e8541';

/**
 * Send an interactive card message to the PM group chat announcing a new feature.
 */
export async function sendFeatureCard(opts: {
  name: string;
  description?: string;
  meegoUrl: string;
  prdUrl?: string;
  priority: string;
  businessLine?: string;
  socialComponent?: string;
  /** Custom card header title. Defaults to "Feature Created ✅". */
  headerTitle?: string;
  /** Custom card header color template. Defaults to "blue". */
  headerTemplate?: string;
}): Promise<void> {
  const token = await getAccessToken();

  const fields: Array<{ label: string; value: string }> = [
    { label: 'Name', value: opts.name },
  ];
  if (opts.description) fields.push({ label: 'Description', value: opts.description });
  fields.push({ label: 'Priority', value: opts.priority });
  if (opts.businessLine) fields.push({ label: 'Business Line', value: opts.businessLine });
  if (opts.socialComponent) fields.push({ label: 'Social Component', value: opts.socialComponent });

  const elements: Array<Record<string, unknown>> = [
    ...fields.map(f => ({
      tag: 'div',
      text: { tag: 'lark_md', content: `**${f.label}:** ${f.value}` },
    })),
    { tag: 'hr' },
    {
      tag: 'action',
      actions: [
        {
          tag: 'button',
          text: { tag: 'plain_text', content: 'Hamlet' },
          type: 'primary',
          url: `${process.env.APP_URL ?? 'https://hamlet-app.vercel.app'}/projects`,
        },
        {
          tag: 'button',
          text: { tag: 'plain_text', content: 'Meego' },
          type: 'default',
          url: opts.meegoUrl,
        },
        ...(opts.prdUrl ? [{
          tag: 'button',
          text: { tag: 'plain_text', content: 'PRD' },
          type: 'default' as const,
          url: opts.prdUrl,
        }] : []),
      ],
    },
  ];

  const card = {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: opts.headerTitle ?? 'Feature Created \u2705' },
      template: opts.headerTemplate ?? 'blue',
    },
    elements,
  };

  const res = await fetch(`${LARK_BASE_URL}/open-apis/im/v1/messages?receive_id_type=chat_id`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      receive_id: PM_GROUP_CHAT_ID,
      msg_type: 'interactive',
      content: JSON.stringify(card),
    }),
  });

  const data = await parseJson(res, 'send_card') as { code: number; msg?: string };
  if (data.code !== 0) {
    console.warn('[lark] send feature card failed:', data.code, data.msg);
  } else {
    console.log('[lark] feature card sent to PM group:', opts.name);
  }
}

// ─── Chat message reading & thread replies (for agents) ─────────────────────

export interface ChatMessage {
  message_id: string;
  msg_type: string;
  create_time: string;
  sender: { sender_type: string; sender_id?: { open_id?: string; user_id?: string } };
  body?: { content?: string };
  parent_id?: string;       // set if this is a thread reply
  root_id?: string;         // root message of a thread
  mentions?: Array<{ key: string; id: { open_id?: string; user_id?: string }; name: string }>;
}

/**
 * Read chat messages since a given timestamp. Returns newest-first.
 */
export async function readChatMessages(
  chatId: string, sinceMs: number, token: string,
  options?: { pageSize?: number; includeThreadReplies?: boolean },
): Promise<ChatMessage[]> {
  const pageSize = options?.pageSize ?? 50;
  const messages: ChatMessage[] = [];
  let pageToken = '';

  while (true) {
    const params = new URLSearchParams({
      container_id_type: 'chat',
      container_id: chatId,
      start_time: String(Math.floor(sinceMs / 1000)),
      end_time: String(Math.floor(Date.now() / 1000)),
      sort_type: 'ByCreateTimeDesc',
      page_size: String(pageSize),
    });
    if (pageToken) params.set('page_token', pageToken);

    const res = await fetch(`${LARK_BASE_URL}/open-apis/im/v1/messages?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await parseJson(res, 'read_messages') as {
      code: number; msg?: string;
      data?: { items?: ChatMessage[]; has_more?: boolean; page_token?: string };
    };
    if (data.code !== 0) {
      if (data.code !== 230002) console.warn('[lark] read messages failed:', data.code, data.msg);
      break;
    }
    messages.push(...(data.data?.items ?? []));
    if (!data.data?.has_more || !data.data?.page_token) break;
    pageToken = data.data.page_token;
  }

  // Fetch thread replies so @mentions in threads are included. The list
  // messages API only returns top-level messages. Thread parents can be
  // much older than the scan window but have recent replies, so we also
  // fetch older messages (up to 30 days) to discover thread parents, then
  // fetch their replies and keep only those within the scan window.
  if (options?.includeThreadReplies) {
    // Extend the fetch to 30 days to find older thread parents
    const extendedSinceMs = sinceMs - 30 * 24 * 60 * 60 * 1000;
    let extPageToken = '';
    const olderMessages: ChatMessage[] = [];
    // Fetch up to 2 pages of older messages
    for (let page = 0; page < 2; page++) {
      const extParams = new URLSearchParams({
        container_id_type: 'chat',
        container_id: chatId,
        start_time: String(Math.floor(extendedSinceMs / 1000)),
        end_time: String(Math.floor(sinceMs / 1000)),
        sort_type: 'ByCreateTimeDesc',
        page_size: String(pageSize),
      });
      if (extPageToken) extParams.set('page_token', extPageToken);
      try {
        const extRes = await fetch(`${LARK_BASE_URL}/open-apis/im/v1/messages?${extParams}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const extData = await parseJson(extRes, 'read_older_messages') as {
          code: number; data?: { items?: ChatMessage[]; has_more?: boolean; page_token?: string };
        };
        if (extData.code !== 0) break;
        olderMessages.push(...(extData.data?.items ?? []));
        if (!extData.data?.has_more || !extData.data?.page_token) break;
        extPageToken = extData.data.page_token;
      } catch { break; }
    }

    // Combine all top-level messages (recent + older) for thread reply fetching
    const allTopLevel = [...messages, ...olderMessages].filter(m => !m.parent_id && !m.root_id);
    const MAX_THREAD_FETCHES = 20;
    let fetched = 0;
    const sinceSec = Math.floor(sinceMs / 1000);
    for (const msg of allTopLevel) {
      if (fetched >= MAX_THREAD_FETCHES) break;
      try {
        const rRes = await fetch(
          `${LARK_BASE_URL}/open-apis/im/v1/messages/${msg.message_id}/replies?page_size=50`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        const rData = await parseJson(rRes, 'thread_replies') as {
          code: number; data?: { items?: ChatMessage[] };
        };
        if (rData.code === 0 && rData.data?.items) {
          // Only keep replies within the scan window
          const replies = rData.data.items.filter(
            r => Number(r.create_time ?? 0) >= sinceSec,
          );
          if (replies.length > 0) messages.push(...replies);
        }
        fetched++;
      } catch { /* skip thread */ }
    }
  }

  return messages;
}

/**
 * Send a text message to a chat, optionally as a thread reply.
 */
export async function sendTextMessage(
  chatId: string, text: string, token: string, replyToMsgId?: string,
): Promise<string | null> {
  const body: Record<string, unknown> = {
    receive_id: chatId,
    msg_type: 'text',
    content: JSON.stringify({ text }),
  };
  if (replyToMsgId) {
    body.reply_in_thread = true;
  }

  const url = replyToMsgId
    ? `${LARK_BASE_URL}/open-apis/im/v1/messages/${replyToMsgId}/reply`
    : `${LARK_BASE_URL}/open-apis/im/v1/messages?receive_id_type=chat_id`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(replyToMsgId ? { msg_type: 'text', content: JSON.stringify({ text }) } : body),
  });
  const data = await parseJson(res, 'send_text') as { code: number; msg?: string; data?: { message_id?: string } };
  if (data.code !== 0) {
    console.warn('[lark] send text failed:', data.code, data.msg);
    return null;
  }
  return data.data?.message_id ?? null;
}

/**
 * Send a 1:1 DM to a user by enterprise email.
 * Creates a P2P chat with the user if one doesn't exist yet.
 * Requires the sending app to have `im:message:send_as_bot` and be discoverable to the recipient.
 */
export async function sendDmByEmail(
  email: string, text: string, token: string,
): Promise<string | null> {
  const res = await fetch(
    `${LARK_BASE_URL}/open-apis/im/v1/messages?receive_id_type=email`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        receive_id: email,
        msg_type: 'text',
        content: JSON.stringify({ text }),
      }),
    },
  );
  const data = await parseJson(res, 'send_dm') as { code: number; msg?: string; data?: { message_id?: string } };
  if (data.code !== 0) {
    console.warn('[lark] send DM failed:', data.code, data.msg);
    return null;
  }
  return data.data?.message_id ?? null;
}

/**
 * A single inline element inside a Lark `post` paragraph.
 * Either a plain text run or a clickable hyperlink.
 */
export type PostInline =
  | { tag: 'text'; text: string; style?: string[] }
  | { tag: 'a'; text: string; href: string }
  | { tag: 'at'; user_id: string }
  | { tag: 'img'; image_key: string; width?: number; height?: number };

/** A `post` paragraph is an array of inline elements. Empty array = blank line. */
export type PostParagraph = PostInline[];

/**
 * Build the content string for a Lark `post` message.
 * There is NO outer "post" wrapper — the content is keyed directly by locale.
 * Chinese-region Lark tenants (TikTok) want `zh_cn`.
 */
function buildPostContent(title: string, paragraphs: PostParagraph[]): string {
  return JSON.stringify({
    zh_cn: {
      title,
      content: paragraphs,
    },
  });
}

async function sendPostInternal(
  receiveIdType: 'email' | 'chat_id',
  receiveId: string,
  title: string,
  paragraphs: PostParagraph[],
  token: string,
  label: string,
): Promise<string | null> {
  const content = buildPostContent(title, paragraphs);
  const res = await fetch(
    `${LARK_BASE_URL}/open-apis/im/v1/messages?receive_id_type=${receiveIdType}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        receive_id: receiveId,
        msg_type: 'post',
        content,
      }),
    },
  );
  const data = await parseJson(res, `send_post_${label}`) as { code: number; msg?: string; data?: { message_id?: string } };
  if (data.code !== 0) {
    console.warn(`[lark] send post (${label}) failed:`, data.code, data.msg);
    console.warn(`[lark] send post (${label}) payload preview:`, content.slice(0, 1500));
    return null;
  }
  return data.data?.message_id ?? null;
}

/**
 * Send a 1:1 DM to a user by enterprise email as a Lark `post` (rich text)
 * message. Supports inline hyperlinks via {tag:'a', text, href} elements,
 * which is required for rendering clickable PRD/Meego links in the daily
 * risk digest.
 */
export async function sendPostDmByEmail(
  email: string, title: string, paragraphs: PostParagraph[], token: string,
): Promise<string | null> {
  return sendPostInternal('email', email, title, paragraphs, token, 'dm');
}

/**
 * Send a Lark `post` (rich text) message to a group chat by chat_id.
 * Same paragraph format as sendPostDmByEmail — supports inline clickable
 * hyperlinks via {tag:'a', text, href}.
 */
export async function sendPostToChat(
  chatId: string, title: string, paragraphs: PostParagraph[], token: string,
): Promise<string | null> {
  return sendPostInternal('chat_id', chatId, title, paragraphs, token, 'chat');
}

// ─── Interactive cards ─────────────────────────────────────────────────────

/**
 * Supported header colour templates for Lark interactive cards. Maps the risk
 * tier colours used in the daily digest to Lark's named palette.
 */
export type CardHeaderTemplate =
  | 'blue' | 'wathet' | 'turquoise' | 'green' | 'yellow' | 'orange'
  | 'red' | 'carmine' | 'violet' | 'purple' | 'indigo' | 'grey';

export interface CardButton {
  text: string;
  /** Opens this URL in a new tab when clicked. Omit for an action button. */
  url?: string;
  /** Sent to the card callback endpoint when clicked (action button). */
  value?: Record<string, unknown>;
  type: 'primary' | 'default' | 'danger';
}

/**
 * One section inside a multi-section interactive card. Each section renders
 * as a `div` block (lark_md content) followed by an optional row of action
 * buttons. Sections are separated by a horizontal rule in the card body.
 */
export interface CardSection {
  content: string;           // lark_md content for the div block
  buttons?: CardButton[];    // optional action buttons under this section
  /**
   * Optional images to embed inside the section, rendered as Lark
   * `img` elements between the content `div` and the action row.
   * Each entry's `image_key` must come from `/im/v1/images` upload.
   */
  images?: Array<{ image_key: string; alt?: string }>;
}

/**
 * Send a Lark interactive card message to a group chat. Each section
 * becomes `<div><action><hr>` in the card body, letting us pack multiple
 * per-feature blocks (with their own link buttons) into a single message.
 *
 * `title` is shown in the coloured card header, `template` controls the
 * header colour.
 */
export async function sendInteractiveCardToChat(
  chatId: string,
  title: string,
  template: CardHeaderTemplate,
  sections: CardSection[],
  token: string,
): Promise<string | null> {
  const elements: Array<Record<string, unknown>> = [];
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    elements.push({
      tag: 'div',
      text: { tag: 'lark_md', content: s.content },
    });
    if (s.images && s.images.length > 0) {
      for (const img of s.images) {
        elements.push({
          tag: 'img',
          img_key: img.image_key,
          alt: { tag: 'plain_text', content: img.alt ?? '' },
        });
      }
    }
    if (s.buttons && s.buttons.length > 0) {
      elements.push({
        tag: 'action',
        actions: s.buttons.map(b => {
          const action: Record<string, unknown> = {
            tag: 'button',
            text: { tag: 'plain_text', content: b.text },
            type: b.type,
          };
          if (b.url) action.url = b.url;
          if (b.value) action.value = b.value;
          return action;
        }),
      });
    }
    if (i < sections.length - 1) {
      elements.push({ tag: 'hr' });
    }
  }

  const card: Record<string, unknown> = {
    config: { wide_screen_mode: true },
    elements,
  };
  // Empty title → skip the colored header entirely (headerless card)
  if (title) {
    card.header = {
      title: { tag: 'plain_text', content: title },
      template,
    };
  }

  const content = JSON.stringify(card);
  const res = await fetch(
    `${LARK_BASE_URL}/open-apis/im/v1/messages?receive_id_type=chat_id`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        receive_id: chatId,
        msg_type: 'interactive',
        content,
      }),
    },
  );
  const data = await parseJson(res, 'send_card') as { code: number; msg?: string; data?: { message_id?: string } };
  if (data.code !== 0) {
    console.warn('[lark] send interactive card failed:', data.code, data.msg);
    console.warn('[lark] card payload preview:', content.slice(0, 1500));
    return null;
  }
  return data.data?.message_id ?? null;
}

/**
 * Add the bot to a Lark chat by chatId. Idempotent — returns true if
 * the bot is already a member or was successfully added.
 * Tries bot self-join first; falls back to user token when the bot
 * isn't in the chat (error 232011 "Operator can NOT be out of the chat").
 */
export async function addBotToChat(chatId: string, userAccessToken?: string): Promise<boolean> {
  const botToken = await getAccessToken();
  const appId = process.env.LARK_APP_ID;
  if (!appId) return false;

  // Attempt 1: bot self-join
  const selfRes = await fetch(
    `${LARK_BASE_URL}/open-apis/im/v1/chats/${chatId}/members?member_id_type=app_id`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${botToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id_list: [appId] }),
    },
  );
  const selfData = await parseJson(selfRes, 'add_bot_self') as { code: number; msg?: string };
  if (selfData.code === 0 || selfData.code === 230001) return true;

  // Attempt 2: add via user token
  if (userAccessToken) {
    const userRes = await fetch(
      `${LARK_BASE_URL}/open-apis/im/v1/chats/${chatId}/members?member_id_type=app_id`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${userAccessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_list: [appId] }),
      },
    );
    const userData = await parseJson(userRes, 'add_bot_user') as { code: number; msg?: string };
    if (userData.code === 0 || userData.code === 230001) {
      console.log(`[lark] bot added to chat via user token: ${chatId}`);
      return true;
    }
    console.warn(`[lark] addBotToChat (user token) failed (code ${userData.code}): ${userData.msg}`);
  }

  console.warn(`[lark] addBotToChat failed (code ${selfData.code}): ${selfData.msg}`);
  return false;
}

/**
 * Resolve emails to Lark open_ids for @mentions.
 */
export async function resolveOpenIds(
  emails: string[], token: string,
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (let i = 0; i < emails.length; i += 5) {
    const batch = emails.slice(i, i + 5);
    try {
      const res = await fetch(
        `${LARK_BASE_URL}/open-apis/contact/v3/users/batch_get_id?user_id_type=open_id`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ emails: batch }),
        },
      );
      const d = await res.json() as {
        code: number;
        data?: { user_list?: Array<{ email?: string; user_id?: string }> };
      };
      if (d.code === 0) {
        for (const u of d.data?.user_list ?? []) {
          if (u.email && u.user_id) result[u.email] = u.user_id;
        }
      }
    } catch { /* skip */ }
  }
  return result;
}
