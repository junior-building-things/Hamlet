import { NextRequest, NextResponse } from 'next/server';
import { generateText } from '@/lib/llm';
import { getPrompt, getPromptModel } from '@/lib/prompts';
import { getPromptDef, renderPrompt } from '@/lib/prompt-registry';

export async function POST(req: NextRequest) {
  try {
    const { text, field } = await req.json() as { text?: string; field?: 'name' | 'description' };
    if (!text?.trim()) {
      return NextResponse.json({ error: 'text is required' }, { status: 400 });
    }
    if (field !== 'name' && field !== 'description') {
      return NextResponse.json({ error: 'field must be "name" or "description"' }, { status: 400 });
    }

    const promptId = field === 'name' ? 'hamlet.rewrite_name' : 'hamlet.rewrite_description';
    const def = getPromptDef(promptId);
    const modelName = await getPromptModel(promptId, def?.model ?? 'claude-sonnet-5');

    const tmpl = await getPrompt(promptId, def?.default ?? '');
    const prompt = renderPrompt(tmpl, { text: text.trim() });

    const rewritten = (await generateText(prompt, { model: modelName, label: 'rewrite' })).trim();

    return NextResponse.json({ rewritten });
  } catch (err) {
    console.error('Rewrite error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Rewrite failed' },
      { status: 500 },
    );
  }
}
