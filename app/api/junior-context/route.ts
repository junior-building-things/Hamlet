import { NextRequest, NextResponse } from 'next/server';
import { listContextFiles, writeContextFile } from '@/lib/junior-context';

export const dynamic = 'force-dynamic';

/** GET — list every context file with its full content. */
export async function GET() {
  try {
    const files = await listContextFiles();
    return NextResponse.json({ files });
  } catch (e) {
    console.warn('[junior-context] list failed:', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'list failed' }, { status: 500 });
  }
}

/** POST — create a new context file. Body: { name, content }. */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { name?: string; content?: string };
    const name = String(body.name ?? '').trim();
    const content = body.content ?? '';
    if (!name) return NextResponse.json({ error: 'missing name' }, { status: 400 });
    if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
      return NextResponse.json({ error: 'invalid filename (use a-z 0-9 . _ -)' }, { status: 400 });
    }
    if (!name.endsWith('.md')) {
      return NextResponse.json({ error: 'filename must end in .md' }, { status: 400 });
    }
    await writeContextFile(name, content);
    return NextResponse.json({ ok: true, name });
  } catch (e) {
    console.warn('[junior-context] create failed:', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'create failed' }, { status: 500 });
  }
}
