import { NextRequest, NextResponse } from 'next/server';
import {
  duplicateDoc,
  transferOwnership,
  getLarkBotToken,
  resolveDocIdFromUrl,
  updatePrdBasicInfo,
  fillWhatWeAreBuilding,
  editDocSection,
} from '@/lib/lark';

const SECRET = process.env.AGENT_RUN_SECRET;

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

interface SectionFill { heading: string; content: string }

/**
 * Duplicate a Lark PRD doc, optionally pre-fill structured fields, and
 * transfer ownership to OWNER_EMAIL.
 *
 * POST {
 *   sourceUrl:     string,
 *   newName?:      string,
 *   description?:  string,           // → "What are we building" paragraph
 *   meegoUrl?:     string,           // → PRD basic-info cell
 *   complianceUrl?: string,          // → PRD basic-info cell
 *   sections?: Array<{ heading, content }>,   // generic editDocSection
 * }
 *
 * Response: { ok, url, docToken, transferred, fillErrors? }
 *
 * Order of operations: copy → fill → transfer. The bot retains edit
 * access after transfer (new owner can't revoke the app) but doing
 * the fills first avoids any edge case.
 */
export async function POST(req: NextRequest) {
  if (!SECRET) return NextResponse.json({ error: 'AGENT_RUN_SECRET not configured' }, { status: 500 });
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${SECRET}`) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  try {
    const body = await req.json() as {
      sourceUrl?: string;
      newName?: string;
      description?: string;
      meegoUrl?: string;
      complianceUrl?: string;
      sections?: SectionFill[];
    };
    const sourceUrl = String(body.sourceUrl ?? '');
    if (!sourceUrl) return NextResponse.json({ error: 'missing sourceUrl' }, { status: 400 });

    const newUrl = await duplicateDoc(sourceUrl, body.newName);
    const docToken = await resolveDocIdFromUrl(newUrl);
    const botToken = await getLarkBotToken();

    const fillErrors: Record<string, string> = {};

    if (body.meegoUrl || body.complianceUrl) {
      try {
        await updatePrdBasicInfo(docToken, { meegoUrl: body.meegoUrl, complianceUrl: body.complianceUrl }, botToken);
      } catch (e) {
        fillErrors.basicInfo = e instanceof Error ? e.message : String(e);
      }
    }

    if (body.description?.trim()) {
      try {
        await fillWhatWeAreBuilding(docToken, body.description.trim(), botToken);
      } catch (e) {
        fillErrors.description = e instanceof Error ? e.message : String(e);
      }
    }

    if (Array.isArray(body.sections)) {
      for (const s of body.sections) {
        if (!s?.heading || !s?.content) continue;
        try {
          await editDocSection(newUrl, s.heading, s.content);
        } catch (e) {
          fillErrors[`section:${s.heading}`] = e instanceof Error ? e.message : String(e);
        }
      }
    }

    let transferred = true;
    let transferError: string | undefined;
    try {
      await transferOwnership(docToken, botToken);
    } catch (e) {
      transferred = false;
      transferError = e instanceof Error ? e.message : String(e);
      console.warn('[admin/duplicate-prd] transferOwnership failed:', e);
    }

    return NextResponse.json({
      ok: true,
      url: newUrl,
      docToken,
      transferred,
      ...(transferError ? { transferError } : {}),
      ...(Object.keys(fillErrors).length ? { fillErrors } : {}),
    });
  } catch (e) {
    console.error('[admin/duplicate-prd] error:', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 });
  }
}
