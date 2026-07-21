/**
 * Entrypoint for Hamlet's batch digest pipeline.
 *
 * In production this is the `hamlet-digests` Cloud Run Job (built from
 * Dockerfile.job, started daily by the `hamlet-daily-digest` Cloud
 * Scheduler entry). It runs as a Job rather than behind an HTTP route
 * because a full pass takes 10-26 min — well past Cloud Scheduler's 30-min
 * HTTP ceiling and the digest routes' 600s maxDuration.
 *
 * It calls the same exported functions the HTTP crons call, so all the
 * Meego sync, Lark card posting, and GCS dedup logic is reused unchanged.
 * Every LLM step goes through lib/llm.ts (`claude -p`), same as anywhere
 * else in the app.
 *
 * The same file runs by hand for debugging — see "Run" below.
 *
 * Modes (argv[2]):
 *   all      — ONE full pass: pull Meego once, detect transitions/PRD
 *              changes, and send every section's card. Equals the legacy
 *              unified daily digest (`runDailyDigests({ mode: 'full' })`).
 *              Default (the image's CMD). Much faster than refresh+digests,
 *              which would re-run the heavy scan once per scan-based
 *              section.
 *   refresh  — Meego pull + transition detection + queue cards + write
 *              snapshots + slip-reason inference (mirrors the
 *              `refresh-feature-cache` cron). No cards are sent.
 *   digests  — drain queues + run scans + send cards (mirrors the
 *              per-section `digest-*` crons). Use with `refresh` for a
 *              split schedule.
 *   watch-trigger — cheap poll (the `hamlet-digests-trigger` Scheduler
 *              entry, every 10 min): runs a full pass ONLY if the Cron Jobs
 *              tab queued a manual-trigger request (state.cronTriggerRequests);
 *              exits immediately otherwise. This is what makes the UI's
 *              "Trigger once" button actually fire a run.
 *
 * Cron Jobs tab control: `all`/`refresh`/`digests`/`watch-trigger` all honour
 * the master pause flags (skip the pass if either master cron is paused) and
 * write a per-cron last-run heartbeat (state.cronLastRun) so the tab shows
 * correct status. See lib/cron-registry.ts (runsInJob).
 *
 * Env (set on the Job by CI, mirrored from the hamlet service; when run by
 * hand, loaded from .env.local in repo root):
 *   MEEGO_USER_TOKEN          — Meego MCP access (for the refresh pull).
 *   LARK_APP_ID, LARK_APP_SECRET — bot token + card posting.
 *   LARK_USER_REFRESH_TOKEN   — PRD/AB-report image downloads in cards.
 *   OWNER_EMAIL               — @-mention filter for the unanswered scan.
 *   CLAUDE_MODEL              — optional; overrides the per-prompt model.
 *
 * GCS: on Cloud Run the metadata server supplies the token (the Job sets
 * CLOUD_RUN_JOB, not K_SERVICE — lib/gcs-state.ts checks both). Off Cloud
 * Run it falls back to Application Default Credentials: run
 * `gcloud auth application-default login` once.
 *
 * Run by hand:
 *   npx tsx tools/run-digests.ts all
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ENV_PATH = resolve(process.cwd(), '.env.local');

async function loadDotEnv(): Promise<void> {
  if (!existsSync(ENV_PATH)) return;
  const text = await readFile(ENV_PATH, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    if (process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

// Sections to drain/scan, in the same order the crons fire them.
const SECTIONS = [
  'digest.line_review',
  'digest.ab_open',
  'digest.prd_changes',
  'digest.unanswered',
  'digest.risk',
  'digest.ab_concluded',
];

// ─── Cron Jobs tab bridge (GCS DigestState) ──────────────────────────────
// These let the Cloud Run UI control + observe the batch Job, which it
// cannot invoke directly: pause flags / trigger requests / last-run
// heartbeats all live in the shared GCS state. See lib/cron-registry.ts
// (runsInJob) and app/api/crons/*.

/** Master crons currently paused. Any one paused ⇒ skip the whole pass
 *  (the `all` run is monolithic: refresh + send together). */
async function pausedMasters(): Promise<string[]> {
  const { loadDigestState } = await import('../lib/digest-state');
  const { JOB_MASTER_CRON_IDS } = await import('../lib/cron-registry');
  const state = await loadDigestState();
  const paused = new Set(state.cronPaused ?? []);
  return JOB_MASTER_CRON_IDS.filter(id => paused.has(id));
}

/** Batch crons with a pending manual-trigger request from the UI. */
async function pendingTriggers(): Promise<string[]> {
  const { loadDigestState } = await import('../lib/digest-state');
  const { JOB_CRON_IDS } = await import('../lib/cron-registry');
  const state = await loadDigestState();
  const reqs = state.cronTriggerRequests ?? {};
  return JOB_CRON_IDS.filter(id => reqs[id]);
}

/**
 * Close out a batch pass. When `ran`, stamp the "Last run" heartbeat for
 * every non-paused batch cron (what the Cron Jobs tab shows). Always clear
 * consumed manual-trigger requests + in-flight run markers for those ids,
 * so a request doesn't loop and the sidebar's "working" marker clears.
 * Re-loads state so this layers on top of runDailyDigests's own save.
 */
/**
 * Claim the single-pass lease, or log why we're standing down.
 * `CLOUD_RUN_EXECUTION` is recorded so an in-flight pass is traceable.
 */
