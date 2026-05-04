import { NextResponse } from 'next/server';
import { getActiveCronRuns } from '@/lib/cron-runs';

export const dynamic = 'force-dynamic';

/** GET — returns currently-running cron jobs for the sidebar's
 *  "Junior is working" status card. Stale entries (>15 min) are
 *  filtered server-side. */
export async function GET() {
  const runs = await getActiveCronRuns();
  return NextResponse.json({ runs });
}
