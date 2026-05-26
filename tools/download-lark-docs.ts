/**
 * Download every Lark doc you own as markdown, categorized into subfolders.
 *
 * Reads each doc's block tree via /open-apis/docx/v1/documents/{id}/blocks
 * (requires docx:document:readonly — already in the user OAuth grant) and
 * renders markdown directly. We avoid the /drive/v1/export_tasks API because
 * it silently fails (job_status=2, empty body) on ~50% of docs for reasons
 * Lark doesn't document — usually docs with newer block types the exporter
 * doesn't grok. The block walk handles everything readable, no markitdown
 * dependency, no exporter round-trip.
 *
 * After rendering, Gemini Flash classifies the doc into one of:
 *   PRDs, AB Reports, Tech Designs, UATs, Research Exploration,
 *   Weekly Meetings, Miscellaneous
 * and the file lands in <DOWNLOAD_DIR>/<category>/<name>__<token>.md.
 *
 * Env (required):
 *   LARK_APP_ID
 *   LARK_APP_SECRET
 *   LARK_USER_REFRESH_TOKEN   — from /api/auth/refresh-token after logging into Hamlet.
 *                              Auto-rotates on every run; .env.local is
 *                              updated in place.
 *   GOOGLE_AI_API_KEY         — Gemini key for classification. Omit to dump
 *                              everything into Miscellaneous/.
 *
 * Env (optional):
 *   LARK_BASE_URL  (default https://open.larkoffice.com)
 *   DOWNLOAD_DIR   (default /Users/bytedance/Documents/Work/Documents)
 *   FILE_TYPES     (csv list; default "docx,doc")
 *   QUERY_KEYS     (csv list of strings to search; default = a–z + 0–9.
 *                  suite/docs-api/search/object requires a non-empty key,
 *                  so we run several searches and union by docs_token.)
 *   GEMINI_MODEL   (default "gemini-3.1-flash-lite")
 *   LIMIT          (int; cap the number of docs to download. Useful for probes.)
 *   FORCE          (1 = re-render every doc even if `__<token>.md` exists.
 *                   Default behaviour: skip docs already on disk.)
 *
 * A `.env.local` in repo root is auto-loaded if present.
 *
 * Run:
 *   npx tsx tools/download-lark-docs.ts
 */

