import { NextRequest, NextResponse } from 'next/server';
import { syncFeatureStatus } from '@/lib/meego';
import { batchFetchAvatars, refreshUserToken } from '@/lib/lark';
import { getSession, createSession, COOKIE_NAME, COOKIE_MAX_AGE } from '@/lib/session';
import { cookies } from 'next/headers';

// Cache refreshed user token in memory (avoids refreshing on every sync call during Sync All)
let cachedUserToken = '';
let cachedUserTokenExp = 0;

/** Get a fresh user access token, refreshing if needed. */
async function getFreshUserToken(): Promise<string | undefined> {
  // Return cached token if still fresh (refresh every 30 min)
  if (cachedUserToken && Date.now() < cachedUserTokenExp) return cachedUserToken;

  const session = await getSession();
  if (!session?.larkRefreshToken) return session?.larkAccessToken;

  const refreshed = await refreshUserToken(session.larkRefreshToken);
  if (!refreshed) return session.larkAccessToken;

  // Persist the new tokens in the session cookie
  try {
    const jar = await cookies();
    const newSession = await createSession({
      ...session,
      larkAccessToken: refreshed.accessToken,
      larkRefreshToken: refreshed.refreshToken,
    });
    jar.set(COOKIE_NAME, newSession, {
      httpOnly: true, sameSite: 'lax',
      maxAge: COOKIE_MAX_AGE, path: '/',
      secure: process.env.NODE_ENV === 'production',
    });
  } catch { /* cookie write may fail in some contexts */ }

  cachedUserToken = refreshed.accessToken;
  cachedUserTokenExp = Date.now() + 30 * 60 * 1000; // 30 min
  return refreshed.accessToken;
}

export async function POST(req: NextRequest) {
  const { meegoUrl } = await req.json() as { meegoUrl?: string };

  if (!meegoUrl) {
    return NextResponse.json({ error: 'meegoUrl is required' }, { status: 400 });
  }

  try {
    const userToken = await getFreshUserToken();
    const result = await syncFeatureStatus(meegoUrl, userToken);

    // Resolve POC avatars from Lark (best-effort, don't block on failure)
    let pocAvatars: Record<string, string> = {};
    try {
      if (Object.keys(result.pocEmails).length > 0) {
        pocAvatars = await batchFetchAvatars(result.pocEmails);
      }
    } catch (e) {
      console.warn('Avatar fetch failed:', e);
    }

    return NextResponse.json({ ...result, pocAvatars });
  } catch (err) {
    console.error('Meego sync error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Sync failed' },
      { status: 500 }
    );
  }
}
