import { NextResponse } from 'next/server';
import { getChatHistoryStats, getUserHistoryStats } from '@/lib/junior-history';

export const dynamic = 'force-dynamic';

/** GET — return counts of stored chat-level and user-level history. */
export async function GET() {
  try {
    const [chat, user] = await Promise.all([
      getChatHistoryStats(),
      getUserHistoryStats(),
    ]);
    return NextResponse.json({ chat, user });
  } catch (e) {
    console.warn('[junior-history] stats failed:', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'stats failed' }, { status: 500 });
  }
}
