import { NextRequest, NextResponse } from 'next/server';
import { updateFeatureFields } from '@/lib/meego';
import { copyPrdTemplate } from '@/lib/lark';
import { generatePrdScaffold } from '@/lib/prd-scaffold';

export const maxDuration = 300;

const TIKTOK_PROJECT_KEY = '5f105019a8b9a853da64767f';

/** Create the PRD for a just-created Meego story and link it back to the story. */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      id?: string; name?: string; meegoUrl?: string; featureDescription?: string; useHalfDayPrd?: boolean;
    };
    const name = body.name?.trim();
    if (!body.id || !name) return NextResponse.json({ error: 'id and name are required' }, { status: 400 });

    // Research + drafting runs alongside the template copy.
    const description = body.featureDescription?.trim();
    const scaffold = description ? generatePrdScaffold(name, description) : undefined;
    const prd = await copyPrdTemplate(name, description, {
      useHalfDayPrd: body.useHalfDayPrd,
      meegoUrl: body.meegoUrl,
      scaffold,
    });

    try {
      await updateFeatureFields(TIKTOK_PROJECT_KEY, body.id, { prd });
    } catch (e) {
      console.warn('PRD link-back to Meego failed:', e);
    }
    return NextResponse.json({ prd });
  } catch (err) {
    console.error('PRD create error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'PRD creation failed' },
      { status: 500 },
    );
  }
}
