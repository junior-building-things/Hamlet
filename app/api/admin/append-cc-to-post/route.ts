import { NextRequest, NextResponse } from 'next/server';
import { getLarkBotToken } from '@/lib/lark';
import { loadDigestState } from '@/lib/digest-state';

export const dynamic = 'force-dynamic';

const AGENT_RUN_SECRET = process.env.AGENT_RUN_SECRET;
const LARK_BASE_URL = 'https://open.larksuite.com';

/**
 * One-off helper: fetch a Lark `post` message by msg_id, optionally
 * append image paragraphs (pulled from a saved cardEditContexts
 * snapshot), then a trailing "cc @<openId>" paragraph, and PATCH
 * the message back.
 *
 * Body: {
 *   msgId: string,
 *   mentionOpenId: string,
 *   cardMsgIdForImages?: string,    // pull images from this saved card snapshot
 *   featureWorkItemId?: string,     // optional: limit to this feature's images
 * }
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
      msgId?: string;
      mentionOpenId?: string;
      cardMsgIdForImages?: string;
      featureWorkItemId?: string;
    };
    const msgId = String(body.msgId ?? '');
    const mentionOpenId = String(body.mentionOpenId ?? '');
    const cardMsgIdForImages = body.cardMsgIdForImages ? String(body.cardMsgIdForImages) : '';
    const featureWorkItemId = body.featureWorkItemId ? String(body.featureWorkItemId) : '';
    if (!msgId || !mentionOpenId) {
      return NextResponse.json({ error: 'missing msgId or mentionOpenId' }, { status: 400 });
    }

    // Optional: pull image_keys from a saved card snapshot.
    const imageKeys: string[] = [];
    if (cardMsgIdForImages) {
      const state = await loadDigestState();
      const ctx = state.cardEditContexts?.[cardMsgIdForImages];
      if (ctx) {
        const features = featureWorkItemId
          ? ctx.features.filter(f => f.workItemId === featureWorkItemId)
          : ctx.features;
        for (const f of features) {
          for (const img of f.cardImages) imageKeys.push(img.image_key);
        }
      }
    }

    const token = await getLarkBotToken();

    // 1. Fetch the message.
    const getRes = await fetch(`${LARK_BASE_URL}/open-apis/im/v1/messages/${msgId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const getData = await getRes.json() as {
      code: number;
      msg?: string;
      data?: { items?: Array<{ msg_type?: string; body?: { content?: string } }> };
    };
    if (getData.code !== 0) {
      return NextResponse.json({ error: `Lark get failed: ${getData.code} ${getData.msg}` }, { status: 500 });
    }
    const msg = getData.data?.items?.[0];
    if (!msg) return NextResponse.json({ error: 'message not found' }, { status: 404 });
    if (msg.msg_type !== 'post') {
      return NextResponse.json({ error: `expected post, got ${msg.msg_type}` }, { status: 400 });
    }

    // 2. Parse the post content. Lark stores it as a JSON-encoded
    //    string keyed by locale: { zh_cn: { title, content: [[inline...]] } }
    //    or { en_us: { ... } }. Locate the first locale block.
    const rawContent = msg.body?.content ?? '{}';
    const parsed = JSON.parse(rawContent) as Record<string, { title?: string; content?: unknown[][] }>;
    const localeKey = Object.keys(parsed)[0];
    if (!localeKey) {
      return NextResponse.json({ error: 'no locale block in post' }, { status: 400 });
    }
    const block = parsed[localeKey];
    const content: unknown[][] = (block.content ?? []) as unknown[][];

    // 3. Append image paragraphs (one per image_key) then the cc@Thomas paragraph.
    for (const image_key of imageKeys) {
      content.push([{ tag: 'img', image_key }]);
    }
    content.push([
      { tag: 'text', text: 'cc' },
      { tag: 'at', user_id: mentionOpenId },
    ]);
    parsed[localeKey] = { ...block, content };

    // 4. PATCH it back.
    const patchRes = await fetch(`${LARK_BASE_URL}/open-apis/im/v1/messages/${msgId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: JSON.stringify(parsed) }),
    });
    const patchData = await patchRes.json() as { code: number; msg?: string };
    if (patchData.code !== 0) {
      return NextResponse.json({ error: `Lark patch failed: ${patchData.code} ${patchData.msg}` }, { status: 500 });
    }

    return NextResponse.json({ ok: true, paragraphs: content.length, imagesAdded: imageKeys.length });
  } catch (e) {
    console.error('[admin/append-cc-to-post] error:', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 });
  }
}
