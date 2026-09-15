import { NextRequest, NextResponse } from 'next/server';
import { createFeature, findRecentStoryByName, CreateFeatureParams } from '@/lib/meego';

// A second submit of the same name inside this window is treated as a duplicate.
const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;

// Creates the Meego story only; the client then calls /api/meego/create-prd so
// the New Feature modal can close without waiting on the PRD.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as CreateFeatureParams;
    const name = body.name?.trim();
    if (!name) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }

    try {
      const duplicate = await findRecentStoryByName(name, DUPLICATE_WINDOW_MS);
      if (duplicate) {
        const mins = Math.max(1, Math.round((Date.now() - Date.parse(duplicate.createdAt)) / 60000));
        return NextResponse.json(
          { error: `"${name}" was already created in Meego ${mins} min ago (${duplicate.meegoUrl}). Rename it if this is a different feature.`, duplicate },
          { status: 409 },
        );
      }
    } catch (e) {
      console.warn('[meego/create] duplicate check failed, creating anyway:', e);
    }

    return NextResponse.json(await createFeature({ ...body, name }));
  } catch (err) {
    console.error('Meego create error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Create failed' },
      { status: 500 },
    );
  }
}
