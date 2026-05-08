import { NextRequest, NextResponse } from 'next/server';
import { refreshUserToken } from '@/lib/lark';
import { loadDigestState, saveDigestState } from '@/lib/digest-state';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const AGENT_RUN_SECRET = process.env.AGENT_RUN_SECRET;
const LARK_BASE_URL = process.env.LARK_BASE_URL ?? 'https://open.larkoffice.com';

/**
 * One-off: turn a markdown blob into a Lark docx via the import_tasks
 * API. Steps:
 *   1. Refresh user access token (Thomas's; the doc gets owned by him).
 *   2. Upload the markdown bytes to a temporary import slot
 *      (parent_type = ccm_import_open) → returns file_token.
 *   3. Kick off an import task converting md → docx, mounted in My Space
 *      (root) or a specified folder.
 *   4. Poll the task's status until success/failure.
 *   5. Return the resulting docx token + URL.
 *
 * POST body:
 *   {
 *     markdown: string,        // raw md file content
 *     title: string,           // doc title (file name stem)
 *     folderToken?: string,    // optional — empty = My Space root
 *   }
 */
export async function POST(req: NextRequest) {
  if (AGENT_RUN_SECRET) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${AGENT_RUN_SECRET}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }
  let body: { markdown?: string; title?: string; folderToken?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }
  const markdown = String(body.markdown ?? '');
  const title = String(body.title ?? '').trim();
  const folderToken = String(body.folderToken ?? '');
  if (!markdown || !title) {
    return NextResponse.json({ error: 'markdown + title required' }, { status: 400 });
  }

  // Refresh user access token. Doc creation needs a user identity — bot
  // tokens can't create owned-by-user docs that show up in the UI.
  let userToken = '';
  try {
    const state = await loadDigestState();
    const refresh = state.larkUserRefreshToken || process.env.LARK_USER_REFRESH_TOKEN;
    if (!refresh) {
      return NextResponse.json({ error: 'no LARK_USER_REFRESH_TOKEN' }, { status: 500 });
    }
    const result = await refreshUserToken(refresh);
    if (!result) {
      return NextResponse.json({ error: 'user token refresh failed' }, { status: 500 });
    }
    userToken = result.accessToken;
    state.larkUserRefreshToken = result.refreshToken;
    await saveDigestState(state);
  } catch (e) {
    return NextResponse.json({ error: `token refresh threw: ${e instanceof Error ? e.message : e}` }, { status: 500 });
  }

  // Step 1 — upload the markdown bytes to the import slot.
  let fileToken = '';
  try {
    const fileBytes = new TextEncoder().encode(markdown);
    const fileName = `${title}.md`;
    const form = new FormData();
    form.append('file_name', fileName);
    form.append('parent_type', 'ccm_import_open');
    form.append('parent_node', 'ccm_import_open');
    form.append('size', String(fileBytes.length));
    form.append('extra', JSON.stringify({ obj_type: 'docx', file_extension: 'md' }));
    form.append('file', new Blob([fileBytes], { type: 'text/markdown' }), fileName);

    const r = await fetch(`${LARK_BASE_URL}/open-apis/drive/v1/medias/upload_all`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${userToken}` },
      body: form,
    });
    const d = await r.json() as { code: number; msg?: string; data?: { file_token?: string } };
    if (d.code !== 0 || !d.data?.file_token) {
      return NextResponse.json({ step: 'upload', code: d.code, msg: d.msg }, { status: 500 });
    }
    fileToken = d.data.file_token;
  } catch (e) {
    return NextResponse.json({ step: 'upload', error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }

  // Step 2 — kick off the import task.
  let ticket = '';
  try {
    const point = folderToken
      ? { mount_type: 1, mount_key: folderToken }
      : { mount_type: 1, mount_key: '' };
    const r = await fetch(`${LARK_BASE_URL}/open-apis/drive/v1/import_tasks`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${userToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file_extension: 'md',
        file_token: fileToken,
        type: 'docx',
        file_name: title,
        point,
      }),
    });
    const d = await r.json() as { code: number; msg?: string; data?: { ticket?: string } };
    if (d.code !== 0 || !d.data?.ticket) {
      return NextResponse.json({ step: 'import_create', code: d.code, msg: d.msg }, { status: 500 });
    }
    ticket = d.data.ticket;
  } catch (e) {
    return NextResponse.json({ step: 'import_create', error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }

  // Step 3 — poll. Lark import status:
  //   0 = success, 1 = pending, 2 = error, 3 = file format unsupported, ...
  let docToken = '';
  let docUrl = '';
  let lastStatus: number | undefined;
  let lastMsg = '';
  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise(r => setTimeout(r, 1500));
    try {
      const r = await fetch(`${LARK_BASE_URL}/open-apis/drive/v1/import_tasks/${ticket}`, {
        headers: { Authorization: `Bearer ${userToken}` },
      });
      const d = await r.json() as {
        code: number;
        msg?: string;
        data?: {
          result?: {
            job_status?: number;
            job_error_msg?: string;
            token?: string;
            url?: string;
            type?: string;
          };
        };
      };
      if (d.code !== 0) {
        lastMsg = d.msg ?? '';
        continue;
      }
      const result = d.data?.result;
      lastStatus = result?.job_status;
      lastMsg = result?.job_error_msg ?? '';
      if (result?.job_status === 0 && result.token) {
        docToken = result.token;
        docUrl = result.url ?? '';
        break;
      }
      if (typeof result?.job_status === 'number' && result.job_status > 1) {
        // Terminal failure (anything > 1 in Lark's import status enum)
        return NextResponse.json({
          step: 'import_poll',
          jobStatus: result.job_status,
          msg: result.job_error_msg ?? '',
        }, { status: 500 });
      }
    } catch (e) {
      lastMsg = e instanceof Error ? e.message : String(e);
    }
  }
  if (!docToken) {
    return NextResponse.json({
      step: 'import_poll_timeout',
      lastStatus,
      lastMsg,
    }, { status: 504 });
  }

  return NextResponse.json({
    ok: true,
    docToken,
    url: docUrl || `${LARK_BASE_URL.includes('larkoffice') ? 'https://bytedance.larkoffice.com' : 'https://lark.com'}/docx/${docToken}`,
  });
}
