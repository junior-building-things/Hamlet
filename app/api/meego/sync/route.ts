import { NextRequest, NextResponse } from 'next/server';
import { syncFeatureStatus } from '@/lib/meego';

export async function POST(req: NextRequest) {
  const { meegoUrl } = await req.json() as { meegoUrl?: string };

  if (!meegoUrl) {
    return NextResponse.json({ error: 'meegoUrl is required' }, { status: 400 });
  }

  try {
    const result = await syncFeatureStatus(meegoUrl);
    return NextResponse.json(result);
  } catch (err) {
    console.error('Meego sync error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Sync failed' },
      { status: 500 }
    );
  }
}
