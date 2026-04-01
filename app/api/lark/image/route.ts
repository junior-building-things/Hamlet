import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';

const LARK_BASE_URL = process.env.LARK_BASE_URL ?? 'https://open.larkoffice.com';

export async function GET(req: NextRequest) {
  const imageKey = req.nextUrl.searchParams.get('imageKey');

  if (!imageKey) {
    return NextResponse.json({ error: 'imageKey required' }, { status: 400 });
  }

  // Use user access token — bot token can't download images sent by other bots
  const session = await getSession();
  const token = session?.larkAccessToken;
  if (!token) {
    return NextResponse.json({ error: 'No user token — please log in again' }, { status: 401 });
  }

  const url = `${LARK_BASE_URL}/open-apis/im/v1/images/${imageKey}`;
  console.log('[lark-image] fetching with user token:', url);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

  if (!res.ok) {
    const errText = await res.text();
    console.error('[lark-image] fetch failed:', res.status, errText.slice(0, 300));
    return NextResponse.json({ error: 'Failed to fetch image', detail: errText.slice(0, 200) }, { status: 502 });
  }

  const contentType = res.headers.get('content-type') ?? 'image/png';
  const buffer = await res.arrayBuffer();

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
