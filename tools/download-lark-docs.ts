/**
 * Download every Lark doc you own as markdown.
 *
 * Lark's export API only supports docx/pdf/xlsx/csv/base/pptx, so we
 * export docx into memory and convert to markdown locally with markitdown
 * (installed in tools/.venv-markitdown). The .docx is never written to
 * disk — only the .md.
 *
 * Env (required):
 *   LARK_APP_ID
 *   LARK_APP_SECRET
 *   LARK_USER_REFRESH_TOKEN   — from /api/auth/refresh-token after logging into Hamlet.
 *                              Auto-rotates on every run; .env.local is
 *                              updated in place.
 *
 * Env (optional):
 *   LARK_BASE_URL  (default https://open.larkoffice.com)
 *   DOWNLOAD_DIR   (default /Users/bytedance/Documents/Work/Documents)
 *   FILE_TYPES     (csv list; default "docx,doc")
 *   QUERY_KEYS     (csv list of strings to search; default = a–z + 0–9.
 *                  suite/docs-api/search/object requires a non-empty key,
 *                  so we run several searches and union by docs_token.)
 *   LIMIT          (int; cap the number of docs to download. Useful for probes.)
 *
 * Setup (one-off):
 *   python3.10+ -m venv tools/.venv-markitdown
 *   tools/.venv-markitdown/bin/pip install 'markitdown[docx]'
 *
 * A `.env.local` in repo root is auto-loaded if present.
 *
 * Run:
 *   npx tsx tools/download-lark-docs.ts
 */

import { writeFile, mkdir, readFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';

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

// type → Lark export spec. The API doesn't expose markdown directly; we
// export docx and convert via markitdown locally (see convertToMarkdown).
// sheet/bitable still go out as xlsx — markdown doesn't fit them.
const EXPORTABLE: Record<string, { type: string; ext: string }> = {
  docx:    { type: 'docx',    ext: 'docx' },
  doc:     { type: 'doc',     ext: 'docx' },
  sheet:   { type: 'sheet',   ext: 'xlsx' },
  bitable: { type: 'bitable', ext: 'xlsx' },
};

const MARKITDOWN_BIN = resolve(process.cwd(), 'tools/.venv-markitdown/bin/markitdown');

async function exportFile(
  token: string, file: DriveFile, ext: string, type: string,
): Promise<Buffer> {
  // 1) create export task
  const c = await fetch(`${BASE}/open-apis/drive/v1/export_tasks`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_extension: ext, token: file.token, type }),
  });
  const cj = await c.json() as { code: number; msg?: string; data?: { ticket?: string } };
  if (cj.code !== 0 || !cj.data?.ticket) {
    throw new Error(`export create: code=${cj.code} msg=${cj.msg}`);
  }
  const ticket = cj.data.ticket;

  // 2) poll
  let exportToken: string | undefined;
  for (let i = 0; i < 60; i++) {
    await new Promise(res => setTimeout(res, 1000));
    const p = await fetch(
      `${BASE}/open-apis/drive/v1/export_tasks/${ticket}?token=${file.token}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const pj = await p.json() as {
      code: number; msg?: string;
      data?: { result?: { job_status?: number; file_token?: string; job_error_msg?: string } };
    };
    if (pj.code !== 0) throw new Error(`export poll: code=${pj.code} msg=${pj.msg}`);
    const status = pj.data?.result?.job_status;
    // 0 = success, 1 = in_progress, >=2 = failure
    if (status === 0 && pj.data?.result?.file_token) {
      exportToken = pj.data.result.file_token;
      break;
    }
    if (status !== undefined && status >= 2) {
      throw new Error(`export failed: status=${status} body=${JSON.stringify(pj).slice(0, 400)}`);
    }
  }
  if (!exportToken) throw new Error('export poll timed out after 60s');

  // 3) download
  const dl = await fetch(
    `${BASE}/open-apis/drive/v1/export_tasks/file/${exportToken}/download`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!dl.ok) throw new Error(`download HTTP ${dl.status} ${dl.statusText}`);
  const ab = await dl.arrayBuffer();
  return Buffer.from(ab);
}

function safeName(s: string): string {
  // kebab-case: lowercase, alphanumerics + hyphens only.
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'untitled';
}


/**
 * Convert a .docx buffer to markdown using the markitdown CLI from the
 * tools/.venv-markitdown venv. Writes the docx to a temp file (markitdown
 * needs a path argument) and removes it after.
 */
async function docxToMarkdown(docx: Buffer): Promise<string> {
  const tmp = resolve(tmpdir(), `lark-${randomBytes(8).toString('hex')}.docx`);
  await writeFile(tmp, docx);
  try {
    return await new Promise<string>((res, rej) => {
      const child = spawn(MARKITDOWN_BIN, [tmp]);
      let out = '', err = '';
      child.stdout.on('data', b => { out += b.toString('utf8'); });
      child.stderr.on('data', b => { err += b.toString('utf8'); });
      child.on('error', rej);
      child.on('close', code => {
        if (code === 0) res(out);
        else rej(new Error(`markitdown exit=${code}: ${err.trim().slice(0, 300)}`));
      });
    });
  } finally {
    await unlink(tmp).catch(() => {});
  }
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

  let wanted = all.filter(f => wantedSet.has(f.type) && EXPORTABLE[f.type]);
  console.log(`[info] ${wanted.length} exportable, types=${wantedTypes.join(',')}`);

  const limit = Number(process.env.LIMIT ?? '0');
  if (limit > 0 && wanted.length > limit) {
    console.log(`[info] LIMIT=${limit} — capping to first ${limit}`);
    wanted = wanted.slice(0, limit);
  }

  if (!wanted.length) return;

  await mkdir(DOWNLOAD_DIR, { recursive: true });
  let ok = 0, fail = 0;
  for (const f of wanted) {
    const spec = EXPORTABLE[f.type];
    // docx/doc → markdown via markitdown; sheet/bitable → save xlsx as-is.
    const isDocx = spec.ext === 'docx';
    const outExt = isDocx ? 'md' : spec.ext;
    const fname = `${safeName(f.name)}__${f.token}.${outExt}`;
    const target = resolve(DOWNLOAD_DIR, fname);
    try {
      const buf = await exportFile(access, f, spec.ext, spec.type);
      if (isDocx) {
        const md = await docxToMarkdown(buf);
        await writeFile(target, md, 'utf8');
        console.log(`  [ok]   ${fname} (${Buffer.byteLength(md, 'utf8')} bytes md, from ${buf.length} bytes docx)`);
      } else {
        await writeFile(target, buf);
        console.log(`  [ok]   ${fname} (${buf.length} bytes)`);
      }
      ok++;
    } catch (e) {
      console.error(`  [fail] ${f.name} [${f.token}] (${f.type}): ${(e as Error).message}`);
      fail++;
    }
  }
  console.log(`\n[done] ${ok} ok, ${fail} failed -> ${DOWNLOAD_DIR}`);
}

main().catch(e => { console.error('[fatal]', e); process.exit(1); });
