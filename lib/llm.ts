/**
 * Single LLM entrypoint for every text generation in Hamlet.
 *
 * All calls shell out to the `claude` CLI (`claude -p`), which authenticates
 * with the user's Claude subscription — an interactive login locally, or
 * CLAUDE_CODE_OAUTH_TOKEN in a container (Cloud Run). There is no API key
 * and no second provider: Gemini was removed so the whole app runs on one
 * subscription-backed path with no per-token billing.
 *
 * Model resolution, most specific first:
 *   opts.model (per-prompt, from the prompt registry / GCS override)
 *   → CLAUDE_MODEL env
 *   → DEFAULT_MODEL
 *
 * Non-Claude model names are ignored rather than passed through: GCS prompt
 * overrides written during the Gemini era can still hold `gemini-*` ids, and
 * handing one to `claude -p --model` would hard-fail the call.
 *
 * Every call draws on the same subscription quota. Prefer a small model
 * (claude-haiku-4-5) on real-time request paths and reserve the stronger
 * default for batch digest work.
 */

import { spawn } from 'node:child_process';

/** Used when neither the caller nor CLAUDE_MODEL specifies a model. */
const DEFAULT_MODEL = 'claude-sonnet-5';

export interface GenerateTextOpts {
  /** Claude model id for this call (e.g. 'claude-haiku-4-5'). Falls back to CLAUDE_MODEL. */
  model?: string;
  /** Short label for log lines. */
  label?: string;
}

/** Accept only Claude model ids; anything else (legacy `gemini-*`) falls back. */
function resolveModel(opts: GenerateTextOpts): string {
  const candidate = opts.model?.trim();
  if (candidate && /^claude[-.]/i.test(candidate)) return candidate;
  return process.env.CLAUDE_MODEL || DEFAULT_MODEL;
}

/**
 * Generate plain text for a single prompt. Returns the model's raw text
 * (caller trims/parses). Throws on failure — callers already wrap these in
 * try/catch with their own fallbacks.
 */
export async function generateText(prompt: string, opts: GenerateTextOpts = {}): Promise<string> {
  await acquireClaudeSlot();
  try {
    return await spawnClaude(prompt, opts);
  } finally {
    releaseClaudeSlot();
  }
}

// ── concurrency pool ───────────────────────────────────────────────────────
// Bound the number of concurrent `claude -p` processes. The batch pipeline
// issues these in per-feature loops; a small pool cuts wall-time while
// staying well under the subscription's rate limits. Tune via
// CLAUDE_CONCURRENCY.
const CLAUDE_MAX_CONCURRENCY = Math.max(1, Number(process.env.CLAUDE_CONCURRENCY ?? 3));
let claudeActive = 0;
const claudeWaiters: Array<() => void> = [];

function acquireClaudeSlot(): Promise<void> {
  if (claudeActive < CLAUDE_MAX_CONCURRENCY) {
    claudeActive++;
    return Promise.resolve();
  }
  // Wait to be handed a live slot by releaseClaudeSlot (claudeActive is
  // not decremented in that case — the slot transfers directly).
  return new Promise<void>(resolve => claudeWaiters.push(resolve));
}

function releaseClaudeSlot(): void {
  const next = claudeWaiters.shift();
  if (next) next();
  else claudeActive--;
}

function spawnClaude(prompt: string, opts: GenerateTextOpts): Promise<string> {
  const model = resolveModel(opts);
  return new Promise<string>((resolvePromise, reject) => {
    // --strict-mcp-config / --setting-sources '' keep these batch text calls
    // hermetic: no MCP servers and no user/project settings get pulled into
    // a digest prompt, so the container and the Mac behave identically.
    const args = [
      '-p', '--output-format', 'json',
      '--model', model,
      '--strict-mcp-config',
      '--setting-sources', '',
    ];
    const child = spawn('claude', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', d => { out += d.toString(); });
    child.stderr.on('data', d => { err += d.toString(); });
    child.on('error', e => reject(new Error(`claude CLI spawn failed (${opts.label ?? 'llm'}): ${e.message}`)));
    child.on('close', code => {
      if (code !== 0) {
        reject(new Error(`claude CLI exit ${code} (${opts.label ?? 'llm'}): ${err.slice(0, 400)}`));
        return;
      }
      // `claude -p --output-format json` prints a JSON envelope whose
      // `result` field holds the assistant text. Fall back to raw stdout
      // if the envelope shape ever changes.
      try {
        const parsed = JSON.parse(out) as { result?: string; is_error?: boolean };
        if (parsed.is_error) {
          reject(new Error(`claude CLI reported error (${opts.label ?? 'llm'}): ${String(parsed.result ?? '').slice(0, 400)}`));
          return;
        }
        resolvePromise(String(parsed.result ?? '').trim());
      } catch {
        resolvePromise(out.trim());
      }
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}
