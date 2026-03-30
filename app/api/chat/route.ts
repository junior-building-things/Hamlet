import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

// ── Types ──────────────────────────────────────────────────────────────────────

interface ChatMsg { role: 'user' | 'assistant'; content: string }
interface Intent {
  action: 'create_feature' | 'create_prd' | 'update_prd' | 'complete_node' | 'query_meego' | 'read_doc' | 'edit_doc' | 'comment_doc' | 'duplicate_doc' | 'chat' | 'unsupported';
  params: { featureName?: string; featureId?: string; nodeName?: string; section?: string; content?: string; query?: string; docUrl?: string; commentText?: string };
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
6. read_doc         – User shares a Lark doc URL and wants to read, summarize, or ask about its contents (needs: docUrl)
7. edit_doc         – User wants to edit/update a specific section of a Lark doc (needs: docUrl, section, content)
8. comment_doc      – User wants to add a comment to a Lark doc (needs: docUrl, commentText, optionally section to comment on a specific section)
9. duplicate_doc    – User wants to duplicate/copy a Lark doc (needs: docUrl, optionally featureName for the new name)
10. chat            – General conversation, greetings, questions, small talk, or requests for clarification
11. unsupported     – User is asking for a SPECIFIC action that is not in the list above (e.g. "create a compliance ticket", "send an email")

Respond with ONLY valid JSON — no markdown fences, no extra text:
{
  "action": "create_feature|create_prd|update_prd|complete_node|query_meego|read_doc|edit_doc|comment_doc|duplicate_doc|chat|unsupported",
  "params": {
    "featureName": "exact name if mentioned",
    "featureId": "numeric Meego ID if mentioned",
    "nodeName": "e.g. Tech Assessment, iOS Development, Requirements Prep",
    "section": "PRD section heading for update_prd or edit_doc",
    "content": "new text for update_prd or edit_doc",
    "query": "the user's exact question verbatim, for query_meego",
    "docUrl": "full Lark doc URL if shared by user",
    "commentText": "the comment text for comment_doc"
  },
  "reply": "warm, natural response"
}

Rules:
- Use "chat" for greetings, thanks, questions about what you can do, or anything conversational — reply naturally and helpfully
- Use "query_meego" whenever the user asks a question about a named feature that could be answered with live Meego data — always prefer this over "chat" for feature-specific questions
- Use "read_doc" when the user shares a Lark doc/wiki URL (containing larkoffice.com/docx/ or larkoffice.com/wiki/) and wants to know what's in it, get a summary, or ask a question about it
- Use "unsupported" ONLY when the user asks for a specific task you cannot perform — reply EXACTLY: "Sorry, I haven't learned how to do that yet 😞. Anything else I can help you with?"
- If required info is missing for an action, use "chat" and ask for the missing info in the reply
- For create_feature: start reply with "Creating '[name]' in Meego…"
- For create_prd: start reply with "Creating a PRD for '[name]'…"
- For complete_node: start reply with "Marking '[nodeName]' as complete…"
- For query_meego: start reply with "Let me look that up in Meego…"
- For read_doc: start reply with "Reading the doc…"
- For edit_doc: start reply with "Updating the doc…"
- For comment_doc: start reply with "Adding your comment…"
- For duplicate_doc: start reply with "Duplicating the doc…"`;

// ── Actionable intents that trigger a two-phase response ──────────────────────

const ACTIONABLE = new Set(['create_feature', 'create_prd', 'complete_node', 'query_meego', 'read_doc', 'edit_doc', 'comment_doc', 'duplicate_doc']);

function isReady(intent: Intent): boolean {
  const { action, params } = intent;
  if (action === 'create_feature') return !!params.featureName;
  if (action === 'create_prd')     return !!(params.featureName || params.featureId);
  if (action === 'complete_node')  return !!(params.featureName || params.featureId);
  if (action === 'query_meego')    return !!(params.featureName || params.featureId) && !!params.query;
  if (action === 'read_doc')       return !!params.docUrl;
  if (action === 'edit_doc')       return !!params.docUrl && !!params.section && !!params.content;
  if (action === 'comment_doc')    return !!params.docUrl && !!params.commentText;
  if (action === 'duplicate_doc')  return !!params.docUrl;
  return false;
}

// ── Intent parsing ─────────────────────────────────────────────────────────────

async function parseIntent(messages: ChatMsg[], userMessage: string): Promise<Intent> {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_AI_API_KEY not set');

  const recent = messages.slice(-5);
  const history = recent.length
    ? '\n\nPrevious conversation:\n' + recent.map(m => `${m.role === 'user' ? 'User' : 'Hamlet'}: ${m.content}`).join('\n')
    : '';

  const genAI  = new GoogleGenerativeAI(apiKey);
  const model  = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite-preview' });
  const result = await model.generateContent(`${SYSTEM}${history}\n\nUser: ${userMessage}`);
  const raw    = result.response.text().trim();

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
    console.error('[chat] parseIntent failed:', e instanceof Error ? e.message : e);
    return NextResponse.json({ reply: "I had trouble understanding that. Could you rephrase?" });
  }

  const { action, params, reply } = intent;

  // Actionable intent with all required params → reply immediately, let client execute
  if (ACTIONABLE.has(action) && isReady(intent)) {
    return NextResponse.json({ reply, action, params, executing: true });
  }

  // chat, unsupported, or missing params → reply from Gemini directly
  return NextResponse.json({ reply, action });
}
