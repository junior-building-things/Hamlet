/**
 * Single LLM entrypoint for Hamlet's non-interactive (batch) text calls.
 *
 * Two providers, chosen at runtime by the LLM_PROVIDER env var:
 *   (unset)  → Google Gemini, exactly as before. This is what Cloud Run
 *              uses, so the deployed app — including all the real-time
 *              request/webhook paths — is unaffected.
 *   'claude' → shell out to the local `claude` CLI (`claude -p`), which
 *              authenticates with the user's Claude Max subscription and
 *              can read local files. Set ONLY by the local LaunchAgent
 *              runner (tools/run-digests-local.ts) — never on Cloud Run.
 *
 * The Gemini path preserves the previous behaviour 1:1: caller passes the
 * already-resolved Gemini model name (from getPromptModel) and gets the
 * raw response text back, then does its own trimming/parsing.
 *
 * In claude mode the resolved Gemini model name is ignored; the model is
 * CLAUDE_MODEL (default claude-sonnet-5).
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { spawn } from 'node:child_process';

export interface GenerateTextOpts {
  /** Resolved Gemini model name (used as-is on the Gemini path; ignored on the claude path). */
  model: string;
  /** Short label for log lines. */
  label?: string;
}

function claudeMode(): boolean {
  return process.env.LLM_PROVIDER === 'claude';
}

/**
 * Generate plain text for a single prompt. Returns the model's raw text
 * (caller trims/parses). Throws on provider failure — callers already
 * wrap these in try/catch with their own fallbacks.
 */
export async function generateText(prompt: string, opts: GenerateTextOpts): Promise<string> {
  return claudeMode() ? generateViaClaude(prompt, opts) : generateViaGemini(prompt, opts);
}

async function generateViaGemini(prompt: string, opts: GenerateTextOpts): Promise<string> {
  const apiKey = process.env.GOOGLE_AI_API_KEY ?? '';
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: opts.model });
  const result = await model.generateContent(prompt);
  return result.response.text();
}

// ── claude CLI path ────────────────────────────────────────────────────────
// Bound the number of concurrent `claude -p` processes. The batch pipeline
// issues these in per-feature loops; a small pool cuts wall-time while
// staying well under the Max 5-hour-window rate limits. Tune via
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

function claudeModel(): string {
  return process.env.CLAUDE_MODEL ?? 'claude-sonnet-5';
}

async function generateViaClaude(prompt: string, opts: GenerateTextOpts): Promise<string> {
  await acquireClaudeSlot();
  try {
    return await spawnClaude(prompt, opts);
  } finally {
    releaseClaudeSlot();
  }
}

function spawnClaude(prompt: string, opts: GenerateTextOpts): Promise<string> {
  return new Promise<string>((resolvePromise, reject) => {
    const args = ['-p', '--output-format', 'json', '--model', claudeModel()];
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
