import { NextRequest, NextResponse } from 'next/server';
import { getCronById } from '@/lib/cron-registry';
import { loadDigestState, saveDigestState } from '@/lib/digest-state';

export const dynamic = 'force-dynamic';

/** PUT — toggle paused. Body: { paused: boolean }. */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const def = getCronById(id);
  if (!def) return NextResponse.json({ error: 'unknown cron' }, { status: 404 });
  try {
    const body = await req.json() as { paused?: boolean };
    const paused = !!body.paused;
    const state = await loadDigestState();
    const set = new Set(state.cronPaused ?? []);
    if (paused) set.add(id);
    else set.delete(id);
    state.cronPaused = [...set];
    await saveDigestState(state);
    return NextResponse.json({ ok: true, id, paused });
  } catch (e) {
    console.warn('[crons] toggle failed:', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'toggle failed' }, { status: 500 });
  }
}