import { writeFile, mkdir, readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { GoogleGenerativeAI } from '@google/generative-ai';

// ── minimal .env.local loader / writer ───────────────────────────────────
const ENV_PATH = resolve(process.cwd(), '.env.local');

async function loadDotEnv(): Promise<void> {
  if (!existsSync(ENV_PATH)) return;
  const text = await readFile(ENV_PATH, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    if (process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

/** Replace LARK_USER_REFRESH_TOKEN in .env.local in place. Lark rotates the
 *  refresh token on every refresh call, so without this each subsequent run
 *  fails until the user re-pastes the latest value. */
async function persistRefreshToken(newToken: string): Promise<void> {
  if (!existsSync(ENV_PATH)) return;
  const txt = await readFile(ENV_PATH, 'utf8');
  const replaced = /^LARK_USER_REFRESH_TOKEN=/m.test(txt)
    ? txt.replace(/^LARK_USER_REFRESH_TOKEN=.*$/m, `LARK_USER_REFRESH_TOKEN=${newToken}`)
    : `${txt.replace(/\s*$/, '')}\nLARK_USER_REFRESH_TOKEN=${newToken}\n`;
  await writeFile(ENV_PATH, replaced);
}

function mustEnv(k: string): string {
  const v = process.env[k];
  if (!v) { console.error(`[fatal] missing env: ${k}`); process.exit(1); }
  return v;
}

// ── Lark API helpers ──────────────────────────────────────────────────────
interface DriveFile {
  token: string;
  name: string;
  type: string;            // docx | doc | sheet | bitable | folder | mindnote | file | slides | …
  created_time: string;    // unix seconds as string
  modified_time: string;
  owner_id: string;
  parent_token?: string;
  url?: string;
}

let BASE = '';
let APP_ID = '';
let APP_SECRET = '';
let REFRESH = '';

async function getAppToken(): Promise<string> {
  const r = await fetch(`${BASE}/open-apis/auth/v3/app_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET }),
  });
  const j = await r.json() as { code: number; app_access_token?: string; msg?: string };
  if (j.code !== 0 || !j.app_access_token) {
    throw new Error(`app_access_token: code=${j.code} msg=${j.msg}`);
  }
  return j.app_access_token;
}

async function refreshUserToken(): Promise<{ access: string; me: string; rotated: string }> {
  const app = await getAppToken();
  const r = await fetch(`${BASE}/open-apis/authen/v1/refresh_access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app_access_token: app,
      grant_type: 'refresh_token',
      refresh_token: REFRESH,
    }),
  });
  const j = await r.json() as {
    code: number;
    msg?: string;
    data?: { access_token?: string; open_id?: string; refresh_token?: string };
  };
  if (j.code !== 0 || !j.data?.access_token) {
    throw new Error(`refresh_access_token: code=${j.code} msg=${j.msg}`);
  }
  return {
    access: j.data.access_token,
    me: j.data.open_id ?? '',
    rotated: j.data.refresh_token ?? '',
  };
}

/**
 * Enumerate every doc owned by the user via the legacy suite docs search
 * (POST /open-apis/suite/docs-api/search/object). That endpoint requires a
 * non-empty search_key, so we run several queries and union by docs_token.
 * The endpoint reports a `total` per query so we can confirm we caught
 * everything; in practice "a" already covers most English titles.
 *
 * Returned entities do NOT include create_time, so callers can't apply a
 * date filter without a separate metas/batch_query (which needs broader
 * scope). For now we fetch everything owned by the user.
 */
async function searchMyDocs(
  token: string,
  ownerOpenId: string,
  searchKeys: string[],
): Promise<DriveFile[]> {
  const byToken = new Map<string, DriveFile>();
  for (const key of searchKeys) {
    let offset = 0;
    let total = 0;
    do {
      const r = await fetch(`${BASE}/open-apis/suite/docs-api/search/object`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          search_key: key,
          count: 50,
          offset,
          owner_ids: [ownerOpenId],
        }),
      });
      const j = await r.json() as {
        code: number; msg?: string;
        data?: {
          docs_entities?: Array<{
            docs_token: string; docs_type: string; title: string; owner_id?: string;
          }>;
          has_more?: boolean; total?: number;
        };
      };
      if (j.code !== 0) {
        throw new Error(`suite docs search (key=${JSON.stringify(key)}): code=${j.code} msg=${j.msg}`);
      }
      const ents = j.data?.docs_entities ?? [];
      const sizeBefore = byToken.size;
      for (const e of ents) {
        if (byToken.has(e.docs_token)) continue;
        byToken.set(e.docs_token, {
          token: e.docs_token,
          name: e.title,
          type: e.docs_type,
          created_time: '',
          modified_time: '',
          owner_id: e.owner_id ?? '',
        });
      }
      const added = byToken.size - sizeBefore;
      total = j.data?.total ?? 0;
      offset += ents.length;
      console.log(`  [search] key=${JSON.stringify(key)} +${ents.length} (+${added} unique, total reported=${total}, unique so far=${byToken.size})`);
      if (!j.data?.has_more) break;
      if (ents.length === 0) break;
      // Lark's legacy search returns duplicates once it runs out of fresh
      // results; bail before hitting the offset cap (~200) where it errors.
      if (added === 0) break;
      if (offset >= 200) break;
    } while (offset < total && offset < 200);
  }
  return [...byToken.values()];
}

// Doc types we know how to fetch as block trees. sheet / bitable have no
// blocks API in the same shape, so we skip them.
const SUPPORTED_DOC_TYPES = new Set(['docx', 'doc']);

