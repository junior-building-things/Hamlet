import { NextResponse } from 'next/server';

/**
 * Proxy for Junior's GET /api/tools (the read-only listing of its
 * function-calling tool definitions). Used by the Junior Context tab's
 * Tools section.
 *
 * Server-side cached for 60s so tab re-mounts don't hit Junior on every
 * render. Auth pattern mirrors app/api/meego/sync/route.ts:214-215 —
 * JUNIOR_URL + JUNIOR_CRON_SECRET (Junior's CRON_SECRET, same value).
 */

interface CachedTools {
  fetchedAtMs: number;
  payload: unknown;
}

const CACHE_TTL_MS = 60_000;
let cache: CachedTools | null = null;

export async function GET() {
  const now = Date.now();
  if (cache && now - cache.fetchedAtMs < CACHE_TTL_MS) {
    return NextResponse.json(cache.payload);
  }
  const juniorUrl = process.env.JUNIOR_URL;
  const cronSecret = process.env.JUNIOR_CRON_SECRET;
  if (!juniorUrl || !cronSecret) {
    return NextResponse.json(
      { error: 'JUNIOR_URL or JUNIOR_CRON_SECRET not configured' },
      { status: 500 },
    );
  }
  try {
    const res = await fetch(`${juniorUrl}/api/tools`, {
      headers: { Authorization: `Bearer ${cronSecret}` },
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `Junior returned ${res.status}` },
        { status: 502 },
      );
    }
    const payload = await res.json();
    cache = { fetchedAtMs: now, payload };
    return NextResponse.json(payload);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'fetch failed' },
      { status: 502 },
    );
  }
}
