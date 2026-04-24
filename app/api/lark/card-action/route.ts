import { NextRequest, NextResponse } from 'next/server';
import { sendInteractiveCardToChat, getLarkBotToken, resolveOpenIds, PM_GROUP_CHAT_ID } from '@/lib/lark';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

function escapeMd(text: string): string {
  // Escape lark_md special chars that could break formatting
  return text.replace(/([*_`\\])/g, '\\$1');
}

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
    // TEMP: send to PM group chat instead of feature group for verification
    const TEST_MODE_SEND_TO_PM_GROUP = true;
    const featureChatId = String(actionValue?.chatId ?? '');
    const chatId = TEST_MODE_SEND_TO_PM_GROUP ? PM_GROUP_CHAT_ID : featureChatId;
    const featureName = String(actionValue?.featureName ?? '');
    const prdUrl = String(actionValue?.prdUrl ?? '');
    const summary = String(actionValue?.summary ?? '');
    const pocEmails = Array.isArray(actionValue?.pocEmails) ? actionValue.pocEmails as string[] : [];

    if (!chatId) {
      return NextResponse.json({ error: 'missing chatId' }, { status: 400 });
    }

    try {
      const token = await getLarkBotToken();

      // Resolve POC emails → open_ids → build @mention tags (deduped by id)
      let mentionsLine = '';
      if (pocEmails.length > 0) {
        const emailToOpenId = await resolveOpenIds(pocEmails, token);
        const uniqueOpenIds = [...new Set(Object.values(emailToOpenId))].filter(Boolean);
        const mentions = uniqueOpenIds.map(openId => `<at id=${openId}></at>`).join(' ');
        if (mentions) mentionsLine = `\n\nPlease take note ${mentions}`;
      }

      // Header: 📝 PRD Update - Fri, Apr 24
      const dateStr = new Date().toLocaleDateString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric', timeZone: 'Asia/Singapore',
      });
      const cardTitle = `📝 PRD Update - ${dateStr}`;

      // Body: PM made an update to the PRD <Feature Name (clickable → PRD)>:
      //       • **<summary>**
      //       Please take note @tech @server @android @ios @qa @da
      const sections = [
        {
          content: `PM made an update to the PRD [${escapeMd(featureName)}](${prdUrl}):\n\n- **${escapeMd(summary)}**${mentionsLine}`,
        },
      ];
      await sendInteractiveCardToChat(chatId, cardTitle, 'blue', sections, token);
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

  console.log('[card-action] no matching action:', actionName, 'type:', body.type);
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
