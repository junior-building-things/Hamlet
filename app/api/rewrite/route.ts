import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

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

    const prompt = field === 'name'
      ? `You are a senior product manager at TikTok. Rewrite this feature name to be intuitive, simple, and focused on the user's perspective. It should clearly describe what the user can do.

Example: "Add an entrance on the Comment panel to open up the sticker creation flow" → "Enable users to create stickers from Comments"

Feature name: "${text.trim()}"

Return ONLY the rewritten feature name, nothing else. No quotes, no explanation.`
      : `You are a senior product manager at TikTok writing a PRD. Rewrite this feature description into a clear, professional "What are we building" section. Keep it concise (2-4 sentences), focused on the user value and what will be delivered.

Feature description: "${text.trim()}"

Return ONLY the rewritten description, nothing else. No quotes, no explanation.`;

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
