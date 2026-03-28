import { NextRequest, NextResponse } from 'next/server';
import { updateFeatureFields } from '@/lib/meego';

export async function POST(req: NextRequest) {
  const { projectKey, workItemId, fields } = await req.json() as {
    projectKey?: string;
    workItemId?: string;
    fields?: { name?: string; description?: string; priority?: string };
  };

  if (!projectKey || !workItemId || !fields) {
    return NextResponse.json({ error: 'projectKey, workItemId and fields are required' }, { status: 400 });
  }

  try {
    await updateFeatureFields(projectKey, workItemId, fields);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Meego update error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Update failed' },
      { status: 500 }
    );
  }
}
