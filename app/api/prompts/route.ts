import { NextResponse } from 'next/server';
import { PROMPT_REGISTRY } from '@/lib/prompt-registry';
import { listOverrides } from '@/lib/prompts';

export const dynamic = 'force-dynamic';

/**
 * GET /api/prompts
 *
 * Returns the full prompt registry merged with any GCS overrides.
 * Each entry exposes both the registry default and the (possibly
 * overridden) current value for both the prompt text and the thinking
 * budget. `isOverridden` is true if EITHER field is overridden.
 */
export async function GET() {
  try {
    const overrides = await listOverrides();
    const items = PROMPT_REGISTRY.map(def => {
      const override = overrides[def.id];
      const defaultThinkingBudget = def.defaultThinkingBudget ?? 'dynamic';
      return {
        ...def,
        defaultThinkingBudget,
        defaultModel: def.model,
        current: override?.content ?? def.default,
        currentThinkingBudget: override?.thinkingBudget ?? defaultThinkingBudget,
        currentModel: override?.model ?? def.model,
        isOverridden: Boolean(
          override?.content !== undefined ||
          override?.thinkingBudget !== undefined ||
          override?.model !== undefined,
        ),
        updatedAt: override?.updatedAt ?? null,
        updatedBy: override?.updatedBy ?? null,
      };
    });
    return NextResponse.json({ prompts: items });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load prompts' },
      { status: 500 },
    );
  }
}
