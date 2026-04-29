import { NextRequest, NextResponse } from 'next/server';
import { clearAllChatHistory, clearAllUserHistory } from '@/lib/junior-history';

export const dynamic = 'force-dynamic';

/** DELETE — wipe all stored history for the given scope. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ scope: string }> },
) {
  const { scope } = await params;
  try {
    if (scope === 'chat') {
      const r = await clearAllChatHistory();
      return NextResponse.json({ ok: true, deleted: r.deleted });
    }
    if (scope === 'user') {
      const r = await clearAllUserHistory();
      return NextResponse.json({ ok: true, deleted: r.deleted });
    }
    return NextResponse.json({ error: 'unknown scope' }, { status: 400 });
  } catch (e) {
    console.warn('[junior-history] clear failed:', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'clear failed' }, { status: 500 });
  }
}