// ── block-tree fetch + markdown rendering ────────────────────────────────
interface RenderBlock {
  block_id: string;
  block_type: number;
  children?: string[];
  table_cell?: { row_index?: number; col_index?: number };
  table?: { cells?: string[]; property?: { row_size?: number; column_size?: number } };
  image?: { token?: string };
  [key: string]: unknown;
}
interface ElementsContainer { elements?: { text_run?: { content?: string }; equation?: { content?: string } }[] }
const TEXT_KEYS = [
  'text','heading1','heading2','heading3','heading4','heading5',
  'heading6','heading7','heading8','heading9',
  'bullet','ordered','code','quote','todo','callout',
];
function blockText(b: RenderBlock): string {
  for (const k of TEXT_KEYS) {
    const c = b[k] as ElementsContainer | undefined;
    if (c?.elements?.length) {
      return c.elements.map(e => e.text_run?.content ?? e.equation?.content ?? '').join('');
    }
  }
  return '';
}

async function fetchAllBlocks(token: string, docToken: string): Promise<RenderBlock[]> {
  const all: RenderBlock[] = [];
  let pageToken: string | undefined;
  for (let safety = 0; safety < 30; safety++) {
    const url = new URL(`${BASE}/open-apis/docx/v1/documents/${docToken}/blocks`);
    url.searchParams.set('page_size', '500');
    url.searchParams.set('document_revision_id', '-1');
    if (pageToken) url.searchParams.set('page_token', pageToken);
    // Per-page retry on rate-limit (99991400)
    let pageData: { code: number; msg?: string; data?: { items?: RenderBlock[]; has_more?: boolean; page_token?: string } } | undefined;
    for (let attempt = 0; attempt < 4; attempt++) {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      pageData = await r.json();
      if (pageData?.code === 99991400) {
        await new Promise(rr => setTimeout(rr, 500 * (attempt + 1) * (attempt + 1)));
        continue;
      }
      break;
    }
    if (!pageData || pageData.code !== 0) {
      throw new Error(`get_blocks: code=${pageData?.code} msg=${pageData?.msg}`);
    }
    all.push(...(pageData.data?.items ?? []));
    if (!pageData.data?.has_more || !pageData.data.page_token) break;
    pageToken = pageData.data.page_token;
  }
  return all;
}

