import { NextRequest, NextResponse } from 'next/server';

const LARK_BASE_URL = process.env.LARK_BASE_URL ?? 'https://open.larkoffice.com';

async function getBotToken(): Promise<string> {
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
  const imageKey = req.nextUrl.searchParams.get('imageKey');
  const messageId = req.nextUrl.searchParams.get('messageId');

  if (!imageKey) {
    return NextResponse.json({ error: 'imageKey required' }, { status: 400 });
  }

  const token = await getBotToken();

  const urls = [
    `${LARK_BASE_URL}/open-apis/im/v1/images/${imageKey}?image_type=message`,
    `${LARK_BASE_URL}/open-apis/im/v1/images/${imageKey}`,
    messageId ? `${LARK_BASE_URL}/open-apis/im/v1/messages/${messageId}/resources/${imageKey}?type=image` : '',
    // Try file download endpoint
    messageId ? `${LARK_BASE_URL}/open-apis/im/v1/messages/${messageId}/resources/${imageKey}?type=file` : '',
  ].filter(Boolean);

  let res: Response | null = null;
  for (const url of urls) {
    console.log('[lark-image] trying:', url);
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (r.ok) {
      res = r;
      console.log('[lark-image] success:', url);
      break;
    }
    const errText = await r.text();
    console.log('[lark-image] failed:', r.status, errText.slice(0, 200));
  }

  if (!res) {
    return NextResponse.json({ error: 'Failed to fetch image' }, { status: 502 });
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
