import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createSession, COOKIE_NAME, COOKIE_MAX_AGE } from '@/lib/session';

export async function GET(req: NextRequest) {
  const base   = process.env.LARK_BASE_URL ?? 'https://open.larkoffice.com';
  const appId  = process.env.LARK_APP_ID!;
  const secret = process.env.LARK_APP_SECRET!;
  const origin = new URL(req.url).origin;

  const { searchParams } = new URL(req.url);
  const code  = searchParams.get('code');
  const state = searchParams.get('state');

  // Validate CSRF state
  const jar          = await cookies();
  const storedState  = jar.get('oauth_state')?.value;
  jar.delete('oauth_state');

  if (!code || !state || state !== storedState) {
    return NextResponse.redirect(`${origin}/login?error=invalid_state`);
  }

  // Step 1: get app_access_token
  const appTokenRes  = await fetch(`${base}/open-apis/auth/v3/app_access_token/internal`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ app_id: appId, app_secret: secret }),
  });
  const appTokenData = await appTokenRes.json() as { code: number; app_access_token?: string; msg?: string };
  console.log('app_access_token response:', appTokenData);
  if (appTokenData.code !== 0 || !appTokenData.app_access_token) {
    console.error('Failed to get app_access_token:', appTokenData);
    return NextResponse.redirect(`${origin}/login?error=token_exchange`);
  }

  // Step 2: exchange code for user access token via OIDC endpoint (supports scopes + refresh tokens)
  const tokenRes = await fetch(`${base}/open-apis/authen/v2/oidc/token`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${appTokenData.app_access_token}` },
    body:    JSON.stringify({
      grant_type: 'authorization_code',
      code,
    }),
  });
  const tokenRaw = await tokenRes.text();
  console.log('user token response status:', tokenRes.status);
  console.log('user token response body:', tokenRaw);

  let tokenData: Record<string, unknown>;
  try { tokenData = JSON.parse(tokenRaw) as Record<string, unknown>; }
  catch { return NextResponse.redirect(`${origin}/login?error=no_token`); }

  // Classic endpoint nests under data
  const inner      = (tokenData.data as Record<string, unknown> | undefined) ?? tokenData;
  const accessToken = inner.access_token as string | undefined;

  const grantedScope = inner.scope as string | undefined;
  console.log('[auth] granted scope:', grantedScope);

  if (!accessToken) {
    console.error('No access token in response:', tokenData);
    return NextResponse.redirect(`${origin}/login?error=no_token`);
  }

  // Fetch user info
  const userRes = await fetch(`${base}/open-apis/authen/v1/user_info`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!userRes.ok) {
    return NextResponse.redirect(`${origin}/login?error=user_info`);
  }

  const userData = await userRes.json() as {
    code: number;
    data?: {
      user_id?:          string;
      open_id?:          string;
      name?:             string;
      en_name?:          string;
      enterprise_email?: string;
      email?:            string;
      avatar_url?:       string;
    };
  };

  const u = userData.data;
  if (!u) {
    return NextResponse.redirect(`${origin}/login?error=no_user`);
  }

  const refreshToken = (inner.refresh_token as string | undefined) ?? '';

  const sessionToken = await createSession({
    userId:    u.user_id ?? u.open_id ?? 'unknown',
    name:      u.en_name ?? u.name ?? 'Unknown',
    email:     u.enterprise_email ?? u.email ?? '',
    avatarUrl: u.avatar_url ?? '',
    larkAccessToken:  accessToken,
    larkRefreshToken: refreshToken,
  });

  jar.set(COOKIE_NAME, sessionToken, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge:   COOKIE_MAX_AGE,
    path:     '/',
    secure:   process.env.NODE_ENV === 'production',
  });

  return NextResponse.redirect(`${origin}/`);
}
