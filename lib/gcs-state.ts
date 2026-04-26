/**
 * Tiny GCS JSON state helper.
 *
 * Reads / writes individual JSON objects in a single GCS bucket using the
 * GCS REST API + the Cloud Run instance's metadata-server-issued access
 * token. Avoids adding the @google-cloud/storage dependency.
 *
 * The bucket name is fixed (gs://tiktok-im-hamlet-state) — change here if
 * the project moves. All paths are relative to that bucket.
 */

const STATE_BUCKET = 'tiktok-im-hamlet-state';
const METADATA_TOKEN_URL =
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';

interface CachedToken {
  token: string;
  expiresAt: number;
}
let cachedToken: CachedToken | null = null;

/**
 * Fetch a service-account access token from the GCE / Cloud Run metadata
 * server. Cached until ~60s before expiry.
 */
async function getMetadataToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }
  const res = await fetch(METADATA_TOKEN_URL, { headers: { 'Metadata-Flavor': 'Google' } });
  if (!res.ok) {
    throw new Error(`metadata token fetch failed: ${res.status} ${res.statusText}`);
  }
  const data = await res.json() as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error('metadata token response missing access_token');
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  return cachedToken.token;
}

/**
 * Read a JSON object from `gs://tiktok-im-hamlet-state/<path>`. Returns
 * `null` if the object doesn't exist (404), throws on any other error.
 */
export async function readJsonState<T>(path: string): Promise<T | null> {
  const { data } = await readJsonStateWithGen<T>(path);
  return data;
}

/**
 * Read a JSON object AND its current GCS object generation number. The
 * generation lets callers do conditional writes (read-modify-write
 * without losing concurrent updates) by passing it back via
 * `writeJsonState(..., { ifGenerationMatch })`. Returns `generation:
 * null` if the object doesn't exist yet (use '0' as the precondition
 * value when calling writeJsonState in that case to mean "create only
 * if it still doesn't exist").
 */
export async function readJsonStateWithGen<T>(
  path: string,
): Promise<{ data: T | null; generation: string | null }> {
  const token = await getMetadataToken();
  const url = `https://storage.googleapis.com/storage/v1/b/${STATE_BUCKET}/o/${encodeURIComponent(path)}?alt=media`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) return { data: null, generation: null };
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GCS read ${path} failed: ${res.status} ${res.statusText} ${body.slice(0, 200)}`);
  }
  const generation = res.headers.get('x-goog-generation');
  const data = await res.json() as T;
  return { data, generation };
}

/**
 * Thrown by writeJsonState when a precondition fails (HTTP 412). Callers
 * doing read-modify-write loops can catch this, re-read, re-apply, and
 * retry without conflating it with other GCS failures.
 */
export class GcsPreconditionFailedError extends Error {
  constructor(path: string) { super(`GCS precondition failed for ${path}`); this.name = 'GcsPreconditionFailedError'; }
}

/**
 * Write a JSON object to `gs://tiktok-im-hamlet-state/<path>` (replaces any
 * existing object). Uses the simple upload variant of the GCS JSON API.
 *
 * Pass `opts.ifGenerationMatch` to make the write conditional on the
 * object's current generation matching the supplied value. Use the
 * generation returned by `readJsonStateWithGen`, or '0' to require that
 * the object NOT exist (first-time create). On precondition failure the
 * write throws `GcsPreconditionFailedError` and the underlying object is
 * left unchanged.
 */
export async function writeJsonState(
  path: string,
  data: unknown,
  opts: { ifGenerationMatch?: string } = {},
): Promise<void> {
  const token = await getMetadataToken();
  const params = new URLSearchParams({ uploadType: 'media', name: path });
  if (opts.ifGenerationMatch !== undefined) {
    params.set('ifGenerationMatch', opts.ifGenerationMatch);
  }
  const url = `https://storage.googleapis.com/upload/storage/v1/b/${STATE_BUCKET}/o?${params.toString()}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });
  if (res.status === 412) throw new GcsPreconditionFailedError(path);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GCS write ${path} failed: ${res.status} ${res.statusText} ${body.slice(0, 200)}`);
  }
}

/**
 * Read-modify-write helper with optimistic concurrency. Reads the JSON
 * at `path`, hands it (or `null` if absent) to `mutator`, then writes
 * the returned value back with an `ifGenerationMatch` precondition. On
 * a precondition failure (another writer raced) re-reads + re-runs the
 * mutator + retries up to `maxRetries` times with brief jittered backoff.
 *
 * The mutator MUST be pure — it may be invoked multiple times against
 * different snapshots of the underlying object. It should return the
 * complete new value to write (not a partial patch).
 */
export async function updateJsonState<T>(
  path: string,
  mutator: (current: T | null) => T,
  maxRetries = 5,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const { data, generation } = await readJsonStateWithGen<T>(path);
    const next = mutator(data);
    try {
      await writeJsonState(path, next, { ifGenerationMatch: generation ?? '0' });
      return next;
    } catch (e) {
      if (e instanceof GcsPreconditionFailedError) {
        lastErr = e;
        await new Promise(r => setTimeout(r, 50 * (attempt + 1) + Math.random() * 100));
        continue;
      }
      throw e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`updateJsonState(${path}) exhausted retries`);
}
