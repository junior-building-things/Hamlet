import { NextResponse } from 'next/server';
import { PROMPT_REGISTRY } from '@/lib/prompt-registry';
import { listOverrides } from '@/lib/prompts';

export const dynamic = 'force-dynamic';

/**
 * GET /api/prompts
 *
 * Returns the full prompt registry merged with any GCS overrides.
 * Each entry has both the default and the (possibly overridden) current text.
 */
export async function GET() {
  try {
    const overrides = await listOverrides();
    const items = PROMPT_REGISTRY.map(def => {
      const override = overrides[def.id];
      return {
        ...def,
        current: override?.content ?? def.default,
        isOverridden: Boolean(override),
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
