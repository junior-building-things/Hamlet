import { NextRequest, NextResponse } from 'next/server';
import { createFeature, CreateFeatureParams } from '@/lib/meego';

// Creates the Meego story only; the client then calls /api/meego/create-prd so
// the New Feature modal can close without waiting on the PRD.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as CreateFeatureParams;
    if (!body.name?.trim()) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }
    return NextResponse.json(await createFeature(body));
  } catch (err) {
    console.error('Meego create error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Create failed' },
      { status: 500 },
    );
  }
}
