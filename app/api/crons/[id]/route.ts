import { NextRequest, NextResponse } from 'next/server';
import { getCronById } from '@/lib/cron-registry';
import { loadDigestState, saveDigestState } from '@/lib/digest-state';
import { patchSchedulerJobSchedule } from '@/lib/cloud-scheduler';
import { buildCronExpression } from '@/lib/cron-expr';

export const dynamic = 'force-dynamic';

/** PUT — accepts:
 *    { paused?: boolean }                          — toggle pause flag
 *    { scheduleTime?: string, scheduleFrequency?: string } — repoint
 *      Cloud Scheduler. Only valid for kind='cloud_scheduler' jobs.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const def = getCronById(id);
  if (!def) return NextResponse.json({ error: 'unknown cron' }, { status: 404 });
  try {
    const body = await req.json() as {
      paused?: boolean;
      scheduleTime?: string;
      scheduleFrequency?: string;
    };

    // Schedule update path.
    if (body.scheduleTime !== undefined || body.scheduleFrequency !== undefined) {
      if (def.runsInJob) {
        return NextResponse.json(
          { error: 'This runs as one section of the hamlet-digests batch pass, so it has no schedule of its own. Change the timing on the hamlet-daily-digest Cloud Scheduler job instead.' },
          { status: 400 },
        );
      }
      if (def.kind !== 'cloud_scheduler' || !def.cloudSchedulerJobId) {
        return NextResponse.json({ error: 'schedule edit only supported on cloud_scheduler jobs' }, { status: 400 });
      }
      const time = body.scheduleTime ?? def.scheduleTime;
      const freq = body.scheduleFrequency ?? def.scheduleFrequency;
      const cron = buildCronExpression(time, freq);
      const result = await patchSchedulerJobSchedule(def.cloudSchedulerJobId, cron);
      if (!result.ok) {
        return NextResponse.json({ error: `Cloud Scheduler patch failed: ${result.status ?? ''} ${result.error ?? ''}` }, { status: 500 });
      }
      return NextResponse.json({ ok: true, id, schedule: cron, scheduleTime: time, scheduleFrequency: freq });
    }

    // Pause toggle path (default).
    const paused = !!body.paused;
    const state = await loadDigestState();
    const set = new Set(state.cronPaused ?? []);
    if (paused) set.add(id);
    else set.delete(id);
    state.cronPaused = [...set];
    await saveDigestState(state);
    return NextResponse.json({ ok: true, id, paused });
  } catch (e) {
    console.warn('[crons] update failed:', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'update failed' }, { status: 500 });
  }
}
