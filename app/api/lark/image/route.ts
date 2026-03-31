import { NextRequest, NextResponse } from 'next/server';

const LARK_BASE_URL = process.env.LARK_BASE_URL ?? 'https://open.larkoffice.com';

async function getAccessToken(): Promise<string> {
  const res = await fetch(`${LARK_BASE_URL}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app_id: process.env.LARK_APP_ID,
      app_secret: process.env.LARK_APP_SECRET,
    }),
  });
  const data = await res.json() as { tenant_access_token?: string };
  return data.tenant_access_token ?? '';
}

export async function GET(req: NextRequest) {
  const messageId = req.nextUrl.searchParams.get('messageId');
  const imageKey = req.nextUrl.searchParams.get('imageKey');

  if (!messageId || !imageKey) {
    return NextResponse.json({ error: 'messageId and imageKey required' }, { status: 400 });
  }

  const token = await getAccessToken();

  const res = await fetch(
    `${LARK_BASE_URL}/open-apis/im/v1/messages/${messageId}/resources/${imageKey}?type=image`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  if (!res.ok) {
    const errText = await res.text();
    console.error('[lark-image] fetch failed:', res.status, errText.slice(0, 300));
    return NextResponse.json({ error: 'Failed to fetch image', status: res.status, detail: errText.slice(0, 200) }, { status: 502 });
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
