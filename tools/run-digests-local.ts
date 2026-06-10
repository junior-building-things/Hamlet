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
 *   refresh  — Meego pull + transition detection + queue cards + write
 *              snapshots + slip-reason inference (mirrors the
 *              `refresh-feature-cache` cron). No cards are sent.
 *   digests  — drain queues + run scans + send cards (mirrors the
 *              per-section `digest-*` crons).
 *   all      — refresh, then digests. Default.
 *
 * Env (loaded from .env.local in repo root, same as download-lark-docs):
 *   MEEGO_USER_TOKEN          — Meego MCP access (for the refresh pull).
 *   LARK_APP_ID, LARK_APP_SECRET — bot token + card posting.
 *   LARK_USER_REFRESH_TOKEN   — PRD/AB-report image downloads in cards.
 *   OWNER_EMAIL               — @-mention filter for the unanswered scan.
 *   GOOGLE_AI_API_KEY         — must be present: several digest functions
 *                              guard on it before the LLM call, even though
 *                              inference now goes through Claude.
 *   CLAUDE_MODEL              — optional; defaults to claude-sonnet-4-6.
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

async function main(): Promise<void> {
  await loadDotEnv();
  // Route all batch LLM calls through the Claude CLI. Must be set before
  // lib/digests.ts (and its transitive lib/llm.ts) is imported.
  process.env.LLM_PROVIDER = 'claude';

  const mode = (process.argv[2] ?? 'all').toLowerCase();
  if (!['refresh', 'digests', 'all'].includes(mode)) {
    console.error(`[run-digests-local] unknown mode "${mode}" (use refresh | digests | all)`);
    process.exit(1);
  }

  const { runDailyDigests, runDigestSection } = await import('../lib/digests');
  const ts = () => new Date().toISOString();
  console.log(`[run-digests-local] ${ts()} starting mode=${mode} provider=claude model=${process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-6'}`);

  if (mode === 'refresh' || mode === 'all') {
    console.log(`[run-digests-local] ${ts()} refresh: Meego pull + transition detection + queue`);
    await runDailyDigests({ mode: 'refresh' });
  }

  if (mode === 'digests' || mode === 'all') {
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

  console.log(`[run-digests-local] ${ts()} finished mode=${mode}`);
}

main().catch(e => {
  console.error('[run-digests-local] fatal:', e);
  process.exit(1);
});
