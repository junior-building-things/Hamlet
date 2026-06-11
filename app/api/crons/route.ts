import { NextResponse } from 'next/server';
import { CRON_REGISTRY } from '@/lib/cron-registry';
import { loadDigestState } from '@/lib/digest-state';
import { getSchedulerJob } from '@/lib/cloud-scheduler';
import { parseCronExpression } from '@/lib/cron-expr';

export const dynamic = 'force-dynamic';

/** GET — return the cron-job list with paused state + ACTUAL schedule
 *  fetched from Cloud Scheduler (overrides registry defaults). Sub-
 *  sections inherit their parent cron's resolved schedule. */
export async function GET() {
  try {
    const state = await loadDigestState();
    const paused = new Set(state.cronPaused ?? []);

    // Fetch live schedules for every Cloud Scheduler-kind job in
    // parallel. Map by id for sub-section inheritance. Skip runsLocally
    // jobs: their GCP job is parked PAUSED (execution moved to the Mac),
    // so its state/lastAttemptTime are meaningless here — we read pause +
    // last-run from GCS state instead.
    const cloudJobs = CRON_REGISTRY.filter(
      c => c.kind === 'cloud_scheduler' && c.cloudSchedulerJobId && !c.runsLocally,
    );
    const live = await Promise.all(
      cloudJobs.map(async c => {
        const info = await getSchedulerJob(c.cloudSchedulerJobId!);
        return { id: c.id, info };
      }),
    );
    const liveById = new Map(live.map(l => [l.id, l.info]));

    const jobs = CRON_REGISTRY.map(c => {
      // Resolve schedule + lastAttemptTime + GCP-side paused state:
      //   - cloud_scheduler: live value if available, else registry default
      //   - digest_section: parent's resolved value (sub-sections fire as part of parent run)
      let schedule = c.schedule;
      let lastAttemptTime: string | undefined;
      let gcpPaused = false;
      if (c.runsLocally) {
        // Local pass: schedule is the LaunchAgent's (registry value);
        // "Last run" is the heartbeat the Mac writes on each pass; pause
        // is the GCS flag only (the GCP job is permanently PAUSED).
        lastAttemptTime = state.cronLastRun?.[c.id];
      } else if (c.kind === 'cloud_scheduler') {
        const info = liveById.get(c.id);
        if (info?.schedule) schedule = info.schedule;
        lastAttemptTime = info?.lastAttemptTime;
        gcpPaused = info?.state === 'PAUSED';
      } else if (c.parentCronId) {
        const parentInfo = liveById.get(c.parentCronId);
        if (parentInfo?.schedule) schedule = parentInfo.schedule;
        lastAttemptTime = parentInfo?.lastAttemptTime;
      }
      const parsed = parseCronExpression(schedule);
      return {
        ...c,
        schedule,
        scheduleTime: parsed?.time ?? c.scheduleTime,
        scheduleFrequency: parsed?.frequency ?? c.scheduleFrequency,
        paused: paused.has(c.id) || gcpPaused,
        lastAttemptTime,
      };
    });
    return NextResponse.json({ jobs });
  } catch (e) {
    console.warn('[crons] list failed:', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'list failed' }, { status: 500 });
  }
}
