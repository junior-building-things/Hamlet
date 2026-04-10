import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';

/**
 * One-time admin endpoint to extract the Lark refresh token from the
 * current user's session cookie. Used to bootstrap the Task 3 link-fetch
 * pipeline which needs a user_access_token for Lark Drive search.
 *
 * The token should be copied into the GCS state file's
 * `larkUserRefreshToken` field (or set as the LARK_USER_REFRESH_TOKEN env
 * var on Cloud Run). After the first successful digest run, the state file
 * stores the rotated token and the env var is no longer needed.
 *
 * This endpoint requires a valid session — log into Hamlet first.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!session.larkRefreshToken) {
    return NextResponse.json({ error: 'No larkRefreshToken in session — try logging out and back in' }, { status: 404 });
  }
  return NextResponse.json({
    larkRefreshToken: session.larkRefreshToken,
    user: session.email,
    note: 'Set this as LARK_USER_REFRESH_TOKEN env var on Cloud Run, or add it to the GCS state file under larkUserRefreshToken. After the first digest run, the rotated token is auto-persisted in state.',
  });
}
