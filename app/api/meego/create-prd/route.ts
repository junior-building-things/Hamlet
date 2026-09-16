import { NextRequest, NextResponse } from 'next/server';
import { loadDigestState, type PendingPrd } from '@/lib/digest-state';
import { createPrdForStory } from '@/lib/prd-create';

export const maxDuration = 300;

/** Create the PRD for a just-created Meego story (see lib/prd-create.ts). */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Partial<PendingPrd> & { id?: string };
    if (!body.id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    // The create route recorded the full request; the browser may only know part of it.
    const stored = (await loadDigestState()).pendingPrds?.[body.id];
    const name = body.name?.trim() || stored?.name;
    if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
    const request: PendingPrd = {
      name,
      meegoUrl: body.meegoUrl || stored?.meegoUrl || '',
      featureDescription: body.featureDescription ?? stored?.featureDescription,
      useHalfDayPrd: body.useHalfDayPrd ?? stored?.useHalfDayPrd,
      quarterlyCycleOptionId: stored?.quarterlyCycleOptionId,
      createdAt: stored?.createdAt ?? new Date().toISOString(),
    };

    return NextResponse.json({ prd: await createPrdForStory(body.id, request) });
  } catch (err) {
    console.error('PRD create error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'PRD creation failed' },
      { status: 500 },
    );
  }
}
