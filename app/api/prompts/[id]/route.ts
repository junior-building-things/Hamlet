import { NextRequest, NextResponse } from 'next/server';
import { setPrompt, resetPrompt, getPrompt } from '@/lib/prompts';
import { getPromptDef } from '@/lib/prompt-registry';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

interface RouteContext { params: Promise<{ id: string }> }

/**
 * GET /api/prompts/{id} — get current text (override or default).
 */
export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const def = getPromptDef(id);
  if (!def) return NextResponse.json({ error: 'Unknown prompt id' }, { status: 404 });
  const current = await getPrompt(id, def.default);
  return NextResponse.json({ id, current, default: def.default });
}

/**
 * PUT /api/prompts/{id} — save an override. Body: { content: string }.
 */
export async function PUT(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const def = getPromptDef(id);
  if (!def) return NextResponse.json({ error: 'Unknown prompt id' }, { status: 404 });

  const { content } = await req.json() as { content?: string };
  if (typeof content !== 'string') {
    return NextResponse.json({ error: 'content (string) required' }, { status: 400 });
  }

  const session = await getSession();
  const updatedBy = session?.email ?? session?.name ?? 'unknown';

  await setPrompt(id, content, updatedBy);
  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/prompts/{id} — remove the override (revert to default).
 */
export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const def = getPromptDef(id);
  if (!def) return NextResponse.json({ error: 'Unknown prompt id' }, { status: 404 });
  await resetPrompt(id);
  return NextResponse.json({ ok: true });
}
