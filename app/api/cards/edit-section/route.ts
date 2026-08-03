import { NextRequest, NextResponse } from 'next/server';
import { loadDigestState, saveDigestState } from '@/lib/digest-state';
import {
  buildInteractiveCardContent,
  patchInteractiveCard,
  getLarkBotToken,
  extractSectionImageTokens,
  uploadDocImageForMessage,
  resolveDocIdFromUrl,
  refreshUserToken,
  CardSection,
  CardButton,
  PostParagraph,
  PostInline,
} from '@/lib/lark';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// Section-heading aliases to look under when attaching a doc's image to a
// card. AB reports lead with a "Background" screenshot; PRDs use the
// "what we are building" phrasing.
const IMAGE_SECTION_ALIASES = [
  'background',
  'what we are building', 'what we are building?',
  'what are we building', 'what are we building?',
  'what we are building and why', 'what are we building and why',
];

// Owner open_id used for the trailing "cc @Thomas" mention on the
// AB-open / AB-concluded posts. Must stay in sync with
// AB_OPEN_MENTION_OPEN_ID in lib/digests.ts.
const AB_OPEN_MENTION_OPEN_ID = 'ou_1e7fa98f1e46311d8a5e4554dc7a668e';

/**
 * Apply an edit to one feature section of an AB-open or AB-concluded
 * card and patch the card back into Lark.
 *
 * Body:
 *   {
 *     cardMsgId: string,            // the original card message_id
 *     featureWorkItemId: string,    // which feature section to edit
 *     newCardContent?: string,      // new lark_md body (omit to keep current)
 *     attachImageDocUrl?: string,   // pull image(s) from this doc and add to
 *                                   //   the card (defaults to the section's
 *                                   //   heading; see attachImageSection)
 *     attachImageSection?: string,  // heading to look under (default: the
 *                                   //   Background / "what we're building" set)
 *   }
 *
 * At least one of newCardContent / attachImageDocUrl is required.
 *
 * The "Send to PM Group" button payload uses postParagraphs (rich text).
 * We re-derive postParagraphs from the new cardContent so the post stays
 * in sync with the visible card.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      cardMsgId?: string;
      featureWorkItemId?: string;
      newCardContent?: string;
      attachImageDocUrl?: string;
      attachImageSection?: string;
    };
    const cardMsgId = String(body.cardMsgId ?? '');
    const featureWorkItemId = String(body.featureWorkItemId ?? '');
    const attachImageDocUrl = body.attachImageDocUrl?.trim();
    if (!cardMsgId || !featureWorkItemId) {
      return NextResponse.json({ error: 'missing fields' }, { status: 400 });
    }
    if (body.newCardContent === undefined && !attachImageDocUrl) {
      return NextResponse.json({ error: 'nothing to do: pass newCardContent and/or attachImageDocUrl' }, { status: 400 });
    }

    const state = await loadDigestState();
    const ctx = state.cardEditContexts?.[cardMsgId];
    if (!ctx) {
      return NextResponse.json({ error: 'card context not found' }, { status: 404 });
    }
    const featureIdx = ctx.features.findIndex(f => f.workItemId === featureWorkItemId);
    if (featureIdx < 0) {
      return NextResponse.json({ error: 'feature section not found in card' }, { status: 404 });
    }

    const featureSnap = ctx.features[featureIdx];
    // Keep the existing body when the caller only wants to attach an image.
    const newCardContent = body.newCardContent === undefined
      ? featureSnap.cardContent
      : String(body.newCardContent);

    // Optionally pull image(s) from a doc (e.g. the AB report) and add them
    // to this feature's image set. Merge (dedupe by image_key) so repeated
    // calls don't duplicate, and so an image attach doesn't wipe existing art.
    const mergedImages = [...featureSnap.cardImages];
    let attachedCount = 0;
    if (attachImageDocUrl) {
      const aliases = body.attachImageSection?.trim()
        ? [body.attachImageSection.trim().toLowerCase()]
        : IMAGE_SECTION_ALIASES;
      let userAccessToken: string | undefined;
      if (state.larkUserRefreshToken) {
        try {
          const refreshed = await refreshUserToken(state.larkUserRefreshToken);
          if (refreshed) {
            userAccessToken = refreshed.accessToken;
            state.larkUserRefreshToken = refreshed.refreshToken; // rotate + persist below
          }
        } catch { /* fall back to bot token for the media download */ }
      }
      const tokens = await extractSectionImageTokens(attachImageDocUrl, aliases);
      if (tokens.length === 0) {
        return NextResponse.json({ error: 'no image found under the requested section of that doc' }, { status: 404 });
      }
      const parentDocToken = await resolveDocIdFromUrl(attachImageDocUrl);
      const uploaded = await Promise.all(
        tokens.map(t => uploadDocImageForMessage(t, parentDocToken, userAccessToken)),
      );
      const existingKeys = new Set(mergedImages.map(i => i.image_key));
      for (const img of uploaded) {
        if (!img || existingKeys.has(img.image_key)) continue;
        existingKeys.add(img.image_key);
        mergedImages.push({ image_key: img.image_key });
        attachedCount++;
      }
      if (attachedCount === 0) {
        return NextResponse.json({ error: 'found image(s) but upload to Lark failed' }, { status: 500 });
      }
    }

    // Update the snapshot — both cardContent and postParagraphs.
    // Re-derive the BODY from the new markdown, then append the
    // image paragraphs (from cardImages) + the trailing cc paragraph.
    // Preserve the existing cc paragraph from the previous build so
    // any @-mentions resolved at build time (PM + POC stakeholders for
    // AB-concluded) carry through the edit instead of being reset to
    // PM-only.
    const bodyParagraphs = cardContentToPostParagraphs(newCardContent);
    const imageParagraphs: PostParagraph[] = mergedImages.map(img => [
      { tag: 'img', image_key: img.image_key } as PostInline,
    ]);
    let ccParagraph: PostParagraph = [
      { tag: 'text', text: 'cc' },
      { tag: 'at', user_id: AB_OPEN_MENTION_OPEN_ID },
    ];
    try {
      const prev = JSON.parse(featureSnap.postParagraphsJson) as PostParagraph[];
      const last = prev[prev.length - 1];
      // The build-time code always appends the cc paragraph last,
      // identifiable by containing at least one `at` tag.
      if (Array.isArray(last) && last.some(x => x.tag === 'at')) {
        ccParagraph = last;
      }
    } catch { /* fall back to PM-only */ }
    const newPostParagraphs: PostParagraph[] = [
      ...bodyParagraphs,
      ...imageParagraphs,
      ccParagraph,
    ];
    ctx.features[featureIdx] = {
      ...featureSnap,
      cardContent: newCardContent,
      cardImages: mergedImages,
      postParagraphsJson: JSON.stringify(newPostParagraphs),
    };
    state.cardEditContexts![cardMsgId] = ctx;
    await saveDigestState(state);

    // Rebuild the full card sections and patch Lark.
    const sections: CardSection[] = ctx.features.map(f => {
      let postParagraphs: PostParagraph[] = [];
      try { postParagraphs = JSON.parse(f.postParagraphsJson) as PostParagraph[]; } catch { /* ignore */ }
      const buttons: CardButton[] = [
        {
          text: 'Send to PM Group',
          type: 'primary',
          value: { action: 'send_ab_open_to_pm_group', postTitle: f.postTitle, postParagraphs },
        },
      ];
      // AB-concluded gets the extra "Send to Feature Group" button
      // (matches the build-time card layout in
      // sendAbConcludedDigestCard). AB-open keeps the original two-
      // button layout.
      if (ctx.cardKind === 'ab_concluded') {
        buttons.push({
          text: 'Send to Feature Group',
          type: 'default',
          value: {
            action: 'send_ab_concluded_to_feature_group',
            postTitle: f.postTitle,
            postParagraphs,
            featureWorkItemId: f.workItemId,
            featureName: f.featureName,
          },
        });
      }
      buttons.push({
        text: 'Edit',
        type: 'default',
        value: {
          action: 'edit_ab_card',
          cardKind: ctx.cardKind,
          featureWorkItemId: f.workItemId,
          featureName: f.featureName,
        },
      });
      return {
        content: f.cardContent,
        images: f.cardImages,
        buttons,
      };
    });

    const cardJson = buildInteractiveCardContent(ctx.headerText, ctx.headerTemplate, sections);
    const token = await getLarkBotToken();
    const ok = await patchInteractiveCard(cardMsgId, cardJson, token);
    if (!ok) {
      return NextResponse.json({ error: 'lark patch failed' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, imagesAttached: attachedCount });
  } catch (e) {
    console.warn('[cards/edit-section] error:', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'edit failed' }, { status: 500 });
  }
}

