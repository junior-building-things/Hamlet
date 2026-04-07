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
  const token = await getMetadataToken();
  const url = `https://storage.googleapis.com/storage/v1/b/${STATE_BUCKET}/o/${encodeURIComponent(path)}?alt=media`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GCS read ${path} failed: ${res.status} ${res.statusText} ${body.slice(0, 200)}`);
  }
  return await res.json() as T;
}

/**
 * Write a JSON object to `gs://tiktok-im-hamlet-state/<path>` (replaces any
 * existing object). Uses the simple upload variant of the GCS JSON API.
 */
export async function writeJsonState(path: string, data: unknown): Promise<void> {
  const token = await getMetadataToken();
  const url = `https://storage.googleapis.com/upload/storage/v1/b/${STATE_BUCKET}/o?uploadType=media&name=${encodeURIComponent(path)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GCS write ${path} failed: ${res.status} ${res.statusText} ${body.slice(0, 200)}`);
  }
}
