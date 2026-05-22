import { NextRequest, NextResponse } from 'next/server';
import {
  duplicateDoc,
  transferOwnership,
  getLarkBotToken,
  resolveDocIdFromUrl,
  updatePrdBasicInfo,
  fillWhatWeAreBuilding,
  fillUserInteractionDesignTable,
  editDocSection,
  editDocSectionAsBullets,
  editDocSectionAsBlocks,
  updateBulletByPrefix,
  fillTableRowUnderHeading,
  type UserInteractionRow,
  type SectionBlock,
  type TableCellFill,
} from '@/lib/lark';

const SECRET = process.env.AGENT_RUN_SECRET;

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

interface SectionFill {
  heading: string;
  content?: string;
  bullets?: string[];
  blocks?: SectionBlock[];
  /**
   * Replace existing template bullets matched by their leading text. Keyed
   * by prefix (the text before the colon, e.g. "Meego link", "PRD",
   * "Figma"), value is what comes after `<prefix>: `. Use for filling
   * link-placeholder bullets like the Background section's
   * "Meego link: {To be filled}" / "PRD: {To be filled}" etc.
   */
  bulletUpdates?: Record<string, string>;
  /**
   * Fill rows of the first table found under this section. Each entry
   * supplies the cell contents for one row, in column order. Use
   * `rowIndex` to target a specific row (0-based; skip the header row,
   * typically rowIndex=1 for the first data row).
   */
  tableRows?: Array<{ rowIndex: number; cells: TableCellFill[] }>;
}

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
 *   userInteractionRows?: Array<{ scenario, interactions, onlineVersion?, expectedDesign? }>,
 *                                    // → User Interaction & Design table
 *                                    //   (template caps at 4 rows; extras dropped)
 *   sections?: Array<{
 *     heading, content?, bullets?, blocks?,
 *     bulletUpdates?, tableRows?,
 *   }>,
 *                                    // generic per-section fill:
 *                                    //   - `content` → editDocSection (single paragraph replace)
 *                                    //   - `bullets` → editDocSectionAsBullets (delete placeholder
 *                                    //                  paragraph + insert N bullet blocks)
 *                                    //   - `blocks` → editDocSectionAsBlocks (mixed list of
 *                                    //                  { kind: 'paragraph' | 'bullet' | 'code',
 *                                    //                    content, language? } blocks)
 *                                    //   Priority: blocks > bullets > content.
 *                                    //
 *                                    //   Two structure-preserving patches that run after the
 *                                    //   main section fill:
 *                                    //   - `bulletUpdates: { "<prefix>": "<value>" }` →
 *                                    //                  for each entry, find an existing bullet
 *                                    //                  whose text starts with "<prefix>:" and
 *                                    //                  rewrite it to "<prefix>: <value>" (prefix
 *                                    //                  re-bolded). Use for filling link bullets
 *                                    //                  like "Meego link: {To be filled}".
 *                                    //   - `tableRows: [{ rowIndex, cells }]` → fill cells of
 *                                    //                  specific rows in the first table under
 *                                    //                  this section. rowIndex is 0-based; row 0
 *                                    //                  is usually the header so use rowIndex=1
 *                                    //                  for the first data row. Each cell is
 *                                    //                  either a string (plain text, with
 *                                    //                  backtick parsing) or { mentionBot: true,
 *                                    //                  text? } to render a clickable @bot
 *                                    //                  mention (optionally preceded by text).
 *                                    //
 *                                    //   `paragraph`/`bullet`/`tableRow` content supports
 *                                    //   markdown-style backtick code spans → inline_code styled.
 * }
 *
 * Response: { ok, url, docToken, transferred, fillErrors?, uiRowsDropped? }
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
      userInteractionRows?: UserInteractionRow[];
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

    let uiRowsDropped = 0;
    if (Array.isArray(body.userInteractionRows) && body.userInteractionRows.length > 0) {
      try {
        const result = await fillUserInteractionDesignTable(docToken, body.userInteractionRows, botToken);
        uiRowsDropped = result.dropped;
      } catch (e) {
        fillErrors.userInteraction = e instanceof Error ? e.message : String(e);
      }
    }

    if (Array.isArray(body.sections)) {
      for (const s of body.sections) {
        if (!s?.heading) continue;
        try {
          if (Array.isArray(s.blocks) && s.blocks.length > 0) {
            await editDocSectionAsBlocks(newUrl, s.heading, s.blocks);
          } else if (Array.isArray(s.bullets) && s.bullets.length > 0) {
            await editDocSectionAsBullets(newUrl, s.heading, s.bullets);
          } else if (s.content) {
            await editDocSection(newUrl, s.heading, s.content);
          }
        } catch (e) {
          fillErrors[`section:${s.heading}`] = e instanceof Error ? e.message : String(e);
        }

        // bulletUpdates and tableRows are independent of content/bullets/blocks
        // — they patch existing template structure (link bullets, table rows)
        // rather than replacing it. Run them after the main section fill.
        if (s.bulletUpdates) {
          for (const [prefix, value] of Object.entries(s.bulletUpdates)) {
            try {
              await updateBulletByPrefix(newUrl, s.heading, prefix, value);
            } catch (e) {
              fillErrors[`section:${s.heading}:bullet:${prefix}`] =
                e instanceof Error ? e.message : String(e);
            }
          }
        }
        if (Array.isArray(s.tableRows)) {
          for (const row of s.tableRows) {
            try {
              await fillTableRowUnderHeading(newUrl, s.heading, row.rowIndex, row.cells);
            } catch (e) {
              fillErrors[`section:${s.heading}:tableRow:${row.rowIndex}`] =
                e instanceof Error ? e.message : String(e);
            }
          }
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
      ...(uiRowsDropped > 0 ? { uiRowsDropped } : {}),
    });
  } catch (e) {
    console.error('[admin/duplicate-prd] error:', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 });
  }
}
