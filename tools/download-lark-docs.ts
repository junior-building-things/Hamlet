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
 * After rendering, an LLM classifies the doc into one of:
 *   PRDs, AB Reports, Tech Designs, UATs, Research Exploration,
 *   Weekly Meetings, Miscellaneous
 * and the file lands in <DOWNLOAD_DIR>/<category>/<name>__<token>.md.
 *
 * Auth:
 *   Lark calls go through `lark-cli api ... --as user`, which uses lark-cli's
 *   logged-in user session (the same Lark app as Hamlet). lark-cli owns token
 *   storage + rotation, so this job keeps NO refresh token of its own — that
 *   removes the old failure mode where the digest pipeline (GCS store) and
 *   this job (.env.local store) shared one single-use rotating token and kept
 *   invalidating each other. Requires `lark-cli auth login` as the doc owner;
 *   `lark-cli` must be on PATH (it lives in the nvm bin — run.sh adds it).
 *
 * Classification runs through lib/llm.ts (the `claude` CLI), so it needs a
 * logged-in Claude CLI on PATH — no API key.
 *
 * Env (optional):
 *   DOWNLOAD_DIR   (default /Users/bytedance/Documents/Work/Documents)
 *   FILE_TYPES     (csv list; default "docx,doc")
 *   QUERY_KEYS     (csv list of strings to search; default = a–z + 0–9.
 *                  suite/docs-api/search/object requires a non-empty key,
 *                  so we run several searches and union by docs_token.)
 *   CLASSIFY_MODEL (default "claude-haiku-4-5")
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
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { generateText } from '../lib/llm';

const pExecFile = promisify(execFile);

// ── minimal .env.local loader ─────────────────────────────────────────────
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

// ── Lark API via lark-cli ─────────────────────────────────────────────────
// All Lark calls go through `lark-cli api ... --as user`, which injects the
// logged-in user's access token and transparently refreshes/rotates it. We
// just parse the raw Lark envelope ({code, data, msg}) lark-cli prints on
// stdout — the same shape the previous direct-fetch code consumed.
interface LarkResp<T = unknown> { code: number; msg?: string; data?: T }

