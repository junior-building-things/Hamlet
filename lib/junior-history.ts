/**
 * Junior conversation history admin helpers.
 *
 * Junior persists per-turn back-and-forth in two GCS prefixes:
 *  - junior/chat-history/<chatId>.json   (chat-level shared log)
 *  - junior/user-history/<openId>.json   (per-user cross-chat log)
 *
 * Hamlet's "Junior Context" tab surfaces stats + a "Clear all" affordance
 * for each. This module covers the list + bulk-delete operations against
 * the GCS REST API using the metadata-server token (same auth pattern as
 * lib/junior-context.ts).
 */

const STATE_BUCKET = 'tiktok-im-hamlet-state';
const CHAT_PREFIX = 'junior/chat-history/';
const USER_PREFIX = 'junior/user-history/';
const METADATA_TOKEN_URL =
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';

interface CachedToken { token: string; expiresAt: number }
let cachedToken: CachedToken | null = null;

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) return cachedToken.token;
  const res = await fetch(METADATA_TOKEN_URL, { headers: { 'Metadata-Flavor': 'Google' } });
  if (!res.ok) throw new Error(`metadata token fetch failed: ${res.status}`);
  const data = await res.json() as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error('metadata token missing access_token');
  cachedToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
  return cachedToken.token;
}

async function listObjectNames(prefix: string): Promise<string[]> {
  const token = await getToken();
  const url = `https://storage.googleapis.com/storage/v1/b/${STATE_BUCKET}/o?prefix=${encodeURIComponent(prefix)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    if (res.status === 404) return [];
    throw new Error(`GCS list ${prefix} failed: ${res.status}`);
  }
  const data = await res.json() as { items?: Array<{ name?: string }> };
  return (data.items ?? [])
    .map(it => it.name ?? '')
    .filter(n => n && !n.endsWith('/'));
}

async function readJsonObject<T>(name: string): Promise<T | null> {
  const token = await getToken();
  const url = `https://storage.googleapis.com/storage/v1/b/${STATE_BUCKET}/o/${encodeURIComponent(name)}?alt=media`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  return await res.json() as T;
}

async function deleteObject(name: string): Promise<void> {
  const token = await getToken();
  const url = `https://storage.googleapis.com/storage/v1/b/${STATE_BUCKET}/o/${encodeURIComponent(name)}`;
  const res = await fetch(url, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok && res.status !== 404) {
    throw new Error(`GCS delete ${name} failed: ${res.status}`);
  }
}

export interface HistoryStats {
  fileCount: number;
  totalMessages: number;
}

async function statsFor(prefix: string): Promise<HistoryStats> {
  const names = await listObjectNames(prefix);
  let totalMessages = 0;
  // Sum message counts across all files in parallel (capped batch).
  const counts = await Promise.all(
    names.map(async n => {
      const data = await readJsonObject<unknown[]>(n);
      return Array.isArray(data) ? data.length : 0;
    }),
  );
  for (const c of counts) totalMessages += c;
  return { fileCount: names.length, totalMessages };
}

async function clearAll(prefix: string): Promise<{ deleted: number }> {
  const names = await listObjectNames(prefix);
  await Promise.all(names.map(n => deleteObject(n).catch(() => {})));
  return { deleted: names.length };
}

export async function getChatHistoryStats(): Promise<HistoryStats> { return statsFor(CHAT_PREFIX); }
export async function getUserHistoryStats(): Promise<HistoryStats> { return statsFor(USER_PREFIX); }
export async function clearAllChatHistory(): Promise<{ deleted: number }> { return clearAll(CHAT_PREFIX); }
export async function clearAllUserHistory(): Promise<{ deleted: number }> { return clearAll(USER_PREFIX); }
