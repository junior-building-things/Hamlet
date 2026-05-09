import { NextRequest, NextResponse } from 'next/server';
import {
  readDocContent,
  resolveOpenIds,
  getLarkBotToken,
  sendTextMessage,
} from '@/lib/lark';
import { loadDigestState, saveDigestState } from '@/lib/digest-state';
import { readFeatureCache } from '@/lib/feature-cache';
import { GoogleGenerativeAI } from '@google/generative-ai';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const AGENT_RUN_SECRET = process.env.AGENT_RUN_SECRET;

// Where the proposal lands for Thomas to 👍 — currently the personal
// digest chat. Same chat used elsewhere for AB-open / digest cards.
const PROPOSAL_CHAT_ID = 'oc_d1f9b0ad6b325ef6699e0422fa1e8541';

// Owner open_id used for the trailing cc tag on previews. Matches
// AB_OPEN_MENTION_OPEN_ID elsewhere.
const OWNER_OPEN_ID = 'ou_1e7fa98f1e46311d8a5e4554dc7a668e';

/**
 * Fire the letjr_reply draft+propose flow programmatically (no card
 * button click). Used by Junior when a tracked PRD comment thread
 * gets a new reply from someone other than the bot — Junior calls
 * this with the new question text + thread refs and a proposal lands
 * in Thomas's personal chat for 👍 confirmation.
 *
 * Body:
 *   {
 *     featureName: string,
 *     prdUrl: string,
 *     commentId: string,           // Lark drive comment thread id
 *     askerOpenId: string,         // who asked the new follow-up
 *     questionText: string,        // the new follow-up text
 *     questionSource?: 'prd_comment' | 'chat',
 *     chatMessageId?: string,      // for chat-source questions
 *     chatId?: string,             // for chat-source questions
 *   }
 */
export async function POST(req: NextRequest) {
  if (AGENT_RUN_SECRET) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${AGENT_RUN_SECRET}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }
  try {
    const body = await req.json() as {
      featureName?: string;
      prdUrl?: string;
      commentId?: string;
      askerOpenId?: string;
      questionText?: string;
      questionSource?: 'prd_comment' | 'chat';
      chatMessageId?: string;
      chatId?: string;
    };
    const featureName = String(body.featureName ?? '');
    const prdUrl = String(body.prdUrl ?? '');
    const commentId = String(body.commentId ?? '');
    const askerOpenId = String(body.askerOpenId ?? '');
    const questionText = String(body.questionText ?? '');
    const questionSource = (body.questionSource ?? 'prd_comment') as 'prd_comment' | 'chat';
    const chatMessageId = body.chatMessageId ? String(body.chatMessageId) : '';
    const chatId = body.chatId ? String(body.chatId) : '';

    if (!featureName || !questionText) {
      return NextResponse.json({ error: 'missing featureName or questionText' }, { status: 400 });
    }

    // Read PRD (best-effort).
    let prdContent = '';
    if (prdUrl) {
      try { prdContent = await readDocContent(prdUrl); }
      catch (e) { console.warn('[letjr-draft] PRD read failed:', e); }
    }

    // Pull feature context + PM open_id from the Hamlet cache.
    let featureContext = '(no feature context available)';
    let pmOpenId = '';
    let pmName = '';
    try {
      const cache = await readFeatureCache();
      const f = cache?.features.find(c =>
        (prdUrl && c.prd === prdUrl) || (chatId && c.chatId === chatId),
      );
      if (f) {
        featureContext = formatFeatureContext(f);
        if (f.pmOwner) {
          pmName = f.pmOwner.split(',')[0].trim();
          const pmEmail = f.pocEmails?.[pmName];
          if (pmEmail) {
            const tokenForResolve = await getLarkBotToken();
            const map = await resolveOpenIds([pmEmail], tokenForResolve);
            pmOpenId = map[pmEmail] ?? '';
          }
        }
      }
    } catch (e) {
      console.warn('[letjr-draft] feature cache lookup failed:', e);
    }

    // Run Gemini.
    const apiKey = process.env.GOOGLE_AI_API_KEY;
    let replyText = '_(Couldnt generate a reply — Gemini not configured)_';
    if (apiKey) {
      try {
        const { getPrompt, getPromptModel } = await import('@/lib/prompts');
        const { renderPrompt, getPromptDef } = await import('@/lib/prompt-registry');
        const promptDef = getPromptDef('hamlet.letjr_reply');
        const template = await getPrompt('hamlet.letjr_reply', promptDef?.default ?? '');
        const modelName = await getPromptModel('hamlet.letjr_reply', promptDef?.model ?? 'gemini-2.5-flash-lite');
        const prompt = renderPrompt(template, {
          featureName,
          sourceLabel: questionSource === 'prd_comment' ? 'PRD comment' : 'feature group chat',
          questionText,
          prdContent: prdContent || '(PRD not available)',
          featureContext,
          pmOpenId,
          pmName,
        });
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent(prompt);
        replyText = result.response.text().trim();
      } catch (e) {
        console.warn('[letjr-draft] Gemini failed:', e);
      }
    }

    // Build the proposal preview body. Top-level message in Thomas's
    // personal chat (no card to thread off here).
    const askerTag = askerOpenId && askerOpenId.startsWith('ou_')
      ? `<at user_id="${askerOpenId}"></at> `
      : '';
    const ownerTag = `<at user_id="${OWNER_OPEN_ID}"></at>`;
    const header = questionSource === 'prd_comment'
      ? `📝 ${ownerTag} New PRD comment on **${featureName}**`
      : `💬 ${ownerTag} New chat question for **${featureName}**`;
    const proposal = `${header}\n\n${askerTag}${replyText}\n\nLooks ok? React with 👍 and I'll send it.`;

    const botToken = await getLarkBotToken();
    const proposalMsgId = await sendTextMessage(PROPOSAL_CHAT_ID, proposal, botToken);
    if (!proposalMsgId) {
      return NextResponse.json({ error: 'failed to post proposal' }, { status: 500 });
    }

    // Save pending entry so the 👍 consume path can fire the actual send.
    try {
      const state = await loadDigestState();
      if (!state.pendingLetJrReplies) state.pendingLetJrReplies = {};
      state.pendingLetJrReplies[proposalMsgId] = {
        replyText,
        askerOpenId,
        destination: questionSource === 'prd_comment' ? 'prd_comment' : 'chat',
        prdUrl: prdUrl || undefined,
        commentId: commentId || undefined,
        chatId: chatId || undefined,
        chatParentMessageId: chatMessageId || undefined,
        proposedAtIso: new Date().toISOString(),
      };
      await saveDigestState(state);
    } catch (e) {
      console.warn('[letjr-draft] state save failed:', e);
    }

    console.log(`[letjr-draft] proposal posted msg=${proposalMsgId} for feature="${featureName}" source=${questionSource}`);
    return NextResponse.json({ ok: true, proposalMsgId });
  } catch (e) {
    console.error('[letjr-draft] error:', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 });
  }
}

