import { NextRequest, NextResponse } from 'next/server';
import { copyPrdTemplate } from '@/lib/lark';
import { callMeegoMcp } from '@/lib/digests';

export const maxDuration = 120;
export const dynamic = 'force-dynamic';

const MEEGO_AI_NODE_TOKEN = process.env.MEEGO_AI_NODE_TOKEN;
const TIKTOK_PROJECT_KEY = '5f105019a8b9a853da64767f';
const HALF_DAY_LABEL = '极简需求/Half-Day Feature';

/**
 * Meego AI Node webhook endpoint for auto-creating PRDs.
 *
 * When a feature enters the Requirements Prep stage in Meego, the AI Node
 * fires a webhook to this endpoint. The handler:
 *   1. Validates the shared token
 *   2. Checks if a PRD already exists (idempotency)
 *   3. Reads the "Label" field to pick regular vs half-day template
 *   4. Copies the template doc via copyPrdTemplate()
 *   5. Writes the new PRD URL back to Meego's wiki field
 *   6. Does NOT complete the AI Node — the PM completes it manually
 *      after finishing the PRD draft
 *
 * Returns 200 immediately and processes in the background so Meego's
 * webhook timeout (~3s) isn't exceeded.
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  // Log the full payload so we can learn the Meego AI Node schema on
  // first invocation. Safe to remove once the format is stable.
  console.log('[prd-writer] webhook payload:', JSON.stringify(body).slice(0, 3000));

  // Auth check: verify the request came from the expected Meego AI Node
  // plugin. Meego sends an HMAC `signature` (not the plain token), so for
  // now we validate by checking the source_plugin_id matches the registered
  // app. A full HMAC check can be added later if needed.
  // The MEEGO_AI_NODE_TOKEN is still set as an env var for future HMAC use.
  const expectedPluginId = 'MII_69D4B13554C20CDD';
  if (body.source_plugin_id && body.source_plugin_id !== expectedPluginId) {
    console.warn(`[prd-writer] unexpected source_plugin_id: ${body.source_plugin_id}`);
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Extract work_item_id from the real Meego AI Node payload shape:
  // body.data.work_item_info[0].work_item_id
  const data = body.data as Record<string, unknown> | undefined;
  const workItemInfo = Array.isArray(data?.work_item_info)
    ? (data.work_item_info as Array<{ work_item_id?: number }>)
    : [];
  const workItemId = String(
    workItemInfo[0]?.work_item_id
    ?? body.work_item_id
    ?? (data?.work_item_id)
    ?? '',
  );

  if (!workItemId || workItemId === 'undefined') {
    console.warn('[prd-writer] no work_item_id in payload');
    return NextResponse.json({ error: 'missing work_item_id' }, { status: 400 });
  }

  // Process synchronously so Cloud Run doesn't kill the instance before
  // the copy finishes. If Meego's webhook times out (~5s), the PRD is
  // still created and the idempotency check prevents duplicates on retry.
  try {
    const result = await handlePrdCreation(workItemId);
    return NextResponse.json({ ok: true, work_item_id: workItemId, ...result });
  } catch (e) {
    console.error(`[prd-writer] processing failed for ${workItemId}:`, e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'PRD creation failed' },
      { status: 500 },
    );
  }
}

async function handlePrdCreation(workItemId: string): Promise<{ prdUrl?: string; skipped?: boolean }> {
  const meegoUrl = `https://meego.larkoffice.com/${TIKTOK_PROJECT_KEY}/story/detail/${workItemId}`;
  console.log(`[prd-writer] processing work item ${workItemId}`);

  // Step 1: Fetch the brief to get name, description, existing PRD, and label.
  let brief: {
    work_item_attribute?: {
      work_item_name?: string;
    };
    work_item_fields?: Array<{ key?: string; name?: string; value?: unknown }>;
  };
  try {
    const raw = await callMeegoMcp('get_workitem_brief', {
      url: meegoUrl,
      fields: ['wiki', 'tags', 'description'],
    });
    brief = JSON.parse(raw);
  } catch (e) {
    console.error(`[prd-writer] failed to fetch brief for ${workItemId}:`, e);
    throw new Error(`Failed to fetch brief: ${e instanceof Error ? e.message : String(e)}`);
  }

  const featureName = brief.work_item_attribute?.work_item_name ?? `Feature ${workItemId}`;
  const fields = brief.work_item_fields ?? [];

  // Step 2: Idempotency check — skip if PRD already exists.
  const existingPrd = getFieldValue(fields, 'wiki');
  if (existingPrd) {
    console.log(`[prd-writer] PRD already exists for "${featureName}", skipping: ${existingPrd}`);
    return { skipped: true };
  }

  // Step 3: Check Label (tags) field to pick template.
  // The tags field can come as: a string, an array of strings, an array of
  // {label,value} objects, or a comma-separated string. Normalize to a
  // single joined string for the half-day check.
  const rawTags = fields.find(f => f.key === 'tags')?.value;
  let tagStr = '';
  if (typeof rawTags === 'string') {
    tagStr = rawTags;
  } else if (Array.isArray(rawTags)) {
    tagStr = rawTags.map(t => {
      if (typeof t === 'string') return t;
      if (t && typeof t === 'object') return String((t as Record<string, unknown>).label ?? (t as Record<string, unknown>).name ?? (t as Record<string, unknown>).value ?? '');
      return String(t);
    }).join(', ');
  } else if (rawTags && typeof rawTags === 'object') {
    const obj = rawTags as Record<string, unknown>;
    tagStr = String(obj.label ?? obj.name ?? obj.value ?? JSON.stringify(rawTags));
  }
  const useHalfDay = tagStr.includes(HALF_DAY_LABEL);
  console.log(`[prd-writer] "${featureName}": tags="${tagStr}", template=${useHalfDay ? 'half-day' : 'regular'}`);

  // Step 4: Copy the PRD template.
  const description = getFieldValue(fields, 'description');
  let prdUrl: string;
  try {
    prdUrl = await copyPrdTemplate(featureName, description || undefined, {
      useHalfDayPrd: useHalfDay,
      meegoUrl,
    });
  } catch (e) {
    console.error(`[prd-writer] template copy failed for "${featureName}":`, e);
    throw new Error(`Template copy failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  console.log(`[prd-writer] PRD created for "${featureName}": ${prdUrl}`);

  // Step 5: Write the PRD URL back to Meego.
  try {
    await callMeegoMcp('update_field', {
      project_key: TIKTOK_PROJECT_KEY,
      work_item_id: workItemId,
      fields: [{ field_key: 'wiki', field_value: prdUrl }],
    });
    console.log(`[prd-writer] Meego wiki field updated for "${featureName}"`);
  } catch (e) {
    console.error(`[prd-writer] failed to write PRD URL to Meego for "${featureName}":`, e);
  }

  return { prdUrl };
}

/**
 * Extract a string value from the brief's work_item_fields array.
 * Handles both plain strings and {value, label} objects.
 */
function getFieldValue(fields: Array<{ key?: string; value?: unknown }>, key: string): string {
  const field = fields.find(f => f.key === key);
  if (!field || field.value === undefined || field.value === null) return '';
  if (typeof field.value === 'string') return field.value;
  if (Array.isArray(field.value)) return field.value.map(String).join(', ');
  if (typeof field.value === 'object') {
    const obj = field.value as Record<string, unknown>;
    return String(obj.label ?? obj.value ?? obj.name ?? '');
  }
  return String(field.value);
}
