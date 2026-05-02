/**
 * Tiny Cloud Scheduler REST helper.
 * Reads + patches the schedule of a job in the project. Auth via the
 * Cloud Run service account's metadata-server token (same pattern as
 * lib/junior-context.ts).
 *
 * Service account needs `cloudscheduler.jobs.get` + `cloudscheduler.jobs.update`
 * on the project. Without these the calls return 403; we surface that
 * to the caller so the UI can show a clear error.
 */

const PROJECT = 'tiktok-im';
const LOCATION = 'asia-southeast1';
const METADATA_TOKEN_URL =
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';

interface CachedToken { token: string; expiresAt: number }
let cachedToken: CachedToken | null = null;

async function getGcpToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) return cachedToken.token;
  const res = await fetch(METADATA_TOKEN_URL, { headers: { 'Metadata-Flavor': 'Google' } });
  if (!res.ok) throw new Error(`metadata token fetch failed: ${res.status}`);
  const data = await res.json() as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error('metadata token missing access_token');
  cachedToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
  return cachedToken.token;
}

export interface SchedulerJobInfo {
  schedule: string;
  timeZone: string;
  state: string;
}

export async function getSchedulerJob(jobId: string): Promise<SchedulerJobInfo | null> {
  try {
    const token = await getGcpToken();
    const url = `https://cloudscheduler.googleapis.com/v1/projects/${PROJECT}/locations/${LOCATION}/jobs/${jobId}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      console.warn(`[cloud-scheduler] get ${jobId} failed: ${res.status}`);
      return null;
    }
    const data = await res.json() as { schedule?: string; timeZone?: string; state?: string };
    if (!data.schedule) return null;
    return {
      schedule: data.schedule,
      timeZone: data.timeZone ?? 'Asia/Singapore',
      state: data.state ?? 'ENABLED',
    };
  } catch (e) {
    console.warn(`[cloud-scheduler] get ${jobId} threw:`, e);
    return null;
  }
}

export interface PatchResult { ok: boolean; status?: number; error?: string }

export async function patchSchedulerJobSchedule(jobId: string, schedule: string): Promise<PatchResult> {
  try {
    const token = await getGcpToken();
    const url = `https://cloudscheduler.googleapis.com/v1/projects/${PROJECT}/locations/${LOCATION}/jobs/${jobId}?updateMask=schedule`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ schedule }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn(`[cloud-scheduler] patch ${jobId} failed: ${res.status} ${body.slice(0, 200)}`);
      return { ok: false, status: res.status, error: body.slice(0, 200) };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'patch threw' };
  }
}
