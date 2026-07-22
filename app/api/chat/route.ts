import { NextRequest, NextResponse } from 'next/server';
import { generateText } from '@/lib/llm';
import { getPrompt } from '@/lib/prompts';
import { getPromptDef } from '@/lib/prompt-registry';
import { listContextFiles } from '@/lib/junior-context';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

interface ChatMsg { role: 'user' | 'assistant'; content: string }

// The chat tab is a single conversational call — Junior's chat system prompt
// plus its GCS context files (the "ADDITIONAL CONTEXT block" that prompt
// refers to), run through the Claude CLI on opus-4.8 / high effort.
//
// It is deliberately NOT the old intent-classify → /api/chat/execute pipeline:
// this surface answers and advises from the injected context, it does not take
// tool actions (create feature/PRD, complete node, live Meego lookups). Those
// still run through Junior in Lark.
const CHAT_MODEL = 'claude-opus-4-8';
const CHAT_EFFORT = 'high';

/** Assemble the Junior context markdown into the ADDITIONAL CONTEXT block. */
async function buildContextBlock(): Promise<string> {
  try {
    const files = await listContextFiles();
    if (files.length === 0) return '';
    const blocks = files
      .map(f => `--- ${f.name} ---\n${f.content.trim()}`)
      .join('\n\n');
    return `\n\nADDITIONAL CONTEXT:\n${blocks}`;
  } catch (e) {
    console.warn('[chat] failed to load context files:', e);
    return '';
  }
}

export async function POST(req: NextRequest) {
  let body: { messages?: ChatMsg[]; userMessage?: string };
  try {
    body = await req.json() as { messages?: ChatMsg[]; userMessage?: string };
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const userMessage = body.userMessage?.trim();
  if (!userMessage) return NextResponse.json({ error: 'userMessage is required' }, { status: 400 });

  const def = getPromptDef('junior.system_prompt');
  const systemPrompt = await getPrompt('junior.system_prompt', def?.default ?? '');
  const contextBlock = await buildContextBlock();

  // Keep the transcript bounded — the recent turns carry the thread; the
  // system prompt + context carry everything durable.
  const history = (body.messages ?? [])
    .filter(m => m.content?.trim())
    .slice(-12)
    .map(m => `${m.role === 'user' ? 'User' : 'Junior'}: ${m.content}`)
    .join('\n');

  const prompt =
    `${systemPrompt}${contextBlock}\n\n` +
    `You are chatting in the Hamlet web app (not Lark). Reply in plain conversational text.\n\n` +
    (history ? `Conversation so far:\n${history}\n\n` : '') +
    `User: ${userMessage}\nJunior:`;

  try {
    const reply = (await generateText(prompt, {
      model: CHAT_MODEL,
      effort: CHAT_EFFORT,
      label: 'chat',
    })).trim();
    return NextResponse.json({ reply: reply || "Sorry, I didn't catch that — could you rephrase?" });
  } catch (e) {
    console.error('[chat] generation failed:', e instanceof Error ? e.message : e);
    return NextResponse.json(
      { reply: 'Something went wrong generating a reply. Please try again.' },
      { status: 500 },
    );
  }
}
