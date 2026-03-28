import { NextRequest, NextResponse } from 'next/server';
import { createFeature, CreateFeatureParams } from '@/lib/meego';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as CreateFeatureParams;
    if (!body.name?.trim()) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }
    const result = await createFeature(body);
    return NextResponse.json(result);
  } catch (err) {
    console.error('Meego create error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Create failed' },
      { status: 500 },
    );
  }
}
