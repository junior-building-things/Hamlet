import { NextRequest, NextResponse } from 'next/server';
import { updateFeatureFields, getComplianceUrl } from '@/lib/meego';
import { copyPrdTemplate, updatePrdBasicInfo, getLarkBotToken, resolveDocIdFromUrl } from '@/lib/lark';
import { generatePrdScaffold } from '@/lib/prd-scaffold';

export const maxDuration = 300;

const TIKTOK_PROJECT_KEY = '5f105019a8b9a853da64767f';

/** Meego creates the legal ticket a few seconds after the story; wait up to a minute for it. */
async function waitForComplianceUrl(workItemId: string): Promise<string> {
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      const url = await getComplianceUrl(workItemId);
      if (url) return url;
    } catch (e) {
      console.warn('[create-prd] legal ticket lookup failed:', e);
    }
    await new Promise(r => setTimeout(r, 5000));
  }
  return '';
}

/** Create the PRD for a just-created Meego story and link it back to the story. */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      id?: string; name?: string; meegoUrl?: string; featureDescription?: string; useHalfDayPrd?: boolean;
    };
    const name = body.name?.trim();
    if (!body.id || !name) return NextResponse.json({ error: 'id and name are required' }, { status: 400 });

    // Research + drafting and the legal-ticket lookup run alongside the template copy.
    const legalTicket = waitForComplianceUrl(body.id);
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

    const complianceUrl = await legalTicket;
    if (complianceUrl) {
      try {
        await updatePrdBasicInfo(await resolveDocIdFromUrl(prd), { complianceUrl }, await getLarkBotToken());
      } catch (e) {
        console.warn('PRD legal ticket link failed:', e);
      }
    } else {
      console.warn(`[create-prd] no legal ticket on ${body.id} after 60s — PRD left without it`);
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
