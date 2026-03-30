import { NextRequest, NextResponse } from 'next/server';
import { syncFeatureStatus } from '@/lib/meego';
import { batchFetchAvatars } from '@/lib/lark';
import { getSession } from '@/lib/session';

export async function POST(req: NextRequest) {
  const { meegoUrl } = await req.json() as { meegoUrl?: string };

  if (!meegoUrl) {
    return NextResponse.json({ error: 'meegoUrl is required' }, { status: 400 });
  }

  try {
    const session = await getSession();
    const userToken = session?.larkAccessToken;

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
