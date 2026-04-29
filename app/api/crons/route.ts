import { NextResponse } from 'next/server';
import { CRON_REGISTRY } from '@/lib/cron-registry';
import { loadDigestState } from '@/lib/digest-state';

export const dynamic = 'force-dynamic';

/** GET — return the cron-job list with each entry's paused state. */
export async function GET() {
  try {
    const state = await loadDigestState();
    const paused = new Set(state.cronPaused ?? []);
    const jobs = CRON_REGISTRY.map(c => ({ ...c, paused: paused.has(c.id) }));
    return NextResponse.json({ jobs });
  } catch (e) {
    console.warn('[crons] list failed:', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'list failed' }, { status: 500 });
  }
}
