/**
 * Run Hamlet's daily digest pipeline locally, using the Claude CLI for all
 * LLM steps instead of the Gemini API.
 *
 * This is the local replacement for the Cloud Scheduler digest crons. It
 * sets LLM_PROVIDER=claude (which routes every batch LLM call in
 * lib/digests.ts through `claude -p` via lib/llm.ts), then runs the same
 * exported functions the Cloud Run crons run — so all the Meego sync,
 * Lark card posting, and GCS dedup logic is reused unchanged. Only the
 * model provider differs.
 *
 * Modes (argv[2]):
 *   all      — ONE full pass: pull Meego once, detect transitions/PRD
 *              changes, and send every section's card. Equals the legacy
 *              unified daily digest (`runDailyDigests({ mode: 'full' })`).
 *              Default. Much faster on a single box than refresh+digests,
 *              which would re-run the heavy scan once per scan-based
 *              section.
 *   refresh  — Meego pull + transition detection + queue cards + write
 *              snapshots + slip-reason inference (mirrors the
 *              `refresh-feature-cache` cron). No cards are sent.
 *   digests  — drain queues + run scans + send cards (mirrors the
 *              per-section `digest-*` crons). Use with `refresh` for a
 *              split schedule.
 *   watch-trigger — cheap poll (run frequently via a LaunchAgent): runs a
 *              full pass ONLY if the Cron Jobs tab queued a manual-trigger
 *              request (state.cronTriggerRequests); exits immediately
 *              otherwise. This is what makes the UI's "Trigger once" button
 *              actually fire a run on this machine.
 *
 * Cron Jobs tab control: `all`/`refresh`/`digests`/`watch-trigger` all honour
 * the master pause flags (skip the pass if either master cron is paused) and
 * write a per-cron last-run heartbeat (state.cronLastRun) so the tab shows
 * correct status. See lib/cron-registry.ts (runsLocally).
 *
 * Env (loaded from .env.local in repo root, same as download-lark-docs):
 *   MEEGO_USER_TOKEN          — Meego MCP access (for the refresh pull).
 *   LARK_APP_ID, LARK_APP_SECRET — bot token + card posting.
 *   LARK_USER_REFRESH_TOKEN   — PRD/AB-report image downloads in cards.
 *   OWNER_EMAIL               — @-mention filter for the unanswered scan.
 *   GOOGLE_AI_API_KEY         — must be present: several digest functions
 *                              guard on it before the LLM call, even though
 *                              inference now goes through Claude.
 *   CLAUDE_MODEL              — optional; defaults to claude-sonnet-5.
 *
 * GCS: reads features.json / writes DigestState via Application Default
 * Credentials when off Cloud Run — run `gcloud auth application-default
 * login` once. (See lib/gcs-state.ts.)
 *
 * Run:
 *   npx tsx tools/run-digests-local.ts all
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
// These let the Cloud Run UI control + observe this local runner with no
// network path to the Mac: pause flags / trigger requests / last-run
// heartbeats all live in the shared GCS state. See lib/cron-registry.ts
// (runsLocally) and app/api/crons/*.

/** Master local crons currently paused. Any one paused ⇒ skip the whole
 *  pass (the local `all` run is monolithic: refresh + send together). */
async function pausedMasters(): Promise<string[]> {
  const { loadDigestState } = await import('../lib/digest-state');
  const { LOCAL_MASTER_CRON_IDS } = await import('../lib/cron-registry');
  const state = await loadDigestState();
  const paused = new Set(state.cronPaused ?? []);
  return LOCAL_MASTER_CRON_IDS.filter(id => paused.has(id));
}

/** Local crons with a pending manual-trigger request from the UI. */
async function pendingTriggers(): Promise<string[]> {
  const { loadDigestState } = await import('../lib/digest-state');
  const { LOCAL_CRON_IDS } = await import('../lib/cron-registry');
  const state = await loadDigestState();
  const reqs = state.cronTriggerRequests ?? {};
  return LOCAL_CRON_IDS.filter(id => reqs[id]);
}

/**
 * Close out a local pass. When `ran`, stamp the "Last run" heartbeat for
 * every non-paused local cron (what the Cron Jobs tab shows). Always clear
 * consumed manual-trigger requests + in-flight run markers for local ids,
 * so a request doesn't loop and the sidebar's "working" marker clears.
 * Re-loads state so this layers on top of runDailyDigests's own save.
 */
