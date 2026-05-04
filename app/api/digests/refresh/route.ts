import { NextRequest, NextResponse } from 'next/server';
import { runDailyDigests } from '@/lib/digests';
import { withCronRun } from '@/lib/cron-runs';

const AGENT_RUN_SECRET = process.env.AGENT_RUN_SECRET;

// Refresh: full Meego pull + transition detection + queue cards into
// DigestState + write feature-snapshots.json. Sends NO digest cards —
// per-section crons (POST /api/digests/section/<id>) consume the queues.
export const maxDuration = 900;
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (AGENT_RUN_SECRET) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${AGENT_RUN_SECRET}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  try {
    // Track in-flight state for the sidebar's "Junior is working" status.
    // Manually-triggered runs come in via /api/crons/[id]/trigger which
    // sets the X-Cron-Source header so we can attribute correctly.
    const source = req.headers.get('x-cron-source') === 'manual' ? 'manual' : 'scheduled';
    const result = await withCronRun('refresh-feature-cache', source, () =>
      runDailyDigests({ mode: 'refresh' }),
    );
    return NextResponse.json({
      ok: true,
      mode: 'refresh',
      featuresChecked: result.featuresChecked,
    });
  } catch (err) {
    console.error('[digests/refresh] error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'refresh failed' },
      { status: 500 },
    );
  }
}
