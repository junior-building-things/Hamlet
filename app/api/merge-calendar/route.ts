import { NextResponse } from 'next/server';
import { getAllCodeFreezeDates } from '@/lib/merge-calendar';

export const dynamic = 'force-dynamic';
export const revalidate = 3600; // browser cache for 1 hour

/**
 * GET /api/merge-calendar
 *
 * Returns the version → code freeze date map (YYYY-MM-DD) sourced
 * from the merge calendar wiki doc. Cached server-side for 24h, so
 * this endpoint is cheap on hot paths.
 *
 * Used by the Hamlet UI's VersionBadge to render the merge date
 * for a feature's iOS version on hover.
 */
export async function GET() {
  try {
    const map = await getAllCodeFreezeDates();
    return NextResponse.json(map, {
      headers: { 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400' },
    });
  } catch (e) {
    console.warn('[api/merge-calendar] failed:', e);
    return NextResponse.json({}, { status: 500 });
  }
}
