import { NextRequest, NextResponse } from 'next/server';
import { batchFetchAvatars, getLarkUserToken } from '@/lib/lark';
import { callMeegoMcp } from '@/lib/meego';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * POST /api/avatars/resolve
 *
 * Body: { emails: { [name]: email } }, or { userKeys: string[] } (Meego user
 * keys / usernames → avatars keyed by the key passed in)
 *
 * Returns: { avatars: { [name]: avatarUrl } } — only for the names
 * whose avatars Lark could resolve. Used by the Hamlet UI on page
 * load to backfill the AV map for people who never appeared in any
 * synced feature's `feature.avatars` payload (e.g. PMs / DAs / TPMs
 * who only show up in pocEmails). Avoids requiring a per-card sync
 * to surface their avatars in the New Feature dropdown.
 */
export async function POST(req: NextRequest) {
  let body: { emails?: Record<string, string>; userKeys?: string[] } = {};
  try { body = await req.json(); } catch { /* ignore */ }

  if (Array.isArray(body.userKeys) && body.userKeys.length > 0) {
    const keys = [...new Set(body.userKeys.filter(Boolean))];
    const avatars: Record<string, string> = {};
    for (let i = 0; i < keys.length; i += 20) { // search_user_info takes at most 20
      try {
        const raw = await callMeegoMcp('search_user_info', { project_key: '5f105019a8b9a853da64767f', user_keys: keys.slice(i, i + 20) });
        for (const u of JSON.parse(raw) as Array<{ user_key: string; username?: string; avatar_url?: string }>) {
          if (!u.avatar_url) continue;
          avatars[u.user_key] = u.avatar_url;
          if (u.username) avatars[u.username] = u.avatar_url;
        }
      } catch (e) {
        console.warn('[api/avatars/resolve] search_user_info failed:', e);
      }
    }
    return NextResponse.json({ avatars });
  }
  const emails = body.emails ?? {};
  const entries = Object.entries(emails).filter(([n, e]) => n && e);
  if (entries.length === 0) return NextResponse.json({ avatars: {} });

  // Use the PM's user token if available (broader scope than bot tenant).
  let userAccessToken: string | undefined;
  try {
    userAccessToken = await getLarkUserToken();
  } catch { /* ignore */ }

  try {
    const map = await batchFetchAvatars(Object.fromEntries(entries), userAccessToken);
    return NextResponse.json({ avatars: map });
  } catch (e) {
    console.warn('[api/avatars/resolve] failed:', e);
    return NextResponse.json({ avatars: {} }, { status: 200 });
  }
}
