import { NextRequest, NextResponse } from 'next/server';
import { sendInteractiveCardToChat, getLarkBotToken, addBotToChat, refreshUserToken, sendPostToChat, replyToMessage, readDocContent, PostParagraph } from '@/lib/lark';
import { loadDigestState, saveDigestState } from '@/lib/digest-state';
import { GoogleGenerativeAI } from '@google/generative-ai';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';


/**
 * Lark interactive card callback endpoint.
 * Handles button clicks from cards sent by Junior bot.
 *
 * Configure the callback URL in the Lark app settings under
 * "Events and callbacks" → "Card callback".
 */
export async function GET() {
  return NextResponse.json({ ok: true, hint: 'POST only' });
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  console.log('[card-action] received:', rawBody.slice(0, 500));

  let body: Record<string, unknown> = {};
  try { body = JSON.parse(rawBody); } catch { /* empty */ }

  // If the payload is encrypted, decrypt it using ENCRYPT_KEY
  if (typeof body.encrypt === 'string') {
    const encryptKey = process.env.LARK_ENCRYPT_KEY;
    if (!encryptKey) {
      console.warn('[card-action] received encrypted payload but LARK_ENCRYPT_KEY not set');
      return NextResponse.json({ error: 'encryption not configured' }, { status: 400 });
    }
    try {
      const decrypted = decryptLarkPayload(body.encrypt, encryptKey);
      body = JSON.parse(decrypted);
      console.log('[card-action] decrypted:', JSON.stringify(body).slice(0, 500));
    } catch (e) {
      console.warn('[card-action] decrypt failed:', e);
      return NextResponse.json({ error: 'decrypt failed' }, { status: 400 });
    }
  }

  // Initial URL verification challenge — echo the challenge back
  if (body.type === 'url_verification' && typeof body.challenge === 'string') {
    console.log('[card-action] challenge received, responding');
    return NextResponse.json({ challenge: body.challenge });
  }

  // Handle action button click (v1 or v2 payload shape)
  const actionV1 = body.action as { value?: Record<string, unknown> } | undefined;
  const actionV2 = (body.event as { action?: { value?: Record<string, unknown> } } | undefined)?.action;
  const actionValue = actionV1?.value ?? actionV2?.value;
  const actionName = typeof actionValue?.action === 'string' ? actionValue.action : '';

  if (actionName === 'send_prd_change_to_group') {
    const chatId = String(actionValue?.chatId ?? '');
    const featureName = String(actionValue?.featureName ?? '');
    const prdUrl = String(actionValue?.prdUrl ?? '');
    const summary = String(actionValue?.summary ?? '');
    const pocEmails = Array.isArray(actionValue?.pocEmails) ? actionValue.pocEmails as string[] : [];

    if (!chatId) {
      return NextResponse.json({ error: 'missing chatId' }, { status: 400 });
    }

    try {
      const token = await getLarkBotToken();

      // Build @mention tags by email (Lark card lark_md supports <at email=xxx>)
      console.log(`[card-action] pocEmails: ${JSON.stringify(pocEmails)}`);
      let mentions = '';
      if (pocEmails.length > 0) {
        const uniqueEmails = [...new Set(pocEmails.map(e => e.toLowerCase()))];
        mentions = uniqueEmails.map(email => `<at email=${email}></at>`).join(' ');
      }

      // Title inside body (no colored header)
      const dateStr = new Date().toLocaleDateString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric', timeZone: 'Asia/Singapore',
      });

      // Interactive card body: title heading + inline clickable feature name + bold summary + @mentions
      const bodyLines = [
        `**📝 PRD Update - ${dateStr}**`,
        ``,
        `PM made an update to the PRD [${featureName}](${prdUrl}):`,
        `- **${summary}**`,
      ];
      if (mentions) {
        bodyLines.push('');
        bodyLines.push(`Please take note ${mentions}`);
      }
      const sections = [{ content: bodyLines.join('\n') }];

      // Ensure the bot is a member of the chat before sending.
      let userAccessToken: string | undefined;
      try {
        const state = await loadDigestState();
        const refresh = state.larkUserRefreshToken || process.env.LARK_USER_REFRESH_TOKEN;
        if (refresh) {
          const result = await refreshUserToken(refresh);
          if (result) {
            userAccessToken = result.accessToken;
            state.larkUserRefreshToken = result.refreshToken;
            await saveDigestState(state);
          }
        }
      } catch { /* ignore */ }
      await addBotToChat(chatId, userAccessToken);
      const msgId = await sendInteractiveCardToChat(chatId, '', 'blue', sections, token);
      if (!msgId) {
        return NextResponse.json({
          toast: { type: 'error', content: 'Failed to send — bot may not have access' },
        }, { status: 500 });
      }
      console.log(`[card-action] sent PRD change to feature group ${chatId}: "${featureName}" (${pocEmails.length} POCs)`);

      return NextResponse.json({
        toast: { type: 'success', content: 'Sent to feature group ✓' },
      });
    } catch (e) {
      console.warn('[card-action] send PRD change failed:', e);
      return NextResponse.json({
        toast: { type: 'error', content: 'Failed to send' },
      }, { status: 500 });
    }
  }

  if (actionName === 'send_ab_open_to_pm_group') {
    // postTitle may be empty by design — the bolded lead paragraph
    // serves as the visual title. Only postParagraphs is required.
    const postTitle = String(actionValue?.postTitle ?? '');
    const postParagraphs = Array.isArray(actionValue?.postParagraphs)
      ? (actionValue.postParagraphs as PostParagraph[])
      : null;
    if (!postParagraphs || postParagraphs.length === 0) {
      console.warn(`[card-action] missing postParagraphs (titleLen=${postTitle.length})`);
      return NextResponse.json({
        toast: { type: 'error', content: 'Missing post payload' },
      });
    }
    // Currently sends to the personal group (testing mode). Flip to
    // the real PM group oc_ea2940122b041a9c9ee4153596d6a15c when ready.
    const targetChatId = 'oc_d1f9b0ad6b325ef6699e0422fa1e8541';
    try {
      const botToken = await getLarkBotToken();
      const id = await sendPostToChat(targetChatId, postTitle, postParagraphs, botToken);
      if (!id) {
        return NextResponse.json({
          toast: { type: 'error', content: 'Failed to send — bot may not be in chat' },
        }, { status: 500 });
      }
      console.log(`[card-action] sent AB-open post to ${targetChatId}: msg_id=${id}`);
      return NextResponse.json({
        toast: { type: 'success', content: 'Sent ✓' },
      });
    } catch (e) {
      console.warn('[card-action] send AB-open failed:', e);
      return NextResponse.json({
        toast: { type: 'error', content: 'Failed to send' },
      }, { status: 500 });
    }
  }

  if (actionName === 'letjr_reply') {
    const featureName = String(actionValue?.featureName ?? '');
    const prdUrl = String(actionValue?.prdUrl ?? '');
    const chatId = String(actionValue?.chatId ?? '');
    const questionText = String(actionValue?.questionText ?? '');
    const askerOpenId = String(actionValue?.askerOpenId ?? '');
    const questionSource = String(actionValue?.questionSource ?? '');
    const commentId = String(actionValue?.commentId ?? '');
    const chatMessageId = String(actionValue?.chatMessageId ?? '');

    if (!questionText) {
      return NextResponse.json({ toast: { type: 'error', content: 'Missing question' } });
    }

    // Lark card callbacks have a ~3s response budget — readDocContent
    // + Gemini + replyToMessage easily takes 10-30s. Kick the heavy
    // work off as a fire-and-forget background promise and respond
    // immediately so the user sees a "Drafting…" toast instead of
    // Lark's "200340 timed out" error. Cloud Run keeps the container
    // alive long enough for the promise to finish.
    const eventCtx = (body.event as { context?: { open_message_id?: string } } | undefined)?.context;
    const parentMessageId = eventCtx?.open_message_id ?? '';
    if (!parentMessageId) {
      console.warn('[card-action] letjr_reply: no parent message_id in event context');
      return NextResponse.json({ toast: { type: 'error', content: 'No parent message' } });
    }

    void (async () => {
      try {
        let prdContent = '';
        if (prdUrl) {
          try { prdContent = await readDocContent(prdUrl); }
          catch (e) { console.warn('[card-action] letjr_reply: PRD read failed:', e); }
        }
        const apiKey = process.env.GOOGLE_AI_API_KEY;
        let replyText = '_(Couldn\'t generate a reply — Gemini not configured)_';
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
              prdContent: prdContent.slice(0, 8000) || '(PRD not available)',
            });
            const genAI = new GoogleGenerativeAI(apiKey);
            const model = genAI.getGenerativeModel({ model: modelName });
            const result = await model.generateContent(prompt);
            replyText = result.response.text().trim();
          } catch (e) {
            console.warn('[card-action] letjr_reply: Gemini failed:', e);
          }
        }
        const botToken = await getLarkBotToken();
        const proposal = `${replyText}\n\nLooks ok? React with 👍 and I'll send it.`;
        const proposalMsgId = await replyToMessage(parentMessageId, proposal, botToken);
        if (!proposalMsgId) {
          console.warn('[card-action] letjr_reply: replyToMessage returned null');
          return;
        }
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
          console.warn('[card-action] letjr_reply: state save failed:', e);
        }
        console.log(`[card-action] letjr_reply drafted for "${featureName}" — proposal msg_id=${proposalMsgId}`);
      } catch (e) {
        console.warn('[card-action] letjr_reply background work failed:', e);
      }
    })();

    return NextResponse.json({ toast: { type: 'success', content: 'Drafting…' } });
  }

  console.log('[card-action] no matching action:', actionName, 'type:', body.type, 'bodyKeys:', Object.keys(body).join(','));
  return NextResponse.json({ ok: true });
}

function decryptLarkPayload(encrypt: string, encryptKey: string): string {
  // Lark encrypts payloads using AES-256-CBC.
  // Key = SHA256(encryptKey), IV = first 16 bytes of ciphertext
  const buf = Buffer.from(encrypt, 'base64');
  const iv = buf.subarray(0, 16);
  const ciphertext = buf.subarray(16);
  const key = crypto.createHash('sha256').update(encryptKey).digest();
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}
