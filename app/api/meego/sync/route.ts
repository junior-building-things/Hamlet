import { NextRequest, NextResponse } from 'next/server';
import { syncFeatureStatus } from '@/lib/meego';
import { batchFetchAvatars, refreshUserToken } from '@/lib/lark';
import { getSession, createSession, COOKIE_NAME, COOKIE_MAX_AGE } from '@/lib/session';
import { cookies } from 'next/headers';
import { loadDigestState, saveDigestState } from '@/lib/digest-state';

// Cache refreshed tokens in memory to avoid refreshing on every sync call
let cachedUserToken = '';
let cachedRefreshToken = '';
let cachedUserTokenExp = 0;

/** Get a fresh user access token, always refreshing proactively. */
async function getFreshUserToken(): Promise<string | undefined> {
  // Return in-memory cached token if still fresh (cache for 90 min, token lasts ~2h)
  if (cachedUserToken && Date.now() < cachedUserTokenExp) {
    return cachedUserToken;
  }

  const session = await getSession();
  // Try refresh tokens in order: in-memory cache → session cookie → GCS state.
  // The digest pipeline rotates the token and stores it in GCS, so the cookie
  // may have a stale (consumed) token after a digest run.
  const tokenSources = [
    cachedRefreshToken,
    session?.larkRefreshToken,
  ].filter(Boolean) as string[];

  // Also try the GCS state token as a last resort.
  let gcsToken: string | undefined;
  try {
    const state = await loadDigestState();
    if (state.larkUserRefreshToken) gcsToken = state.larkUserRefreshToken;
  } catch { /* ignore GCS errors */ }
  if (gcsToken) tokenSources.push(gcsToken);

  // Deduplicate (same token may appear in multiple sources).
  const uniqueTokens = [...new Set(tokenSources)];

  let refreshed: { accessToken: string; refreshToken: string } | null = null;
  for (const token of uniqueTokens) {
    refreshed = await refreshUserToken(token);
    if (refreshed) break;
  }

  if (!refreshed) {
    console.warn('[sync] token refresh failed (tried session + GCS) — skipping user-token features (re-login needed)');
    return undefined;
  }

  // Cache in memory (survives across requests within the same server process)
  cachedUserToken = refreshed.accessToken;
  cachedRefreshToken = refreshed.refreshToken;
  cachedUserTokenExp = Date.now() + 90 * 60 * 1000; // 90 min

  // Persist the new tokens in the session cookie (best-effort)
  try {
    const jar = await cookies();
    const newSession = await createSession({
      ...(session ?? { userId: '', name: '', email: '', avatarUrl: '' }),
      larkAccessToken: refreshed.accessToken,
      larkRefreshToken: refreshed.refreshToken,
    });
    jar.set(COOKIE_NAME, newSession, {
      httpOnly: true, sameSite: 'lax',
      maxAge: COOKIE_MAX_AGE, path: '/',
      secure: process.env.NODE_ENV === 'production',
    });
  } catch (e) {
    console.warn('[sync] cookie write failed (token still cached in memory):', e);
  }

  // Also persist to GCS state so the digest pipeline and future sync
  // instances can use the rotated token even after this instance dies.
  try {
    const state = await loadDigestState();
    state.larkUserRefreshToken = refreshed.refreshToken;
    await saveDigestState(state);
  } catch (e) {
    console.warn('[sync] GCS state token persist failed:', e);
  }

  return refreshed.accessToken;
}

export async function POST(req: NextRequest) {
  const { meegoUrl, chatId } = await req.json() as { meegoUrl?: string; chatId?: string };

  if (!meegoUrl) {
    return NextResponse.json({ error: 'meegoUrl is required' }, { status: 400 });
  }

  try {
    const userToken = await getFreshUserToken();
    const result = await syncFeatureStatus(meegoUrl, userToken, chatId);

    // Use Meego avatars first, then try Lark as fallback
    let pocAvatars: Record<string, string> = { ...result.meegoAvatars };
    const missingEmails: Record<string, string> = {};
    for (const [name, email] of Object.entries(result.pocEmails)) {
      if (!pocAvatars[name]) missingEmails[name] = email;
    }
    if (Object.keys(missingEmails).length > 0) {
      try {
        const larkAvatars = await batchFetchAvatars(missingEmails, userToken);
        Object.assign(pocAvatars, larkAvatars);
      } catch { /* ignore */ }
    }

    console.warn(`[sync] result for "${result.name}": status=${result.status}, libra=${result.libraUrl || '(empty)'}, abReport=${result.abReportUrl ? 'found' : 'empty'}, chatId=${result.chatId || '(none)'}`);
    return NextResponse.json({ ...result, pocAvatars });
  } catch (err) {
    console.error('Meego sync error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Sync failed' },
      { status: 500 }
    );
  }
}
