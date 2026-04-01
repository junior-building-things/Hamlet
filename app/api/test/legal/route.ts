import { NextResponse } from 'next/server';
import { createHash } from 'crypto';

export async function GET() {
  const appId = 'hamlet-tiktok';
  const appSecret = process.env.LEGAL_APP_SECRET;
  if (!appSecret) return NextResponse.json({ error: 'LEGAL_APP_SECRET not set' });

  const timestamp = String(Date.now());
  const bizParams = JSON.stringify({ workItemIds: ['6840098152'] });
  const sign = createHash('md5').update(appSecret + timestamp + bizParams).digest('hex');

  try {
    const res = await fetch(`https://legal.bytedance.net/compliance/api/external/v1/${appId}/getByMeegoWorkItemId`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ timestamp, sign, bizParams }).toString(),
    });
    const data = await res.json();
    return NextResponse.json({ reachable: true, data });
  } catch (e) {
    return NextResponse.json({ reachable: false, error: e instanceof Error ? e.message : String(e) });
  }
}