async function claimPass(): Promise<boolean> {
  const { acquireDigestPassLease } = await import('../lib/digest-state');
  const ok = await acquireDigestPassLease(process.env.CLOUD_RUN_EXECUTION);
  if (!ok) {
    console.log(`[run-digests] ${new Date().toISOString()} another pass is already in flight — standing down`);
  }
  return ok;
}

async function releasePass(): Promise<void> {
  const { releaseDigestPassLease } = await import('../lib/digest-state');
  await releaseDigestPassLease();
}

async function finishPass(ran: boolean): Promise<void> {
  const { loadDigestState, saveDigestState } = await import('../lib/digest-state');
  const { JOB_CRON_IDS } = await import('../lib/cron-registry');
  const state = await loadDigestState();
  const paused = new Set(state.cronPaused ?? []);
  const now = new Date().toISOString();
  if (ran) {
    const lastRun = { ...(state.cronLastRun ?? {}) };
    for (const id of JOB_CRON_IDS) if (!paused.has(id)) lastRun[id] = now;
    state.cronLastRun = lastRun;
  }
  if (state.cronTriggerRequests) {
    const next = { ...state.cronTriggerRequests };
    for (const id of JOB_CRON_IDS) delete next[id];
    state.cronTriggerRequests = next;
  }
  if (state.cronRuns) {
    const next = { ...state.cronRuns };
    for (const id of JOB_CRON_IDS) delete next[id];
    state.cronRuns = next;
  }
  await saveDigestState(state);
}

async function main(): Promise<void> {
  await loadDotEnv();

  const mode = (process.argv[2] ?? 'all').toLowerCase();
  if (!['refresh', 'digests', 'all', 'watch-trigger'].includes(mode)) {
    console.error(`[run-digests] unknown mode "${mode}" (use refresh | digests | all | watch-trigger)`);
    process.exit(1);
  }

  const ts = () => new Date().toISOString();

  // watch-trigger: cheap poll (every ~10 min via Cloud Scheduler). Runs a full
  // pass ONLY when the Cron Jobs UI has queued a manual-trigger request.
  // Exits immediately otherwise, so it's safe to fire frequently.
  if (mode === 'watch-trigger') {
    const pending = await pendingTriggers();
    if (pending.length === 0) {
      console.log(`[run-digests] ${ts()} watch-trigger: no pending requests`);
      return;
    }
    console.log(`[run-digests] ${ts()} watch-trigger: pending=${pending.join(',')} — running full pass`);
    const blocked = await pausedMasters();
    if (blocked.length) {
      console.log(`[run-digests] ${ts()} master cron(s) paused (${blocked.join(', ')}) — clearing request without running`);
      await finishPass(false);
      return;
    }
    // A pass outlives the 10-min poll interval, and the request isn't
    // cleared until it finishes — so without this the next poll would start
    // a duplicate pass on top of this one. Leave the request in place when
    // standing down: the pass already running will clear it.
    if (!(await claimPass())) return;
    try {
      const { runDailyDigests } = await import('../lib/digests');
      await runDailyDigests({ mode: 'full' });
      await finishPass(true);
    } finally {
      await releasePass();
    }
    console.log(`[run-digests] ${ts()} finished mode=watch-trigger`);
    return;
  }

  console.log(`[run-digests] ${ts()} starting mode=${mode} provider=claude model=${process.env.CLAUDE_MODEL ?? 'claude-sonnet-5'}`);

  // Master off-switch: pausing either master cron in the Crons tab stops
  // the whole batch pass. Per-section pauses are honoured inside
  // runDailyDigests via shouldSendSection.
  const blocked = await pausedMasters();
  if (blocked.length) {
    console.log(`[run-digests] ${ts()} master cron(s) paused (${blocked.join(', ')}) — skipping pass`);
    await finishPass(false);
    console.log(`[run-digests] ${ts()} finished mode=${mode} (skipped)`);
    return;
  }

  // Same single-pass guard as watch-trigger: the scheduled run must not
  // pile on top of a manual pass that's still going (or vice versa).
  if (!(await claimPass())) return;

  try {
    const { runDailyDigests, runDigestSection } = await import('../lib/digests');

    if (mode === 'all') {
      // One full pass: pull Meego once, detect, send all sections. Avoids
      // the 3× heavy-scan repeat you get from refresh + per-section drains.
      console.log(`[run-digests] ${ts()} full: Meego pull + detect + send all sections`);
      await runDailyDigests({ mode: 'full' });
    }

    if (mode === 'refresh') {
      console.log(`[run-digests] ${ts()} refresh: Meego pull + transition detection + queue`);
      await runDailyDigests({ mode: 'refresh' });
    }

    if (mode === 'digests') {
      for (const id of SECTIONS) {
        try {
          console.log(`[run-digests] ${ts()} section ${id} …`);
          const result = await runDigestSection(id);
          console.log(`[run-digests] ${ts()} section ${id} done: ${JSON.stringify(result)}`);
        } catch (e) {
          console.error(`[run-digests] ${ts()} section ${id} FAILED:`, e);
        }
      }
    }

    // Stamp the per-cron "Last run" heartbeat + clear any consumed trigger.
    await finishPass(true);
  } finally {
    await releasePass();
  }
  console.log(`[run-digests] ${ts()} finished mode=${mode}`);
}

main().catch(e => {
  console.error('[run-digests] fatal:', e);
  process.exit(1);
});
