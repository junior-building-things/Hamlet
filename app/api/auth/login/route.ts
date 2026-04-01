import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function GET(req: NextRequest) {
  const base    = process.env.LARK_BASE_URL ?? 'https://open.larkoffice.com';
  const appId   = process.env.LARK_APP_ID;
  if (!appId) return NextResponse.json({ error: 'LARK_APP_ID not configured' }, { status: 500 });

  // Build callback URL from the incoming request origin so it works on any deployment
  const origin      = new URL(req.url).origin;
  const redirectUri = `${origin}/api/auth/callback`;

  // CSRF state — store in a short-lived cookie
  const state = crypto.randomUUID();
  const jar   = await cookies();
  jar.set('oauth_state', state, { httpOnly: true, sameSite: 'lax', maxAge: 600, path: '/' });

  const params = new URLSearchParams({
    app_id:       appId,
    redirect_uri: redirectUri,
    state,
    scope:        'search:docs:read drive:drive.search:readonly contact:user.id:readonly im:chat:read im:chat.members:write_only im:message:readonly im:resource',
  });

  return NextResponse.redirect(`${base}/open-apis/authen/v1/authorize?${params}`);
}
