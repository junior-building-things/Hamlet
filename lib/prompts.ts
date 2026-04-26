/**
 * Centralized prompt overrides backed by GCS.
 *
 * Every prompt used by Hamlet, Junior, Rio, and Mia is registered in
 * `prompt-registry.ts` with a default text. Overrides are stored in
 * `gs://tiktok-im-hamlet-state/hamlet/prompts.json` and read by both
 * Hamlet and Junior at call time.
 *
 * Cached for 30s in-memory to avoid hammering GCS while still letting
 * edits take effect quickly.
 */

import { readJsonState, writeJsonState } from './gcs-state';

const PROMPTS_PATH = 'hamlet/prompts.json';
const CACHE_TTL_MS = 30 * 1000;

/**
 * Allowed thinking-budget settings for a prompt. Maps to the
 * `@google/genai` SDK as follows:
 *   dynamic → thinkingBudget: -1   (model picks per call — Gemini default)
 *   off     → thinkingBudget: 0    (no thinking at all)
 *   minimal → thinkingLevel: MINIMAL
 *   low     → thinkingLevel: LOW
 *   medium  → thinkingLevel: MEDIUM
 *   high    → thinkingLevel: HIGH
 *
 * Only meaningful for prompts sent to thinking-capable models (e.g.
 * gemini-3.1-flash-lite-preview). Non-thinking models ignore the field.
 */
export type ThinkingBudget = 'dynamic' | 'off' | 'minimal' | 'low' | 'medium' | 'high';

export const THINKING_BUDGETS: ThinkingBudget[] = ['dynamic', 'off', 'minimal', 'low', 'medium', 'high'];

export interface PromptOverride {
  /** Override text. If absent, fall back to the default in prompt-registry. */
  content?: string;
  /** Override thinking budget. If absent, fall back to the registry default (or 'dynamic'). */
  thinkingBudget?: ThinkingBudget;
  updatedAt: string;
  updatedBy?: string;
}

export type PromptOverrides = Record<string, PromptOverride>;

let cache: { data: PromptOverrides; fetchedAt: number } | null = null;

async function loadOverrides(): Promise<PromptOverrides> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.data;
  try {
    const data = await readJsonState<PromptOverrides>(PROMPTS_PATH);
    cache = { data: data ?? {}, fetchedAt: Date.now() };
  } catch {
    cache = { data: {}, fetchedAt: Date.now() };
  }
  return cache.data;
}

/**
 * Get a prompt by ID. Returns the override from GCS if set, otherwise
 * the fallback (the hardcoded default).
 */
export async function getPrompt(id: string, fallback: string): Promise<string> {
  const overrides = await loadOverrides();
  return overrides[id]?.content ?? fallback;
}

/**
 * Get the thinking-budget setting for a prompt. Returns the override if
 * set, else the provided fallback (default 'dynamic'). Pair with
 * `thinkingBudgetToConfig()` to produce a value spreadable into the
 * `@google/genai` `thinkingConfig` field.
 */
export async function getPromptThinkingBudget(
  id: string,
  fallback: ThinkingBudget = 'dynamic',
): Promise<ThinkingBudget> {
  const overrides = await loadOverrides();
  return overrides[id]?.thinkingBudget ?? fallback;
}

// Note: the helper that maps ThinkingBudget into the @google/genai
// ThinkingConfig shape lives in the consumer (currently Junior's
// lib/prompts.ts) so it can reference the SDK's ThinkingLevel enum
// directly. Hamlet stores the choice; Junior reads + applies it.

/**
 * Save a prompt override to GCS. Either or both of `content` and
 * `thinkingBudget` may be passed; whichever is omitted is left unchanged
 * (or unset on a brand-new override). Invalidates the in-memory cache.
 */
export async function setPrompt(
  id: string,
  patch: { content?: string; thinkingBudget?: ThinkingBudget },
  updatedBy?: string,
): Promise<void> {
  const overrides = await loadOverrides();
  const prev = overrides[id];
  overrides[id] = {
    ...(prev ?? {}),
    ...(patch.content !== undefined ? { content: patch.content } : {}),
    ...(patch.thinkingBudget !== undefined ? { thinkingBudget: patch.thinkingBudget } : {}),
    updatedAt: new Date().toISOString(),
    ...(updatedBy ? { updatedBy } : {}),
  };
  await writeJsonState(PROMPTS_PATH, overrides);
  cache = null;
}

/**
 * Delete a prompt override (revert to default).
 */
export async function resetPrompt(id: string): Promise<void> {
  const overrides = await loadOverrides();
  delete overrides[id];
  await writeJsonState(PROMPTS_PATH, overrides);
  cache = null;
}

/**
 * Return all overrides — used by the admin UI to display the current state.
 */
export async function listOverrides(): Promise<PromptOverrides> {
  return loadOverrides();
}

/**
 * Force a refresh of the in-memory cache on the next getPrompt call.
 */
export function invalidatePromptCache(): void {
  cache = null;
}
