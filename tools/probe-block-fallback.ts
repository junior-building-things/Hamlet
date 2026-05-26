/**
 * Probe: read one failing Lark doc via /docx/v1/documents/{id}/blocks
 * (paginated) and render to markdown ourselves. No export_tasks call, no
 * markitdown. Used to validate the fallback path for docs that Lark's
 * export pipeline silently refuses with `status=2`.
 *
 * Output: /tmp/lark-fallback-probe/<safeName>__<token>.md
 *
 * Usage:  DOC_TOKEN=<docId> npx tsx tools/probe-block-fallback.ts
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const ENV = '/Users/bytedance/Documents/Work/Coding/Hamlet/.env.local';
for (const line of readFileSync(ENV, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}
const BASE = 'https://open.larkoffice.com';
const DOC_TOKEN = process.env.DOC_TOKEN || 'doxlgMw55aOrFrWiqauykGw0lze';

interface BlockElement {
  text_run?: { content?: string };
  equation?: { content?: string };
}
interface Container { elements?: BlockElement[] }
interface Block {
  block_id: string;
  block_type: number;
  children?: string[];
  table_cell?: { row_index?: number; col_index?: number };
  image?: { token?: string };
  [key: string]: unknown;
}

const TEXT_KEYS = [
  'text','heading1','heading2','heading3','heading4','heading5',
  'heading6','heading7','heading8','heading9',
  'bullet','ordered','code','quote','todo','callout',
];

function blockText(b: Block): string {
  for (const k of TEXT_KEYS) {
    const c = b[k] as Container | undefined;
    if (c?.elements?.length) {
      return c.elements.map(e => e.text_run?.content ?? e.equation?.content ?? '').join('');
    }
  }
  return '';
}

async function main() {
  // user token
  const a = await (await fetch(`${BASE}/open-apis/auth/v3/app_access_token/internal`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: process.env.LARK_APP_ID, app_secret: process.env.LARK_APP_SECRET }),
  })).json() as { app_access_token: string };
  const u = await (await fetch(`${BASE}/open-apis/authen/v1/refresh_access_token`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_access_token: a.app_access_token, grant_type: 'refresh_token', refresh_token: process.env.LARK_USER_REFRESH_TOKEN }),
  })).json() as { data?: { access_token?: string; refresh_token?: string } };
  if (!u.data?.access_token) { console.error('refresh failed:', u); process.exit(1); }
  const tok = u.data.access_token;
  writeFileSync(ENV, readFileSync(ENV, 'utf8').replace(/^LARK_USER_REFRESH_TOKEN=.*$/m, `LARK_USER_REFRESH_TOKEN=${u.data.refresh_token}`));

  const meta = await (await fetch(`${BASE}/open-apis/docx/v1/documents/${DOC_TOKEN}`, { headers: { Authorization: `Bearer ${tok}` } })).json() as { data?: { document?: { title?: string } } };
  const title = meta.data?.document?.title ?? 'untitled';
  console.log('title:', title);

  // paginated blocks
  const blocks: Block[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(`${BASE}/open-apis/docx/v1/documents/${DOC_TOKEN}/blocks`);
    url.searchParams.set('page_size', '500');
    url.searchParams.set('document_revision_id', '-1');
    if (pageToken) url.searchParams.set('page_token', pageToken);
    const r = await fetch(url, { headers: { Authorization: `Bearer ${tok}` } });
    const j = await r.json() as { code: number; msg?: string; data?: { items?: Block[]; has_more?: boolean; page_token?: string } };
    if (j.code !== 0) { console.error('blocks fail:', j); process.exit(2); }
    blocks.push(...(j.data?.items ?? []));
    pageToken = j.data?.has_more ? j.data.page_token : undefined;
  } while (pageToken);
  console.log(`fetched ${blocks.length} blocks`);

  const byId = new Map(blocks.map(b => [b.block_id, b]));
  const root = blocks.find(b => b.block_type === 1) ?? blocks[0];

  // DEBUG: dump first table + first cell + first cell-child
  if (process.env.DEBUG_TABLE) {
    const firstTable = blocks.find(b => b.block_type === 31);
    if (firstTable) {
      console.log('[debug-table] table block keys:', Object.keys(firstTable).join(','));
      console.log('[debug-table] table.table:', JSON.stringify(firstTable.table, null, 2));
      console.log('[debug-table] children count:', (firstTable.children ?? []).length);
      const firstCellId = firstTable.children?.[0];
      const firstCell = firstCellId ? byId.get(firstCellId) : undefined;
      if (firstCell) {
        console.log('[debug-table] first cell:', JSON.stringify(firstCell, null, 2).slice(0, 600));
        const firstChildId = firstCell.children?.[0];
        const firstChild = firstChildId ? byId.get(firstChildId) : undefined;
        if (firstChild) {
          console.log('[debug-table] first cell child:', JSON.stringify(firstChild, null, 2).slice(0, 600));
        } else {
          console.log('[debug-table] first cell has NO children');
        }
      }
    }
  }

  // ── DEBUG: which block types appear, and how many are unreachable via the tree walk ──
  const typeCounts = new Map<number, number>();
  for (const b of blocks) typeCounts.set(b.block_type, (typeCounts.get(b.block_type) ?? 0) + 1);
  console.log('[debug] block type histogram:', [...typeCounts.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t}:${n}`).join(' '));

  const visited = new Set<string>();
  (function walk(b: Block) {
    if (visited.has(b.block_id)) return;
    visited.add(b.block_id);
    for (const id of b.children ?? []) { const c = byId.get(id); if (c) walk(c); }
  })(root);
  const unreached = blocks.filter(b => !visited.has(b.block_id));
  console.log(`[debug] reached via tree: ${visited.size}/${blocks.length}; unreached: ${unreached.length}`);
  if (unreached.length) {
    // Group unreached by parent's type — to identify which container is dropping them
    const sampleTexts = unreached.slice(0, 5).map(b => `(t=${b.block_type}) ${blockText(b).slice(0, 60)}`);
    console.log('[debug] first 5 unreached block samples:\n  ' + sampleTexts.join('\n  '));
  }

  // Also produce a FLAT dump (every block in returned order) as a sanity-check companion file.
  const flatLines: string[] = [`# ${title}`, ''];
  for (const b of blocks) {
    const t = b.block_type;
    const txt = blockText(b).trim();
    if (!txt) continue;
    if (t >= 3 && t <= 11) flatLines.push(`${'#'.repeat(Math.min(6, t - 2))} ${txt}`, '');
    else flatLines.push(txt, '');
  }
  const flatMd = flatLines.join('\n').replace(/\n{3,}/g, '\n\n');
  mkdirSync('/tmp/lark-fallback-probe', { recursive: true });
  const safeStub = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
  writeFileSync(`/tmp/lark-fallback-probe/${safeStub}__${DOC_TOKEN}.flat.md`, flatMd, 'utf8');
  console.log(`[debug] wrote FLAT companion (${Buffer.byteLength(flatMd, 'utf8')} bytes)`);

  const out: string[] = [`# ${title}`, ''];

  // Mark any block whose content we've already emitted as part of an
  // enclosing table cell, so the outer walk doesn't double-emit it.
  const rendered = new Set<string>();

  // Recursively gather all text from a subtree (used to flatten a table cell
  // that may itself contain headings, paragraphs, bullets, sub-tables, etc.).
  function gatherSubtreeText(b: Block, mark: boolean): string {
    if (rendered.has(b.block_id)) return '';
    if (mark) rendered.add(b.block_id);
    const parts: string[] = [];
    const own = blockText(b).trim();
    if (own) parts.push(own);
    for (const id of b.children ?? []) {
      const c = byId.get(id);
      if (c) parts.push(gatherSubtreeText(c, mark));
    }
    return parts.filter(Boolean).join(' ');
  }

  function emit(b: Block, depth = 0) {
    if (rendered.has(b.block_id)) return;
    rendered.add(b.block_id);
    const t = b.block_type;
    const txt = blockText(b).trim();
    let line = '';
    if (t === 1) {
      // page root, walk children
    } else if (t >= 3 && t <= 11) {
      const lvl = Math.min(6, t - 2);
      line = `${'#'.repeat(lvl)} ${txt}`;
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
      // table — Lark stores cells as a flat row-major array in
      // `table.table.cells` with `property.row_size` × `property.column_size`.
      // The per-cell `table_cell.row_index/col_index` fields are empty in
      // practice, so we compute position from the cell's index in the list.
      const tableMeta = (b.table ?? {}) as {
        cells?: string[];
        property?: { row_size?: number; column_size?: number };
      };
      const cellIds = tableMeta.cells ?? b.children ?? [];
      const cols = Math.max(1, tableMeta.property?.column_size ?? 1);
      const rowsCount = tableMeta.property?.row_size ?? Math.ceil(cellIds.length / cols);
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
            .filter((x): x is Block => !!x)
            .map(x => gatherSubtreeText(x, true))
            .filter(Boolean)
            .join(' ');
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
      return; // skip recursion: table subtree is fully covered by rendered marks
    } else if (txt) {
      line = txt + ` <!-- block_type=${t} -->`;
    }
    if (line) out.push(line, '');
    for (const id of b.children ?? []) {
      const child = byId.get(id);
      if (child) emit(child, (t === 12 || t === 13) ? depth + 1 : depth);
    }
  }
  emit(root);
  const md = out.join('\n').replace(/\n{3,}/g, '\n\n');

  mkdirSync('/tmp/lark-fallback-probe', { recursive: true });
  const safe = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
  const outPath = `/tmp/lark-fallback-probe/${safe}__${DOC_TOKEN}.md`;
  writeFileSync(outPath, md, 'utf8');
  console.log(`wrote ${outPath} (${Buffer.byteLength(md, 'utf8')} bytes)`);
}

main().catch(e => { console.error(e); process.exit(1); });
