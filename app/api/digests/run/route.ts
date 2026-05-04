import { NextRequest, NextResponse } from 'next/server';
import { runDailyDigests } from '@/lib/digests';
import { withCronRun } from '@/lib/cron-runs';

const AGENT_RUN_SECRET = process.env.AGENT_RUN_SECRET;

// Cloud Run has a 60-minute max request timeout but Next.js defaults to 30s for serverless.
// Set a long runtime for this endpoint since it walks every feature sequentially.
export const maxDuration = 600;
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  // Bearer token auth for Cloud Scheduler / manual curl
  if (AGENT_RUN_SECRET) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${AGENT_RUN_SECRET}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  try {
    // Optional ?section=<id> filter: still runs all data fetching (so
    // sections that share fetches stay correct), but only sends the
    // matching card. Used by the Cron Jobs UI's per-section "Trigger
    // once" button.
    const sectionFilter = req.nextUrl.searchParams.get('section') ?? undefined;
    const source = req.headers.get('x-cron-source') === 'manual' ? 'manual' : 'scheduled';
    const result = await withCronRun('hamlet-daily-digest', source, () =>
      runDailyDigests({ sectionFilter }),
    );
    return NextResponse.json({
      ok: true,
      featuresChecked: result.featuresChecked,
      riskSent: result.riskSent,
      unansweredSent: result.unansweredSent,
      riskCounts: {
        red: result.riskFindings.filter(f => f.level === 'red').length,
        yellow: result.riskFindings.filter(f => f.level === 'yellow').length,
        green: result.riskFindings.filter(f => f.level === 'green').length,
      },
      unansweredCount: result.unansweredFindings.reduce((sum, f) => sum + f.questions.length, 0),
    });
  } catch (err) {
    console.error('[digests/run] error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Digests run failed' },
      { status: 500 },
    );
  }
}
