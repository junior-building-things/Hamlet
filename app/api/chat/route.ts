import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

// ── Types ──────────────────────────────────────────────────────────────────────

interface ChatMsg { role: 'user' | 'assistant'; content: string }
interface Intent {
  action: 'create_feature' | 'create_prd' | 'update_prd' | 'complete_node' | 'query_meego' | 'read_doc' | 'edit_doc' | 'rename_section' | 'add_section' | 'comment_doc' | 'reply_comment' | 'duplicate_doc' | 'chat' | 'unsupported';
  params: { featureName?: string; featureId?: string; nodeName?: string; section?: string; content?: string; newHeading?: string; afterSection?: string; query?: string; docUrl?: string; commentText?: string; commentSearch?: string; replyText?: string; useHalfDayPrd?: boolean };
  reply: string;
}

// ── System prompt ──────────────────────────────────────────────────────────────

const SYSTEM = `You are Hamlet, a friendly AI assistant that helps manage features for TikTok PM.

Classify the user's message into one of these actions:
1. create_feature   – User wants to create a new feature  (needs: featureName)
2. create_prd       – User wants to create a PRD for a feature  (needs: featureName or featureId, optionally useHalfDayPrd=true if user mentions "half-day PRD" or "half day")
3. update_prd       – User wants to update a PRD section        (needs: featureName or featureId, section, content)
4. complete_node    – User wants to mark a workflow node done    (needs: featureName or featureId, nodeName)
5. query_meego      – User asks a question about a specific feature that requires live data: who owns a node, what is the status of a node, who is on the team, what nodes are in progress, etc. (needs: featureName or featureId, query)
6. read_doc         – User shares a Lark doc URL and wants to read, summarize, or ask about its contents (needs: docUrl)
7. edit_doc         – User wants to edit/update/rewrite the BODY CONTENT (paragraph text) of an EXISTING section in a Lark doc (needs: docUrl, section, content)
8. rename_section   – User wants to RENAME/CHANGE a section HEADING/TITLE in a Lark doc, e.g. "change appendix to options", "rename the background section to context" (needs: docUrl, section for the current heading, newHeading for the new heading text)
9. add_section      – User wants to ADD/INSERT/CREATE a NEW section that does NOT yet exist in a Lark doc. Keywords: "add a section", "insert a section", "create a section", "add an appendix" (needs: docUrl, section for the new heading title; optionally content for the section body — if not provided, AI will generate it; optionally afterSection to insert after a specific existing section)
9. comment_doc      – User wants to add a comment to a Lark doc (needs: docUrl, commentText, optionally section to comment on a specific section)
10. reply_comment    – User wants to reply to an existing comment on a Lark doc (needs: docUrl, replyText, and commentSearch — a keyword/phrase to find the target comment)
11. duplicate_doc    – User wants to duplicate/copy a Lark doc (needs: docUrl, optionally featureName for the new name)
12. chat            – General conversation, greetings, questions, small talk, or requests for clarification
13. unsupported     – User is asking for a SPECIFIC action that is not in the list above (e.g. "create a compliance ticket", "send an email")

Respond with ONLY valid JSON — no markdown fences, no extra text:
{
  "action": "create_feature|create_prd|update_prd|complete_node|query_meego|read_doc|edit_doc|rename_section|add_section|comment_doc|reply_comment|duplicate_doc|chat|unsupported",
  "params": {
    "featureName": "exact name if mentioned",
    "featureId": "numeric Meego ID if mentioned",
    "nodeName": "e.g. Tech Assessment, iOS Development, Requirements Prep",
    "section": "PRD section heading for update_prd or edit_doc",
    "content": "new text for update_prd, edit_doc, or add_section",
    "newHeading": "the new heading text for rename_section",
    "afterSection": "existing section heading to insert after (for add_section, optional)",
    "query": "the user's exact question verbatim, for query_meego",
    "docUrl": "full Lark doc URL if shared by user",
    "commentText": "the comment text for comment_doc",
    "commentSearch": "keyword or phrase to find the target comment for reply_comment (use the commenter's name or quoted text)",
    "replyText": "for reply_comment: the exact reply if user provides one, OR a brief instruction like 'something insightful' or 'agree and elaborate' if user wants AI to generate it",
    "useHalfDayPrd": "true if user wants a half-day PRD template, omit otherwise"
  },
  "reply": "warm, natural response"
}

Rules:
- Use "chat" for greetings, thanks, questions about what you can do, or anything conversational — reply naturally and helpfully
- Use "query_meego" whenever the user asks a question about a named feature that could be answered with live Meego data — always prefer this over "chat" for feature-specific questions
- Use "add_section" (NOT "edit_doc") when the user says "add", "insert", or "create" a section — this creates a NEW section in the doc
- Use "edit_doc" only when the user wants to change/update/rewrite content in a section that already exists
- Use "read_doc" when the user shares a Lark doc/wiki URL (containing larkoffice.com/docx/ or larkoffice.com/wiki/) and wants to know what's in it, get a summary, or ask a question about it
- Use "unsupported" ONLY when the user asks for a specific task you cannot perform — reply EXACTLY: "Sorry, I haven't learned how to do that yet 😞. Anything else I can help you with?"
- If required info is missing for an action, use "chat" and ask for the missing info in the reply
- For create_feature: start reply with "Creating '[name]' in Meego…"
- For create_prd: start reply with "Creating a PRD for '[name]'…"
- For complete_node: start reply with "Marking '[nodeName]' as complete…"
- For query_meego: start reply with "Let me look that up in Meego…"
- For read_doc: start reply with "Reading the doc…"
- For edit_doc: start reply with "Updating the doc…"
- For rename_section: start reply with "Renaming the section…"
- For add_section: start reply with "Adding the section…"
- For comment_doc: start reply with "Adding your comment…"
- For reply_comment: start reply with "Replying to the comment…"
- For duplicate_doc: start reply with "Duplicating the doc…"`;

// ── Actionable intents that trigger a two-phase response ──────────────────────

const ACTIONABLE = new Set(['create_feature', 'create_prd', 'complete_node', 'query_meego', 'read_doc', 'edit_doc', 'rename_section', 'add_section', 'comment_doc', 'reply_comment', 'duplicate_doc']);

function isReady(intent: Intent): boolean {
  const { action, params } = intent;
  if (action === 'create_feature') return !!params.featureName;
  if (action === 'create_prd')     return !!(params.featureName || params.featureId);
  if (action === 'complete_node')  return !!(params.featureName || params.featureId);
  if (action === 'query_meego')    return !!(params.featureName || params.featureId) && !!params.query;
  if (action === 'read_doc')       return !!params.docUrl;
  if (action === 'edit_doc')       return !!params.docUrl && !!params.section && !!params.content;
  if (action === 'rename_section') return !!params.docUrl && !!params.section && !!params.newHeading;
  if (action === 'add_section')    return !!params.docUrl && !!params.section;
  if (action === 'comment_doc')    return !!params.docUrl && !!params.commentText;
  if (action === 'reply_comment')  return !!params.docUrl && !!params.replyText && !!params.commentSearch;
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
