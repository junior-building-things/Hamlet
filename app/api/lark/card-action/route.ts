import { NextRequest, NextResponse } from 'next/server';
import { sendInteractiveCardToChat, getLarkBotToken } from '@/lib/lark';

export const dynamic = 'force-dynamic';

/**
 * Lark interactive card callback endpoint.
 * Handles button clicks from cards sent by Junior bot.
 *
 * Lark docs: https://open.larksuite.com/document/uAjLw4CM/ukTMukTMukTM/feishu-cards/card-callback-communication
 *
 * Configure the callback URL in the Lark app settings under
 * "Events and callbacks" → "Card callback" → paste this URL.
 */
export async function POST(req: NextRequest) {
  const body = await req.json() as {
    // URL verification challenge
    type?: string;
    challenge?: string;
    token?: string;
    // Card action payload (action button clicked)
    action?: { value?: Record<string, unknown>; tag?: string };
    // V2 event wrapper
    event?: { action?: { value?: Record<string, unknown> } };
    schema?: string;
  };

  // Initial URL verification challenge — echo the challenge back
  if (body.type === 'url_verification' && body.challenge) {
    return NextResponse.json({ challenge: body.challenge });
  }

  // Handle action button click (v1 or v2 payload shape)
  const actionValue = body.action?.value ?? body.event?.action?.value;
  const action = typeof actionValue?.action === 'string' ? actionValue.action : '';

  if (action === 'send_prd_change_to_group') {
    const chatId = String(actionValue?.chatId ?? '');
    const featureName = String(actionValue?.featureName ?? '');
    const prdUrl = String(actionValue?.prdUrl ?? '');
    const summary = String(actionValue?.summary ?? '');

    if (!chatId) {
      return NextResponse.json({ error: 'missing chatId' }, { status: 400 });
    }

    try {
      const token = await getLarkBotToken();
      const cardTitle = `📝 PRD Updated — ${featureName}`;
      const sections = [
        {
          content: `**${featureName}** ([PRD](${prdUrl}))\n  • ${summary}`,
        },
      ];
      await sendInteractiveCardToChat(chatId, cardTitle, 'blue', sections, token);
      console.log(`[card-action] sent PRD change to feature group ${chatId}: "${featureName}"`);

      // Return a toast response so the user sees confirmation
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

  // Unknown action — just acknowledge
  return NextResponse.json({ ok: true });
}
