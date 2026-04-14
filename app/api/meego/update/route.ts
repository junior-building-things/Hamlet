import { NextRequest, NextResponse } from 'next/server';
import { updateFeatureFields } from '@/lib/meego';
import { updateFeatureInCache } from '@/lib/feature-cache';
import { renameDocument } from '@/lib/lark';
import { Priority, Feature } from '@/lib/types';

// Fields that have Meego MCP field keys
const MEEGO_FIELDS = new Set(['name', 'prd', 'priority', 'figmaUrl']);

export async function POST(req: NextRequest) {
  const { projectKey, workItemId, featureId, fields } = await req.json() as {
    projectKey?: string;
    workItemId?: string;
    featureId?: string;
    fields?: Partial<Feature> & { figmaUrl?: string };
  };

  if (!fields || Object.keys(fields).length === 0) {
    return NextResponse.json({ error: 'fields are required' }, { status: 400 });
  }

  try {
    // 1. Update Meego-backed fields (name, prd, priority, figmaUrl)
    const meegoFields: { name?: string; prd?: string; priority?: Priority; figmaUrl?: string } = {};
    let hasMeego = false;
    for (const key of Object.keys(fields)) {
      if (MEEGO_FIELDS.has(key)) {
        (meegoFields as Record<string, unknown>)[key] = (fields as Record<string, unknown>)[key];
        hasMeego = true;
      }
    }

    if (hasMeego && projectKey && workItemId) {
      await updateFeatureFields(projectKey, workItemId, meegoFields);
    }

    // 2. On name change, also rename the PRD document title
    if (fields.name && fields.prd) {
      try {
        await renameDocument(fields.prd, `[PRD] ${fields.name}`);
      } catch (e) {
        console.warn('[update] PRD rename failed (non-fatal):', e);
      }
    }

    // 3. Update GCS cache for all fields
    if (featureId) {
      await updateFeatureInCache(featureId, fields);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Meego update error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Update failed' },
      { status: 500 }
    );
  }
}
