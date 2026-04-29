import { NextRequest, NextResponse } from 'next/server';
import { writeContextFile, deleteContextFile, readContextFile } from '@/lib/junior-context';

export const dynamic = 'force-dynamic';

/** PUT — overwrite an existing context file. Body: { content }. */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  if (!name) return NextResponse.json({ error: 'missing name' }, { status: 400 });
  try {
    const body = await req.json() as { content?: string };
    const content = body.content ?? '';
    await writeContextFile(name, content);
    return NextResponse.json({ ok: true, name });
  } catch (e) {
    console.warn('[junior-context] update failed:', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'update failed' }, { status: 500 });
  }
}

/** DELETE — remove a context file. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  if (!name) return NextResponse.json({ error: 'missing name' }, { status: 400 });
  try {
    await deleteContextFile(name);
    return NextResponse.json({ ok: true, name });
  } catch (e) {
    console.warn('[junior-context] delete failed:', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'delete failed' }, { status: 500 });
  }
}

/** GET — read a single file by name (used as a fallback / debug). */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  if (!name) return NextResponse.json({ error: 'missing name' }, { status: 400 });
  try {
    const file = await readContextFile(name);
    if (!file) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json(file);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'read failed' }, { status: 500 });
  }
}