function renderBlocksAsMarkdown(blocks: RenderBlock[], title: string): string {
  const byId = new Map(blocks.map(b => [b.block_id, b]));
  const root = blocks.find(b => b.block_type === 1) ?? blocks[0];
  const out: string[] = [`# ${title}`, ''];
  const rendered = new Set<string>();

  function gather(b: RenderBlock): string {
    if (rendered.has(b.block_id)) return '';
    rendered.add(b.block_id);
    const parts: string[] = [];
    const own = blockText(b).trim();
    if (own) parts.push(own);
    for (const id of b.children ?? []) {
      const c = byId.get(id);
      if (c) parts.push(gather(c));
    }
    return parts.filter(Boolean).join(' ');
  }

  function emit(b: RenderBlock, depth = 0) {
    if (rendered.has(b.block_id)) return;
    rendered.add(b.block_id);
    const t = b.block_type;
    const txt = blockText(b).trim();
    let line = '';
    if (t === 1) {
      // page root, walk children
    } else if (t >= 3 && t <= 11) {
      line = `${'#'.repeat(Math.min(6, t - 2))} ${txt}`;
    } else if (t === 2) {
      line = txt;
    } else if (t === 12) {
      line = `${'  '.repeat(depth)}- ${txt}`;
    } else if (t === 13) {
      line = `${'  '.repeat(depth)}1. ${txt}`;
    } else if (t === 14) {
      line = '```\n' + txt + '\n```';
    } else if (t === 15 || t === 34) {
      line = `> ${txt}`;
    } else if (t === 22) {
      line = '---';
    } else if (t === 19) {
      line = `> [!callout]\n> ${txt}`;
    } else if (t === 27) {
      line = `[image: ${b.image?.token ?? '?'}]`;
    } else if (t === 31) {
      // table: cell ids live in table.table.cells (row-major); positions
      // come from index + column_size. Per-cell row_index/col_index fields
      // are usually empty.
      const meta = b.table ?? {};
      const cellIds = meta.cells ?? b.children ?? [];
      const cols = Math.max(1, meta.property?.column_size ?? 1);
      const rowsCount = meta.property?.row_size ?? Math.ceil(cellIds.length / cols);
      if (cellIds.length) {
        const grid: string[][] = Array.from({ length: rowsCount }, () => Array(cols).fill(''));
        cellIds.forEach((id, i) => {
          const c = byId.get(id);
          if (!c) return;
          rendered.add(c.block_id);
          const r = Math.floor(i / cols);
          const co = i % cols;
          const cellText = (c.children ?? [])
            .map(cid => byId.get(cid))
            .filter((x): x is RenderBlock => !!x)
            .map(x => gather(x))
            .filter(Boolean).join(' ');
          if (r < rowsCount && co < cols) {
            grid[r][co] = cellText.replace(/\|/g, '\\|').replace(/\n/g, ' ');
          }
        });
        const rows: string[] = [];
        for (let r = 0; r < rowsCount; r++) {
          rows.push(`| ${grid[r].join(' | ')} |`);
          if (r === 0) rows.push(`| ${grid[r].map(() => '---').join(' | ')} |`);
        }
        line = rows.join('\n');
      }
      if (line) out.push(line, '');
      return;
    } else if (txt) {
      line = txt;
    }
    if (line) out.push(line, '');
    for (const id of b.children ?? []) {
      const child = byId.get(id);
      if (child) emit(child, (t === 12 || t === 13) ? depth + 1 : depth);
    }
  }
  emit(root);
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

async function fetchDocAsMarkdown(token: string, docToken: string, title: string): Promise<string> {
  const blocks = await fetchAllBlocks(token, docToken);
  return renderBlocksAsMarkdown(blocks, title);
}

function safeName(s: string): string {
  // kebab-case: lowercase, alphanumerics + hyphens only.
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'untitled';
}

const CATEGORIES = [
  'PRDs',
  'AB Reports',
  'Tech Designs',
  'UATs',
  'Research Exploration',
  'Weekly Meetings',
  'Miscellaneous',
] as const;
type Category = typeof CATEGORIES[number];

/**
 * Ask Gemini which folder this doc belongs in. Returns 'Miscellaneous' on any
 * parse/quota error so a single bad classification doesn't sink the whole run.
 */
async function classifyDoc(title: string, md: string): Promise<Category> {
  const key = process.env.GOOGLE_AI_API_KEY;
  if (!key) return 'Miscellaneous';
  const modelName = process.env.GEMINI_MODEL ?? 'gemini-3.1-flash-lite';
  const ai = new GoogleGenerativeAI(key);
  const model = ai.getGenerativeModel({ model: modelName });
  const prompt = `Categorize this Lark document into EXACTLY ONE of these folders. Respond with ONLY the folder name from the list, nothing else.

Folders:
- PRDs — product requirements docs ("[PRD]", feature specs, designer/PM handoffs)
- AB Reports — A/B test analysis, experiment results, AB report write-ups
- Tech Designs — engineering / architecture / system design docs
- UATs — UAT plans, QA test plans, acceptance test write-ups
- Research Exploration — user research, exploration, opportunity sizing, market study
- Weekly Meetings — status updates, meeting notes, weekly syncs, OKRs
- Miscellaneous — anything else (admin, HR, travel, personal notes)

Title: ${title}

Content (first 6000 chars):
${md.slice(0, 6000)}

Folder name:`;
  let lastErr: Error | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await model.generateContent(prompt);
      const raw = result.response.text().trim();
      const first = raw.split('\n')[0].trim().replace(/^["'`*\-\s]+|["'`*\-\s]+$/g, '');
      const match = CATEGORIES.find(c => c.toLowerCase() === first.toLowerCase());
      return match ?? 'Miscellaneous';
    } catch (e) {
      lastErr = e as Error;
      if (attempt === 0) await new Promise(r => setTimeout(r, 1500));
    }
  }
  console.warn(`  [classify-warn] ${title.slice(0, 60)}: ${lastErr?.message?.slice(0, 200)}`);
  return 'Miscellaneous';
}

// ── main ──────────────────────────────────────────────────────────────────
async function main() {
  await loadDotEnv();
  BASE = process.env.LARK_BASE_URL ?? 'https://open.larkoffice.com';
  APP_ID = mustEnv('LARK_APP_ID');
  APP_SECRET = mustEnv('LARK_APP_SECRET');
  REFRESH = mustEnv('LARK_USER_REFRESH_TOKEN');

  const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR ?? '/Users/bytedance/Documents/Work/Documents';
  const wantedTypes = (process.env.FILE_TYPES ?? 'docx,doc')
    .split(',').map(s => s.trim()).filter(Boolean);
  const wantedSet = new Set(wantedTypes);
  const queryKeys = (process.env.QUERY_KEYS
    ?? 'a,b,c,d,e,f,g,h,i,j,k,l,m,n,o,p,q,r,s,t,u,v,w,x,y,z,0,1,2,3,4,5,6,7,8,9'
  ).split(',').map(s => s.trim()).filter(Boolean);

  console.log(`[info] refreshing user token...`);
  const { access, me, rotated } = await refreshUserToken();
  console.log(`[info] user token ok (open_id=${me || 'unknown'})`);
  if (rotated && rotated !== REFRESH) {
    await persistRefreshToken(rotated);
    console.log(`[info] refresh token rotated; .env.local updated`);
  }

  console.log(`[info] searching My Drive (${queryKeys.length} queries, owner=${me})...`);
  const all = await searchMyDocs(access, me, queryKeys);
  console.log(`[info] ${all.length} unique docs found`);

  let wanted = all.filter(f => wantedSet.has(f.type) && SUPPORTED_DOC_TYPES.has(f.type));
  console.log(`[info] ${wanted.length} fetchable, types=${wantedTypes.join(',')}`);

  const limit = Number(process.env.LIMIT ?? '0');
  if (limit > 0 && wanted.length > limit) {
    console.log(`[info] LIMIT=${limit} — capping to first ${limit}`);
    wanted = wanted.slice(0, limit);
  }

  if (!wanted.length) return;

  await mkdir(DOWNLOAD_DIR, { recursive: true });
  for (const c of CATEGORIES) await mkdir(resolve(DOWNLOAD_DIR, c), { recursive: true });

  // Build a set of doc tokens we already have on disk. Filenames end in
  // `__<token>.md` so we can recover the token without parsing the body.
  // Re-runs (daily cron, manual) skip docs whose token is already present.
  const existingTokens = new Set<string>();
  for (const c of CATEGORIES) {
    let names: string[] = [];
    try { names = await readdir(resolve(DOWNLOAD_DIR, c)); } catch { /* dir absent: skip */ }
    for (const n of names) {
      const m = n.match(/__([A-Za-z0-9]+)\.md$/);
      if (m) existingTokens.add(m[1]);
    }
  }
  if (existingTokens.size) {
    console.log(`[info] ${existingTokens.size} docs already on disk — will skip those`);
  }
  const force = process.env.FORCE === '1';

  let ok = 0, fail = 0, skipped = 0;
  const byCategory: Record<string, number> = {};
  for (const f of wanted) {
    if (!force && existingTokens.has(f.token)) {
      skipped++;
      continue;
    }
    const fname = `${safeName(f.name)}__${f.token}.md`;
    try {
      const md = await fetchDocAsMarkdown(access, f.token, f.name);
      const category = await classifyDoc(f.name, md);
      const target = resolve(DOWNLOAD_DIR, category, fname);
      await writeFile(target, md, 'utf8');
      byCategory[category] = (byCategory[category] ?? 0) + 1;
      console.log(`  [ok]   ${category}/${fname} (${Buffer.byteLength(md, 'utf8')} bytes)`);
      ok++;
    } catch (e) {
      console.error(`  [fail] ${f.name} [${f.token}] (${f.type}): ${(e as Error).message}`);
      fail++;
    }
  }
  const summary = CATEGORIES.map(c => `${c}=${byCategory[c] ?? 0}`).join(', ');
  console.log(`\n[done] ${ok} ok, ${skipped} skipped (already on disk), ${fail} failed -> ${DOWNLOAD_DIR}`);
  console.log(`[by category, new only] ${summary}`);
}

main().catch(e => { console.error('[fatal]', e); process.exit(1); });