/**
 * Convert a Markdown card body (the lark_md content shown in the card)
 * into PostParagraph[] (used by the rich-text "post" message that
 * "Send to PM Group" sends). Best-effort: handles bold, links, mentions,
 * and bullet lines. Anything more complex falls back to plain text.
 */
function cardContentToPostParagraphs(md: string): PostParagraph[] {
  const lines = md.split('\n').map(l => l.trimEnd());
  const out: PostParagraph[] = [];
  for (const raw of lines) {
    if (!raw.trim()) {
      out.push([]); // blank paragraph (preserves spacing)
      continue;
    }
    out.push(parseInlineMd(raw));
  }
  // Trim trailing blank paragraphs.
  while (out.length > 0 && out[out.length - 1].length === 0) out.pop();
  return out;
}

function parseInlineMd(line: string): PostInline[] {
  const inlines: PostInline[] = [];
  let i = 0;
  const push = (s: string) => {
    if (s) inlines.push({ tag: 'text', text: s });
  };
  while (i < line.length) {
    // Bold **text**
    if (line[i] === '*' && line[i + 1] === '*') {
      const end = line.indexOf('**', i + 2);
      if (end > -1) {
        inlines.push({ tag: 'text', text: line.slice(i + 2, end), style: ['bold'] });
        i = end + 2;
        continue;
      }
    }
    // Markdown link [text](url)
    if (line[i] === '[') {
      const m = line.slice(i).match(/^\[([^\]]+)\]\(([^)]+)\)/);
      if (m) {
        inlines.push({ tag: 'a', text: m[1], href: m[2] });
        i += m[0].length;
        continue;
      }
    }
    // <at email=xxx></at>  → preserve as plain "@xxx" placeholder
    if (line.slice(i, i + 4) === '<at ') {
      const m = line.slice(i).match(/^<at\s+email=([^\s>]+)\s*><\/at>/i);
      if (m) {
        inlines.push({ tag: 'text', text: `@${m[1]}` });
        i += m[0].length;
        continue;
      }
    }
    // Plain run up to next special char.
    const candidates = [
      line.indexOf('**', i),
      line.indexOf('[', i),
      line.indexOf('<at ', i),
    ].filter(n => n > i);
    const stop = candidates.length > 0 ? Math.min(...candidates) : line.length;
    push(line.slice(i, stop));
    i = stop;
  }
  return inlines.length > 0 ? inlines : [{ tag: 'text', text: line }];
}