/** Same shape as in app/api/lark/card-action/route.ts. */
function formatFeatureContext(f: import('@/lib/types').Feature): string {
  const lines: string[] = [];
  lines.push(`Name: ${f.name}`);
  if (f.status) lines.push(`Status: ${f.status}`);
  if (f.priority) lines.push(`Priority: ${f.priority}`);
  if (f.iosVersion) lines.push(`Version: ${f.iosVersion}`);
  if (f.versionHistory?.length) lines.push(`Version History: ${f.versionHistory.join(' → ')}`);
  if (f.versionChanges?.length) {
    lines.push(`Risk: Delayed (${f.versionChanges.map(c => `${c.date}: ${c.from}→${c.to}`).join('; ')})`);
  } else if (f.riskLevel) {
    lines.push(`Risk: ${f.riskLevel === 'red' ? 'High' : f.riskLevel === 'yellow' ? 'Medium' : 'Low'}`);
  }
  if (f.riskNotes?.length) lines.push(`Risk Notes: ${f.riskNotes.join(', ')}`);
  if (f.pmOwner)         lines.push(`PM: ${f.pmOwner}`);
  if (f.techOwner)       lines.push(`Tech Owner: ${f.techOwner}`);
  if (f.iosOwner)        lines.push(`iOS: ${f.iosOwner}`);
  if (f.androidOwner)    lines.push(`Android: ${f.androidOwner}`);
  if (f.serverOwner)     lines.push(`Server: ${f.serverOwner}`);
  if (f.qaOwner)         lines.push(`QA: ${f.qaOwner}`);
  if (f.uiuxOwner)       lines.push(`UX: ${f.uiuxOwner}`);
  if (f.daOwner)         lines.push(`DS: ${f.daOwner}`);
  if (f.contentDesigner) lines.push(`Content Designer: ${f.contentDesigner}`);
  if (f.figmaUrl)      lines.push(`Figma: ${f.figmaUrl}`);
  if (f.libraUrl)      lines.push(`Libra: ${f.libraUrl}`);
  if (f.abReportUrl)   lines.push(`AB Report: ${f.abReportUrl}`);
  if (f.complianceUrl) lines.push(`Compliance: ${f.complianceUrl}`);
  if (f.meegoUrl)      lines.push(`Meego: ${f.meegoUrl}`);
  if (f.notes)         lines.push(`Notes: ${f.notes}`);
  if (f.meegoComments?.length) {
    lines.push('');
    lines.push(`Recent Meego comments:`);
    for (const c of f.meegoComments.slice(-5)) {
      const body = c.content.length > 200 ? `${c.content.slice(0, 200)}…` : c.content;
      lines.push(`  - ${c.createdAt} ${c.author}: ${body}`);
    }
  }
  return lines.join('\n');
}
