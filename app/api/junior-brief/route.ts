import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getPrompt, getPromptModel } from '@/lib/prompts';
import { renderPrompt, getPromptDef } from '@/lib/prompt-registry';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface NewItem { name: string; cause: string }
interface Body {
  userName?: string;
  newItems?: NewItem[];
  ongoingNames?: string[];
}

/**
 * Compose the daily Junior brief banner via Gemini.
 *
 * Stateless — the client passes the categorized items + user name,
 * the route returns a `{greeting, highlight, rest, outro}` quartet
 * that the React component renders. Caching lives client-side
 * (localStorage keyed by date + items signature) so the call only
 * fires when the inputs actually change.
 */
export async function POST(req: NextRequest) {
  let body: Body;
  try { body = await req.json() as Body; } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const userName = body.userName?.trim() || 'Thomas';
  const newItems = (body.newItems ?? []).slice(0, 6);
  const ongoingNames = (body.ongoingNames ?? []).slice(0, 12);

  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'gemini not configured' }, { status: 503 });
  }

  // Day-of-week + part-of-day in Singapore time so Gemini can pick the
  // right greeting ("Monday morning" vs "Friday afternoon").
  const sgtFormatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Singapore',
    weekday: 'long',
    hour: 'numeric',
    hour12: false,
  });
  const parts = sgtFormatter.formatToParts(new Date());
  const dayName = parts.find(p => p.type === 'weekday')?.value ?? 'today';
  const hour = Number(parts.find(p => p.type === 'hour')?.value ?? '9');
  const partOfDay = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';

  const newItemsBlock = newItems.length === 0
    ? '(none)'
    : newItems.map(i => `- ${i.name}: ${i.cause || '(no specific cause inferred)'}`).join('\n');
  const ongoingBlock = ongoingNames.length === 0
    ? '(none)'
    : ongoingNames.map(n => `- ${n}`).join('\n');

  const def = getPromptDef('hamlet.junior_brief');
  const tmpl = await getPrompt('hamlet.junior_brief', def?.default ?? '');
  const modelName = await getPromptModel('hamlet.junior_brief', def?.model ?? 'gemini-2.5-flash-lite');
  const prompt = renderPrompt(tmpl, {
    userName,
    dayName,
    partOfDay,
    newItems: newItemsBlock,
    ongoingNames: ongoingBlock,
  });

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: modelName });
    const result = await model.generateContent(prompt);
    const raw = result.response.text().trim();
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
    const parsed = JSON.parse(cleaned) as {
      greeting?: string;
      highlight?: string;
      rest?: string;
      outro?: string;
    };
    return NextResponse.json({
      greeting: (parsed.greeting ?? '').trim(),
      highlight: (parsed.highlight ?? '').trim(),
      rest: (parsed.rest ?? '').trim(),
      outro: (parsed.outro ?? '').trim(),
    });
  } catch (e) {
    console.warn('[junior-brief] Gemini failed:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'brief generation failed' },
      { status: 500 },
    );
  }
}
