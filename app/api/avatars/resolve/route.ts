import { NextRequest, NextResponse } from 'next/server';
import { batchFetchAvatars, refreshUserToken } from '@/lib/lark';
import { loadDigestState } from '@/lib/digest-state';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * POST /api/avatars/resolve
 *
 * Body: { emails: { [name]: email } }
 *
 * Returns: { avatars: { [name]: avatarUrl } } — only for the names
 * whose avatars Lark could resolve. Used by the Hamlet UI on page
 * load to backfill the AV map for people who never appeared in any
 * synced feature's `feature.avatars` payload (e.g. PMs / DAs / TPMs
 * who only show up in pocEmails). Avoids requiring a per-card sync
 * to surface their avatars in the New Feature dropdown.
 */
export async function POST(req: NextRequest) {
  let body: { emails?: Record<string, string> } = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const emails = body.emails ?? {};
  const entries = Object.entries(emails).filter(([n, e]) => n && e);
  if (entries.length === 0) return NextResponse.json({ avatars: {} });

  // Use the PM's user token if available (broader scope than bot tenant).
  let userAccessToken: string | undefined;
  try {
    const state = await loadDigestState();
    const refresh = state.larkUserRefreshToken || process.env.LARK_USER_REFRESH_TOKEN;
    if (refresh) {
      const result = await refreshUserToken(refresh);
      if (result) userAccessToken = result.accessToken;
    }
  } catch { /* ignore */ }

  try {
    const map = await batchFetchAvatars(Object.fromEntries(entries), userAccessToken);
    return NextResponse.json({ avatars: map });
  } catch (e) {
    console.warn('[api/avatars/resolve] failed:', e);
    return NextResponse.json({ avatars: {} }, { status: 200 });
  }
}
