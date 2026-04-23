import { NextResponse } from 'next/server';
import { appendPrdChangeLog } from '@/lib/lark';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await appendPrdChangeLog(
      'https://bytedance.sg.larkoffice.com/docx/EYE9dJmWxoQ7A5xkmqhlxdAsgTN',
      [{ date: '2026-04-23', detail: 'Test entry from Hamlet', by: '@Junior' }],
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
