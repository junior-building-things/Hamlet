import { NextRequest, NextResponse } from 'next/server';
import { setPrompt, resetPrompt, getPrompt, getPromptThinkingBudget, THINKING_BUDGETS, ThinkingBudget } from '@/lib/prompts';
import { getPromptDef } from '@/lib/prompt-registry';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

interface RouteContext { params: Promise<{ id: string }> }

/**
 * GET /api/prompts/{id} — get current text + thinking budget (override or default).
 */
export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const def = getPromptDef(id);
  if (!def) return NextResponse.json({ error: 'Unknown prompt id' }, { status: 404 });
  const defaultThinkingBudget = def.defaultThinkingBudget ?? 'dynamic';
  const [current, currentThinkingBudget] = await Promise.all([
    getPrompt(id, def.default),
    getPromptThinkingBudget(id, defaultThinkingBudget),
  ]);
  return NextResponse.json({
    id,
    current,
    default: def.default,
    currentThinkingBudget,
    defaultThinkingBudget,
  });
}

/**
 * PUT /api/prompts/{id} — save an override. Body may include either or
 * both of `content` (string) and `thinkingBudget` (one of THINKING_BUDGETS).
 * Whichever is omitted is left unchanged.
 */
export async function PUT(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const def = getPromptDef(id);
  if (!def) return NextResponse.json({ error: 'Unknown prompt id' }, { status: 404 });

  const body = await req.json() as { content?: unknown; thinkingBudget?: unknown };
  const patch: { content?: string; thinkingBudget?: ThinkingBudget } = {};
  if (body.content !== undefined) {
    if (typeof body.content !== 'string') {
      return NextResponse.json({ error: 'content must be a string' }, { status: 400 });
    }
    patch.content = body.content;
  }
  if (body.thinkingBudget !== undefined) {
    if (typeof body.thinkingBudget !== 'string' || !THINKING_BUDGETS.includes(body.thinkingBudget as ThinkingBudget)) {
      return NextResponse.json({ error: `thinkingBudget must be one of: ${THINKING_BUDGETS.join(', ')}` }, { status: 400 });
    }
    patch.thinkingBudget = body.thinkingBudget as ThinkingBudget;
  }
  if (patch.content === undefined && patch.thinkingBudget === undefined) {
    return NextResponse.json({ error: 'must provide content or thinkingBudget' }, { status: 400 });
  }

  const session = await getSession();
  const updatedBy = session?.email ?? session?.name ?? 'unknown';

  await setPrompt(id, patch, updatedBy);
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
