import { NextRequest, NextResponse } from 'next/server';
import { runDigestSection } from '@/lib/digests';
import { withCronRun } from '@/lib/cron-runs';

const AGENT_RUN_SECRET = process.env.AGENT_RUN_SECRET;

// Per-section digest endpoint, fired by one Cloud Scheduler job per section.
// Queue-based sections (line_review, ab_open, prd_changes) drain their queue
// + send. Scan-based sections (risk, unanswered, ab_concluded) re-run their
// scan against the latest data.
export const maxDuration = 600;
export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (AGENT_RUN_SECRET) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${AGENT_RUN_SECRET}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }
  const { id } = await params;
  try {
    const source = req.headers.get('x-cron-source') === 'manual' ? 'manual' : 'scheduled';
    const result = await withCronRun(id, source, () => runDigestSection(id));
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error(`[digests/section/${id}] error:`, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'section run failed' },
      { status: 500 },
    );
  }
}
