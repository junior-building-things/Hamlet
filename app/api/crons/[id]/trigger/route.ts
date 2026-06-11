import { NextRequest, NextResponse } from 'next/server';
import { getCronById } from '@/lib/cron-registry';
import { runSchedulerJob, getSchedulerJob } from '@/lib/cloud-scheduler';
import { markCronStarted, markCronEnded } from '@/lib/cron-runs';
import { loadDigestState, saveDigestState } from '@/lib/digest-state';

export const dynamic = 'force-dynamic';
export const maxDuration = 600;

/**
 * POST — manually trigger a cron job once.
 *
 * For `cloud_scheduler` kind we ask GCP to dispatch the job via the
 * `:run` API. GCP then hits the same URL it would on a scheduled fire
 * AND records the attempt in `lastAttemptTime`, which is what the
 * Cron Jobs tab's "Last run" reads. We previously fetched the target
 * URL directly from this handler — that worked but bypassed Cloud
 * Scheduler's bookkeeping, so "Last run" never moved on manual
 * triggers.
 *
 * GCP returns as soon as it queues the dispatch; the actual handler
 * runs asynchronously. The client will see "Last run: now" on its
 * next refresh once GCP records the attempt (typically <1s).
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const def = getCronById(id);
  if (!def) return NextResponse.json({ error: 'unknown cron' }, { status: 404 });

  // runsLocally jobs execute on the owner's Mac — Cloud Run can't dispatch
  // them. Record a trigger request in GCS; the Mac's trigger-watch
  // LaunchAgent (run-digests-local.ts watch-trigger) polls for it and runs
  // the local pass, then clears the flag + writes the heartbeat.
  if (def.runsLocally) {
    try {
      const state = await loadDigestState();
      state.cronTriggerRequests = {
        ...(state.cronTriggerRequests ?? {}),
        [def.id]: new Date().toISOString(),
      };
      await saveDigestState(state);
      // Surface a "working" marker immediately so the sidebar reflects the ask.
      await markCronStarted(def.id, 'manual');
      return NextResponse.json({
        ok: true,
        note: 'Requested — your Mac will run the digest on its next trigger check (≤10 min).',
      });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'request failed' }, { status: 500 });
    }
  }

  if (def.kind !== 'cloud_scheduler' || !def.cloudSchedulerJobId) {
    return NextResponse.json({ error: 'unsupported kind' }, { status: 400 });
  }

  try {
    // Mark the run as in-flight BEFORE we ask GCP to dispatch. This
    // guarantees the JuniorStatusCard sees a "working" entry even when
    // the actual cron handler runs+completes faster than the card's
    // poll interval (the wrapped handler will overwrite this entry
    // with its own startedAt, then clear it on finish).
    await markCronStarted(def.id, 'manual');

    // Snapshot the current lastAttemptTime so we can wait for GCP to
    // record the new attempt before returning — otherwise the client's
    // refresh after onChange() may still see the old value.
    const before = await getSchedulerJob(def.cloudSchedulerJobId);
    const beforeAttempt = before?.lastAttemptTime ?? '';

    const result = await runSchedulerJob(def.cloudSchedulerJobId);
    if (!result.ok) {
      // Clean up the upfront markCronStarted entry — the actual handler
      // will never run, so its finally won't fire.
      await markCronEnded(def.id);
      return NextResponse.json(
        { error: result.error ?? 'trigger failed', status: result.status },
        { status: result.status ?? 500 },
      );
    }

    // Best-effort: poll up to 3× (1s spacing) for GCP to advance
    // lastAttemptTime. If it doesn't, we still return ok — the next
    // refresh will eventually pick it up.
    for (let i = 0; i < 3; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const after = await getSchedulerJob(def.cloudSchedulerJobId);
      if (after?.lastAttemptTime && after.lastAttemptTime !== beforeAttempt) break;
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.warn('[crons] trigger failed:', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'trigger failed' }, { status: 500 });
  }
}
