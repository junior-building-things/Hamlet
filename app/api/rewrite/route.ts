import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getPrompt } from '@/lib/prompts';
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

    const apiKey = process.env.GOOGLE_AI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'GOOGLE_AI_API_KEY not set' }, { status: 500 });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite-preview' });

    const promptId = field === 'name' ? 'hamlet.rewrite_name' : 'hamlet.rewrite_description';
    const def = getPromptDef(promptId);
    const tmpl = await getPrompt(promptId, def?.default ?? '');
    const prompt = renderPrompt(tmpl, { text: text.trim() });

    const result = await model.generateContent(prompt);
    const rewritten = result.response.text().trim();

    return NextResponse.json({ rewritten });
  } catch (err) {
    console.error('Rewrite error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Rewrite failed' },
      { status: 500 },
    );
  }
}
