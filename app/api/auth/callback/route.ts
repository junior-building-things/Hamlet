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

  // Exchange code for user access token
  const tokenRes = await fetch(`${base}/open-apis/authen/v1/oidc/access_token`, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Basic ${Buffer.from(`${appId}:${secret}`).toString('base64')}`,
    },
    body: JSON.stringify({ grant_type: 'authorization_code', code }),
  });

  const tokenRaw = await tokenRes.text();
  console.log('Lark token response status:', tokenRes.status);
  console.log('Lark token response body:', tokenRaw);

  if (!tokenRes.ok) {
    return NextResponse.redirect(`${origin}/login?error=token_exchange`);
  }

  let tokenData: Record<string, unknown>;
  try {
    tokenData = JSON.parse(tokenRaw) as Record<string, unknown>;
  } catch {
    console.error('Lark token response is not JSON:', tokenRaw);
    return NextResponse.redirect(`${origin}/login?error=no_token`);
  }

  const accessToken =
    (tokenData.access_token as string | undefined) ??
    ((tokenData.data as Record<string, unknown> | undefined)?.access_token as string | undefined);

  if (!accessToken) {
    console.error('No access token in Lark response:', tokenData);
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

  const sessionToken = await createSession({
    userId:    u.user_id ?? u.open_id ?? 'unknown',
    name:      u.en_name ?? u.name ?? 'Unknown',
    email:     u.enterprise_email ?? u.email ?? '',
    avatarUrl: u.avatar_url ?? '',
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
