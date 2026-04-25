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

export interface PromptOverride {
  content: string;
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
 * Save a prompt override to GCS. Invalidates the in-memory cache so
 * the next getPrompt call sees the new value.
 */
export async function setPrompt(id: string, content: string, updatedBy?: string): Promise<void> {
  const overrides = await loadOverrides();
  overrides[id] = {
    content,
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
