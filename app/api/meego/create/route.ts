import { NextRequest, NextResponse } from 'next/server';
import { createFeature, findRecentStoryByName, CreateFeatureParams } from '@/lib/meego';

// A second submit of the same name inside this window reuses the existing story.
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
      // Reuse rather than refuse: the common case is a create whose response never
      // reached the browser ("Failed to fetch"), so the retry should adopt the story
      // it already made instead of leaving an orphan without a PRD.
      const existing = await findRecentStoryByName(name, DUPLICATE_WINDOW_MS);
      if (existing) {
        const minutesAgo = Math.max(1, Math.round((Date.now() - Date.parse(existing.createdAt)) / 60000));
        console.log(`[meego/create] reusing "${name}" (${existing.id}) created ${minutesAgo} min ago`);
        return NextResponse.json({ id: existing.id, meegoUrl: existing.meegoUrl, reused: true, minutesAgo });
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
