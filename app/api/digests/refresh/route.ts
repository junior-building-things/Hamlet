import { NextRequest, NextResponse } from 'next/server';
import { runDailyDigests } from '@/lib/digests';

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
    const result = await runDailyDigests({ mode: 'refresh' });
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
