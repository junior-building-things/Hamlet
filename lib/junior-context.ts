/**
 * Junior context files — markdown documents Hamlet exposes for editing
 * and Junior loads into its system prompt at chat time.
 *
 * Stored under `gs://tiktok-im-hamlet-state/junior/context/<name>.md`.
 *
 * Conventions for filenames (non-enforced — file shape is just text,
 * names just sort the editor UI):
 *   - system.md       Junior persona, base behavior
 *   - glossary.md     org vocabulary, team names, doc locations
 *   - skill_*.md      one per skill / capability area
 *   - preferences.md  user-stated preferences (Junior auto-appends here
 *                     via the remember_preference tool)
 */

const STATE_BUCKET = 'tiktok-im-hamlet-state';
const PREFIX = 'junior/context/';
const METADATA_TOKEN_URL =
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';

interface CachedToken { token: string; expiresAt: number }
let cachedToken: CachedToken | null = null;

async function getMetadataToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) return cachedToken.token;
  const res = await fetch(METADATA_TOKEN_URL, { headers: { 'Metadata-Flavor': 'Google' } });
  if (!res.ok) throw new Error(`metadata token fetch failed: ${res.status}`);
  const data = await res.json() as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error('metadata token missing access_token');
  cachedToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
  return cachedToken.token;
}

export interface JuniorContextFile {
  name: string;        // bare filename, e.g. "system.md"
  content: string;
  updatedAt?: string;  // GCS object updated time (ISO8601)
}

function objectPath(name: string): string {
  // Trust the caller to pass a sensible filename; encode for URL safety.
  return `${PREFIX}${name}`;
}

/**
 * List all context files (name + last-updated only). Use readContextFile
 * for content. Cheaper than fetching every file's body up front.
 */
export async function listContextFileNames(): Promise<Array<{ name: string; updatedAt: string }>> {
  const token = await getMetadataToken();
  const url = `https://storage.googleapis.com/storage/v1/b/${STATE_BUCKET}/o?prefix=${encodeURIComponent(PREFIX)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    if (res.status === 404) return [];
    throw new Error(`GCS list ${PREFIX} failed: ${res.status} ${res.statusText}`);
  }
  const data = await res.json() as { items?: Array<{ name: string; updated?: string }> };
  return (data.items ?? [])
    .map(it => ({ name: it.name.slice(PREFIX.length), updatedAt: it.updated ?? '' }))
    .filter(it => it.name && !it.name.endsWith('/'))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function readContextFile(name: string): Promise<JuniorContextFile | null> {
  const token = await getMetadataToken();
  const url = `https://storage.googleapis.com/storage/v1/b/${STATE_BUCKET}/o/${encodeURIComponent(objectPath(name))}?alt=media`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GCS read ${name} failed: ${res.status} ${res.statusText}`);
  const content = await res.text();
  const updatedAt = res.headers.get('x-goog-meta-updated') ?? '';
  return { name, content, updatedAt };
}

/**
 * Read all context files (name + content). Used by Junior at chat time.
 * Returns files sorted by name for stable ordering in the system prompt.
 */
export async function listContextFiles(): Promise<JuniorContextFile[]> {
  const heads = await listContextFileNames();
  const files = await Promise.all(
    heads.map(async h => {
      const f = await readContextFile(h.name);
      return f ?? { name: h.name, content: '', updatedAt: h.updatedAt };
    }),
  );
  return files;
}

export async function writeContextFile(name: string, content: string): Promise<void> {
  const token = await getMetadataToken();
  const params = new URLSearchParams({ uploadType: 'media', name: objectPath(name) });
  const url = `https://storage.googleapis.com/upload/storage/v1/b/${STATE_BUCKET}/o?${params.toString()}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/markdown; charset=utf-8' },
    body: content,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GCS write ${name} failed: ${res.status} ${res.statusText} ${body.slice(0, 200)}`);
  }
}

export async function deleteContextFile(name: string): Promise<void> {
  const token = await getMetadataToken();
  const url = `https://storage.googleapis.com/storage/v1/b/${STATE_BUCKET}/o/${encodeURIComponent(objectPath(name))}`;
  const res = await fetch(url, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) return; // already gone — treat as success
  if (!res.ok) throw new Error(`GCS delete ${name} failed: ${res.status} ${res.statusText}`);
}
