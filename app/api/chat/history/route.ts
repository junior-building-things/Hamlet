import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getHistory, appendMessages, ChatMsg } from '@/lib/chatHistory';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ messages: [] }, { status: 401 });
  return NextResponse.json({ messages: getHistory(session.userId) });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { messages } = await req.json() as { messages: ChatMsg[] };
  if (Array.isArray(messages)) appendMessages(session.userId, messages);
  return NextResponse.json({ ok: true });
}