async function finishLocalPass(ran: boolean): Promise<void> {
  const { loadDigestState, saveDigestState } = await import('../lib/digest-state');
  const { LOCAL_CRON_IDS } = await import('../lib/cron-registry');
  const state = await loadDigestState();
  const paused = new Set(state.cronPaused ?? []);
  const now = new Date().toISOString();
  if (ran) {
    const lastRun = { ...(state.cronLastRun ?? {}) };
    for (const id of LOCAL_CRON_IDS) if (!paused.has(id)) lastRun[id] = now;
    state.cronLastRun = lastRun;
  }
  if (state.cronTriggerRequests) {
    const next = { ...state.cronTriggerRequests };
    for (const id of LOCAL_CRON_IDS) delete next[id];
    state.cronTriggerRequests = next;
  }
  if (state.cronRuns) {
    const next = { ...state.cronRuns };
    for (const id of LOCAL_CRON_IDS) delete next[id];
    state.cronRuns = next;
  }
  await saveDigestState(state);
}

async function main(): Promise<void> {
  await loadDotEnv();
  // Route all batch LLM calls through the Claude CLI. Must be set before
  // lib/digests.ts (and its transitive lib/llm.ts) is imported.
  process.env.LLM_PROVIDER = 'claude';

  const mode = (process.argv[2] ?? 'all').toLowerCase();
  if (!['refresh', 'digests', 'all', 'watch-trigger'].includes(mode)) {
    console.error(`[run-digests-local] unknown mode "${mode}" (use refresh | digests | all | watch-trigger)`);
    process.exit(1);
  }

  const ts = () => new Date().toISOString();

  // watch-trigger: cheap poll (every ~10 min via LaunchAgent). Runs a full
  // pass ONLY when the Cron Jobs UI has queued a manual-trigger request.
  // Exits immediately otherwise, so it's safe to fire frequently.
  if (mode === 'watch-trigger') {
    const pending = await pendingTriggers();
    if (pending.length === 0) {
      console.log(`[run-digests-local] ${ts()} watch-trigger: no pending requests`);
      return;
    }
    console.log(`[run-digests-local] ${ts()} watch-trigger: pending=${pending.join(',')} — running full pass`);
    const blocked = await pausedMasters();
    if (blocked.length) {
      console.log(`[run-digests-local] ${ts()} master cron(s) paused (${blocked.join(', ')}) — clearing request without running`);
      await finishLocalPass(false);
      return;
    }
    const { runDailyDigests } = await import('../lib/digests');
    await runDailyDigests({ mode: 'full' });
    await finishLocalPass(true);
    console.log(`[run-digests-local] ${ts()} finished mode=watch-trigger`);
    return;
  }

  console.log(`[run-digests-local] ${ts()} starting mode=${mode} provider=claude model=${process.env.CLAUDE_MODEL ?? 'claude-sonnet-5'}`);

  // Master off-switch: pausing either master cron in the Crons tab stops
  // the whole local pass. Per-section pauses are honoured inside
  // runDailyDigests via shouldSendSection.
  const blocked = await pausedMasters();
  if (blocked.length) {
    console.log(`[run-digests-local] ${ts()} master cron(s) paused (${blocked.join(', ')}) — skipping pass`);
    await finishLocalPass(false);
    console.log(`[run-digests-local] ${ts()} finished mode=${mode} (skipped)`);
    return;
  }

  const { runDailyDigests, runDigestSection } = await import('../lib/digests');

  if (mode === 'all') {
    // One full pass: pull Meego once, detect, send all sections. Avoids
    // the 3× heavy-scan repeat you get from refresh + per-section drains.
    console.log(`[run-digests-local] ${ts()} full: Meego pull + detect + send all sections`);
    await runDailyDigests({ mode: 'full' });
  }

  if (mode === 'refresh') {
    console.log(`[run-digests-local] ${ts()} refresh: Meego pull + transition detection + queue`);
    await runDailyDigests({ mode: 'refresh' });
  }

  if (mode === 'digests') {
    for (const id of SECTIONS) {
      try {
        console.log(`[run-digests-local] ${ts()} section ${id} …`);
        const result = await runDigestSection(id);
        console.log(`[run-digests-local] ${ts()} section ${id} done: ${JSON.stringify(result)}`);
      } catch (e) {
        console.error(`[run-digests-local] ${ts()} section ${id} FAILED:`, e);
      }
    }
  }

  // Stamp the per-cron "Last run" heartbeat + clear any consumed trigger.
  await finishLocalPass(true);
  console.log(`[run-digests-local] ${ts()} finished mode=${mode}`);
}

main().catch(e => {
  console.error('[run-digests-local] fatal:', e);
  process.exit(1);
});
