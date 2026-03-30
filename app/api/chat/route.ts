import { NextRequest, NextResponse } from 'next/server';
import { getClaudeClient } from '@/lib/claude';

// ── Types ──────────────────────────────────────────────────────────────────────

interface ChatMsg { role: 'user' | 'assistant'; content: string }
interface Intent {
  action: 'create_feature' | 'create_prd' | 'update_prd' | 'complete_node' | 'query_meego' | 'chat' | 'unsupported';
  params: { featureName?: string; featureId?: string; nodeName?: string; section?: string; content?: string; query?: string };
  reply: string;
}

// ── System prompt ──────────────────────────────────────────────────────────────

const SYSTEM = `You are Hamlet, a friendly AI assistant that helps manage features for TikTok PM.

Classify the user's message into one of these actions:
1. create_feature   – User wants to create a new feature  (needs: featureName)
2. create_prd       – User wants to create a PRD for a feature  (needs: featureName or featureId)
3. update_prd       – User wants to update a PRD section        (needs: featureName or featureId, section, content)
4. complete_node    – User wants to mark a workflow node done    (needs: featureName or featureId, nodeName)
5. query_meego      – User asks a question about a specific feature that requires live data: who owns a node, what is the status of a node, who is on the team, what nodes are in progress, etc. (needs: featureName or featureId, query)
6. chat             – General conversation, greetings, questions, small talk, or requests for clarification
7. unsupported      – User is asking for a SPECIFIC action that is not in the list above (e.g. "create a compliance ticket", "send an email")

Respond with ONLY valid JSON — no markdown fences, no extra text:
{
  "action": "create_feature|create_prd|update_prd|complete_node|query_meego|chat|unsupported",
  "params": {
    "featureName": "exact name if mentioned",
    "featureId": "numeric Meego ID if mentioned",
    "nodeName": "e.g. Tech Assessment, iOS Development, Requirements Prep",
    "section": "PRD section heading for update_prd",
    "content": "new text for update_prd",
    "query": "the user's exact question verbatim, for query_meego"
  },
  "reply": "warm, natural response"
}

Rules:
- Use "chat" for greetings, thanks, questions about what you can do, or anything conversational — reply naturally and helpfully
- Use "query_meego" whenever the user asks a question about a named feature that could be answered with live Meego data — always prefer this over "chat" for feature-specific questions
- Use "unsupported" ONLY when the user asks for a specific task you cannot perform — reply EXACTLY: "Sorry, I haven't learned how to do that yet 😞. Anything else I can help you with?"
- If required info is missing for an action, use "chat" and ask for the missing info in the reply
- For create_feature: start reply with "Creating '[name]' in Meego…"
- For create_prd: start reply with "Creating a PRD for '[name]'…"
- For complete_node: start reply with "Marking '[nodeName]' as complete…"
- For query_meego: start reply with "Let me look that up in Meego…"`;

// ── Actionable intents that trigger a two-phase response ──────────────────────

const ACTIONABLE = new Set(['create_feature', 'create_prd', 'complete_node', 'query_meego']);

function isReady(intent: Intent): boolean {
  const { action, params } = intent;
  if (action === 'create_feature') return !!params.featureName;
  if (action === 'create_prd')     return !!(params.featureName || params.featureId);
  if (action === 'complete_node')  return !!(params.featureName || params.featureId);
  if (action === 'query_meego')    return !!(params.featureName || params.featureId) && !!params.query;
  return false;
}

// ── Intent parsing ─────────────────────────────────────────────────────────────

async function parseIntent(messages: ChatMsg[], userMessage: string): Promise<Intent> {
  const client = getClaudeClient();

  const history = messages.length
    ? '\n\nPrevious conversation:\n' + messages.map(m => `${m.role === 'user' ? 'User' : 'Hamlet'}: ${m.content}`).join('\n')
    : '';

  const response = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 1024,
    system: SYSTEM,
    messages: [{ role: 'user', content: `${history}\n\nUser: ${userMessage}` }],
  });

  const raw = response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim();

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`No JSON in response: ${raw.slice(0, 200)}`);
  return JSON.parse(jsonMatch[0]) as Intent;
}

// ── Route handler ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const { messages, userMessage } = await req.json() as { messages: ChatMsg[]; userMessage: string };

  let intent: Intent;
  try {
    intent = await parseIntent(messages, userMessage);
  } catch (e) {
    console.error('[chat] parseIntent failed:', e);
    return NextResponse.json({ reply: "I had trouble understanding that. Could you rephrase?" });
  }

  const { action, params, reply } = intent;

  // Actionable intent with all required params → reply immediately, let client execute
  if (ACTIONABLE.has(action) && isReady(intent)) {
    return NextResponse.json({ reply: 'On it!', action, params, executing: true });
  }

  // chat, unsupported, or missing params → reply from Claude directly
  return NextResponse.json({ reply, action });
}
