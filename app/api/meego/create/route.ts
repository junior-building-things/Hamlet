import { NextRequest, NextResponse } from 'next/server';
import { createFeature, updateFeatureFields, CreateFeatureParams } from '@/lib/meego';
import { copyPrdTemplate } from '@/lib/lark';

const TIKTOK_PROJECT_KEY = '5f105019a8b9a853da64767f';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as CreateFeatureParams;
    if (!body.name?.trim()) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }

    // 1. Create the Meego story
    const result = await createFeature(body);

    // 2. Try to create PRD doc from template (requires LARK_ACCESS_TOKEN)
    let prd: string | undefined;
    try {
      prd = await copyPrdTemplate(body.name.trim());
      // 3. Write the PRD URL back to the Meego wiki field
      await updateFeatureFields(TIKTOK_PROJECT_KEY, result.id, { prd });
    } catch (larkErr) {
      // Non-fatal: feature is still created, just without a PRD link
      console.warn('PRD creation skipped:', larkErr instanceof Error ? larkErr.message : larkErr);
    }

    return NextResponse.json({ ...result, prd });
  } catch (err) {
    console.error('Meego create error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Create failed' },
      { status: 500 },
    );
  }
}