async function larkApi<T = unknown>(
  method: 'GET' | 'POST',
  path: string,
  opts: { data?: unknown; params?: unknown } = {},
): Promise<LarkResp<T>> {
  const args = ['api', method, path, '--as', 'user', '--json'];
  if (opts.params !== undefined) args.push('--params', JSON.stringify(opts.params));
  if (opts.data !== undefined) args.push('--data', JSON.stringify(opts.data));

  // On a successful HTTP round-trip lark-cli prints the raw Lark envelope
  // ({code, data, msg}) on stdout — including Lark-level error codes (e.g.
  // 99991400 rate limit), which we return for the caller to handle. On its
  // OWN failures (network timeout, etc.) it exits non-zero and writes a
  // non-envelope {ok:false, error} to stderr instead — those are transient,
  // so retry with backoff before giving up.
  let lastErr = '';
  for (let attempt = 0; attempt < 4; attempt++) {
    let stdout = '';
    let stderr = '';
    try {
      ({ stdout } = await pExecFile('lark-cli', args, { maxBuffer: 256 * 1024 * 1024 }));
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string; message?: string };
      stdout = err.stdout ?? '';
      stderr = err.stderr ?? err.message ?? '';
    }
    const start = stdout.indexOf('{');
    if (start >= 0) {
      try {
        const j = JSON.parse(stdout.slice(start)) as LarkResp<T>;
        if (typeof j.code === 'number') return j;
      } catch { /* unparseable — fall through to retry */ }
    }
    lastErr = (stderr || stdout).replace(/\s+/g, ' ').trim().slice(0, 300) || 'no envelope on stdout';
    if (attempt < 3) await new Promise(r => setTimeout(r, 800 * (attempt + 1) * (attempt + 1)));
  }
  throw new Error(`lark-cli ${method} ${path} failed after retries: ${lastErr}`);
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
  ownerOpenIds: string[],
  searchKeys: string[],
): Promise<DriveFile[]> {
  const byToken = new Map<string, DriveFile>();
  for (const key of searchKeys) {
    let offset = 0;
    let total = 0;
    do {
      const j = await larkApi<{
        docs_entities?: Array<{
          docs_token: string; docs_type: string; title: string; owner_id?: string;
        }>;
        has_more?: boolean; total?: number;
      }>('POST', '/open-apis/suite/docs-api/search/object', {
        data: { search_key: key, count: 50, offset, owner_ids: ownerOpenIds },
      });
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

async function fetchAllBlocks(docToken: string): Promise<RenderBlock[]> {
  const all: RenderBlock[] = [];
  let pageToken: string | undefined;
  for (let safety = 0; safety < 30; safety++) {
    const params: Record<string, unknown> = { page_size: 500, document_revision_id: -1 };
    if (pageToken) params.page_token = pageToken;
    // Per-page retry on rate-limit (99991400)
    let pageData: LarkResp<{ items?: RenderBlock[]; has_more?: boolean; page_token?: string }> | undefined;
    for (let attempt = 0; attempt < 4; attempt++) {
      pageData = await larkApi(
        'GET', `/open-apis/docx/v1/documents/${docToken}/blocks`, { params },
      );
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

async function fetchDocAsMarkdown(docToken: string, title: string): Promise<string> {
  const blocks = await fetchAllBlocks(docToken);
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

// Teammates whose docs we additionally pull but ONLY keep when they're A/B
// reports (their PRDs / other docs are skipped). Default: Lionel Lew (DS).
// Override / extend via AB_REPORT_OWNERS (csv of open_ids).
const AB_REPORT_OWNERS = (process.env.AB_REPORT_OWNERS
  ?? 'ou_a9dc0ccf0169f3e69543cdd782a56557'   // lionel.lew@bytedance.com
).split(',').map(s => s.trim()).filter(Boolean);

// Title test for A/B *reports* (not designs): matches "[A/B Report]",
// "【Agile A/B report】", "A/B 报告", etc., but not "[A/B Design]".
function isAbReportTitle(title: string): boolean {
  return /a\s*\/?\s*b[\s_-]*report/i.test(title) || /a\s*\/?\s*b\s*报告/.test(title);
}

/**
 * Ask the model which folder this doc belongs in. Returns 'Miscellaneous' on
 * any parse/quota error so a single bad classification doesn't sink the run.
 */
async function classifyDoc(title: string, md: string): Promise<Category> {
  const modelName = process.env.CLASSIFY_MODEL ?? 'claude-haiku-4-5';
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
      const raw = (await generateText(prompt, { model: modelName, label: 'classify-doc' })).trim();
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

  const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR ?? '/Users/bytedance/Documents/Work/Documents';
  const wantedTypes = (process.env.FILE_TYPES ?? 'docx,doc')
    .split(',').map(s => s.trim()).filter(Boolean);
  const wantedSet = new Set(wantedTypes);
  const queryKeys = (process.env.QUERY_KEYS
    ?? 'a,b,c,d,e,f,g,h,i,j,k,l,m,n,o,p,q,r,s,t,u,v,w,x,y,z,0,1,2,3,4,5,6,7,8,9'
  ).split(',').map(s => s.trim()).filter(Boolean);

  // Identity + auth come from lark-cli's logged-in user session (same Lark
  // app as Hamlet). lark-cli owns token storage + rotation, so this job no
  // longer keeps its own refresh token — no GCS/.env.local token stores to
  // clobber each other. Just confirm there's a live user session.
  const who = await larkApi<{ open_id?: string; name?: string }>(
    'GET', '/open-apis/authen/v1/user_info',
  );
  if (who.code !== 0 || !who.data?.open_id) {
    console.error(
      `[fatal] no lark-cli user session (code=${who.code} msg=${who.msg}). ` +
      'Run: lark-cli auth login',
    );
    process.exit(1);
  }
  const me = who.data.open_id;
  console.log(`[info] using lark-cli user session (name=${who.data.name ?? '?'}, open_id=${me})`);

  // Owners we search: you (all categories) + AB-report owners (kept only if
  // the doc is an A/B report — see filtering below).
  const abOwners = AB_REPORT_OWNERS.filter(o => o !== me);
  const owners = [me, ...abOwners];
  console.log(`[info] searching My Drive (${queryKeys.length} queries, owners=${owners.length}` +
    `${abOwners.length ? `, +${abOwners.length} AB-report owner(s)` : ''})...`);
  const all = await searchMyDocs(owners, queryKeys);
  console.log(`[info] ${all.length} unique docs found`);

  const abOwnerSet = new Set(abOwners);
  let wanted = all.filter(f => {
    if (!wantedSet.has(f.type) || !SUPPORTED_DOC_TYPES.has(f.type)) return false;
    // Docs owned by an AB-report owner (not you) are kept only when their
    // title marks them as an A/B report — skip their PRDs / other docs.
    if (abOwnerSet.has(f.owner_id)) return isAbReportTitle(f.name);
    return true;
  });
  const abExtra = wanted.filter(f => abOwnerSet.has(f.owner_id)).length;
  console.log(`[info] ${wanted.length} fetchable, types=${wantedTypes.join(',')}` +
    `${abExtra ? ` (incl. ${abExtra} AB report(s) from other owners)` : ''}`);

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
      const md = await fetchDocAsMarkdown(f.token, f.name);
      // Extra owners' docs are already title-gated to A/B reports — file them
      // straight into AB Reports/ (no LLM call). Your docs get classified.
      const category: Category = abOwnerSet.has(f.owner_id)
        ? 'AB Reports'
        : await classifyDoc(f.name, md);
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
