import { NextRequest, NextResponse } from 'next/server';
import { getLarkBotToken, readChatMessages } from '@/lib/lark';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Diagnostic endpoint: GET /api/debug/probe-chat?chat=oc_xxx
 * Returns Lark message counts for the given chat across multiple
 * time windows so we can tell whether "0 messages in 24h" is a
 * permission/membership issue or just genuinely empty.
 */
export async function GET(req: NextRequest) {
  const chatId = req.nextUrl.searchParams.get('chat');
  if (!chatId) return NextResponse.json({ error: 'chat param required' }, { status: 400 });

  const token = await getLarkBotToken();
  if (!token) return NextResponse.json({ error: 'no bot token' }, { status: 500 });

  const out: Record<string, unknown> = { chatId };
  for (const days of [1, 7, 30, 90]) {
    const sinceMs = Date.now() - days * 86400_000;
    try {
      const messages = await readChatMessages(chatId, sinceMs, token, { includeThreadReplies: false });
      const newest = messages[0];
      out[`${days}d`] = {
        count: messages.length,
        newest: newest ? {
          createTimeIso: new Date(Number(newest.create_time ?? 0) * 1000).toISOString(),
          msgType: newest.msg_type,
          mentions: newest.mentions?.length ?? 0,
        } : null,
      };
    } catch (e) {
      out[`${days}d`] = { error: e instanceof Error ? e.message : String(e) };
    }
  }
  return NextResponse.json(out);
}
