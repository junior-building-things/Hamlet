import { NextRequest, NextResponse } from 'next/server';
import { duplicateDoc, transferOwnership, getLarkBotToken, resolveDocIdFromUrl } from '@/lib/lark';

const SECRET = process.env.AGENT_RUN_SECRET;

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Duplicate a Lark PRD doc and transfer ownership to OWNER_EMAIL (the
 * configured PM). Auth: Bearer AGENT_RUN_SECRET.
 *
 * POST { sourceUrl: string, newName?: string }
 * Response: { ok: true, url: string, docToken: string }
 */
export async function POST(req: NextRequest) {
  if (!SECRET) return NextResponse.json({ error: 'AGENT_RUN_SECRET not configured' }, { status: 500 });
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${SECRET}`) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  try {
    const body = await req.json() as { sourceUrl?: string; newName?: string };
    const sourceUrl = String(body.sourceUrl ?? '');
    if (!sourceUrl) return NextResponse.json({ error: 'missing sourceUrl' }, { status: 400 });

    const newUrl = await duplicateDoc(sourceUrl, body.newName);
    const docToken = await resolveDocIdFromUrl(newUrl);

    try {
      const botToken = await getLarkBotToken();
      await transferOwnership(docToken, botToken);
    } catch (e) {
      console.warn('[admin/duplicate-prd] transferOwnership failed:', e);
      return NextResponse.json({ ok: true, url: newUrl, docToken, transferred: false, transferError: e instanceof Error ? e.message : String(e) });
    }

    return NextResponse.json({ ok: true, url: newUrl, docToken, transferred: true });
  } catch (e) {
    console.error('[admin/duplicate-prd] error:', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 });
  }
}
