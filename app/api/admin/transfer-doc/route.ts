import { NextRequest, NextResponse } from 'next/server';
import { transferOwnership, getLarkBotToken } from '@/lib/lark';

export const dynamic = 'force-dynamic';

/**
 * One-off admin endpoint to transfer a Lark doc's ownership from the bot
 * to the configured OWNER_EMAIL. Auth: must include the AGENT_RUN_SECRET
 * as Bearer token.
 */
export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? '';
  const expected = process.env.AGENT_RUN_SECRET ?? '';
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { docToken } = await req.json() as { docToken?: string };
  if (!docToken) return NextResponse.json({ error: 'docToken required' }, { status: 400 });

  try {
    const token = await getLarkBotToken();
    await transferOwnership(docToken, token);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
