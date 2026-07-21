import { NextRequest, NextResponse } from 'next/server';
import { generateText } from '@/lib/llm';
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
 * Compose the daily Junior brief banner via the Claude CLI.
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
  // We deliberately don't pass the ongoing feature NAMES into the
  // prompt — only the count. The model was ignoring "don't list them"
  // instructions and surfacing the names anyway; passing just the
  // count makes the rule physically enforceable.
  const ongoingCount = (body.ongoingNames ?? []).length;

  // Day-of-week + part-of-day in Singapore time so the model can pick the
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
  const ongoingCountBlock = String(ongoingCount);

  const def = getPromptDef('hamlet.junior_brief');
  const tmpl = await getPrompt('hamlet.junior_brief', def?.default ?? '');
  const modelName = await getPromptModel('hamlet.junior_brief', def?.model ?? 'claude-sonnet-5');
  const prompt = renderPrompt(tmpl, {
    userName,
    dayName,
    partOfDay,
    newItems: newItemsBlock,
    ongoingCount: ongoingCountBlock,
  });

  try {
    const raw = (await generateText(prompt, { model: modelName, label: 'junior-brief' })).trim();
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
    console.warn('[junior-brief] generation failed:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'brief generation failed' },
      { status: 500 },
    );
  }
}
