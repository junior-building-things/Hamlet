import { NextRequest, NextResponse } from 'next/server';
import { getCronById } from '@/lib/cron-registry';

export const dynamic = 'force-dynamic';
export const maxDuration = 600;

const AGENT_RUN_SECRET = process.env.AGENT_RUN_SECRET;

/**
 * POST — manually trigger a cron job once. For Cloud Scheduler jobs we
 * hit the corresponding URL directly; for digest sub-sections we hit
 * /api/digests/run (which currently runs the FULL pipeline — section
 * filtering would let us narrow this but is a follow-up).
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const def = getCronById(id);
  if (!def) return NextResponse.json({ error: 'unknown cron' }, { status: 404 });

  try {
    if (def.kind === 'cloud_scheduler') {
      // Hit the same URL Cloud Scheduler hits.
      const HAMLET_BASE = 'https://hamlet-416594255546.asia-southeast1.run.app';
      let url = '';
      let method: 'GET' | 'POST' = 'POST';
      let auth = '';
      const jobId = def.cloudSchedulerJobId;
      if (jobId === 'hamlet-daily-digest') {
        url = `${HAMLET_BASE}/api/digests/run`;
        auth = AGENT_RUN_SECRET ? `Bearer ${AGENT_RUN_SECRET}` : '';
      } else if (jobId === 'refresh-feature-cache') {
        url = `${HAMLET_BASE}/api/digests/refresh`;
        auth = AGENT_RUN_SECRET ? `Bearer ${AGENT_RUN_SECRET}` : '';
      } else if (jobId && jobId.startsWith('digest-')) {
        // Per-section cron: hit /api/digests/section/<def.id>
        url = `${HAMLET_BASE}/api/digests/section/${encodeURIComponent(def.id)}`;
        auth = AGENT_RUN_SECRET ? `Bearer ${AGENT_RUN_SECRET}` : '';
      } else if (jobId === 'poll-prd-ready') {
        url = 'https://junior-416594255546.asia-southeast1.run.app/api/poll-prd-ready';
        method = 'GET';
        // Junior uses its own secret env (not AGENT_RUN_SECRET).
      } else {
        return NextResponse.json({ error: `unsupported cron job: ${jobId}` }, { status: 400 });
      }
      const res = await fetch(url, {
        method,
        headers: {
          ...(auth ? { Authorization: auth } : {}),
          'Content-Type': 'application/json',
        },
        body: method === 'POST' ? '{}' : undefined,
      });
      const body = await res.text().catch(() => '');
      return NextResponse.json({ ok: res.ok, status: res.status, body: body.slice(0, 400) });
    }

    return NextResponse.json({ error: 'unsupported kind' }, { status: 400 });
  } catch (e) {
    console.warn('[crons] trigger failed:', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'trigger failed' }, { status: 500 });
  }
}
