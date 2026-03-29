import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createFeature, fetchUserStories, completeNode, updateFeatureFields } from '@/lib/meego';
import { copyPrdTemplate } from '@/lib/lark';
import type { Feature } from '@/lib/types';

const PROJECT_KEY   = '5f105019a8b9a853da64767f';
const MEEGO_MCP_URL = 'https://meego.larkoffice.com/mcp_server/v1';

// ── Meego helpers ──────────────────────────────────────────────────────────────

async function callMeego(tool: string, args: Record<string, unknown>): Promise<string> {
  const token = process.env.MEEGO_USER_TOKEN;
  if (!token) throw new Error('MEEGO_USER_TOKEN not configured');
  const res  = await fetch(MEEGO_MCP_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'X-Mcp-Token': token },
    body:    JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name: tool, arguments: args } }),
  });
  if (!res.ok) throw new Error(`Meego HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(`Meego error: ${data.error.message}`);
  return data.result?.content?.[0]?.text ?? '';
}

function parseNodes(raw: string): Array<{ key: string; name: string }> {
  const section = raw.split('# 进行中的节点')[1] ?? '';
  return section.split('\n')
    .filter(l => l.startsWith('|') && !l.includes('---') && !l.includes('节点 ID'))
    .flatMap(line => {
      const parts = line.split('|').map(p => p.trim()).filter(Boolean);
      return parts.length >= 2 ? [{ key: parts[0], name: parts[1] }] : [];
    });
}

const NODE_TRANSLATIONS: Record<string, string> = {
  '产品需求准备': 'Requirements Prep', '产品线内初评': 'Initial Review',
  '技术评估&排优': 'Tech Assessment',  '需求详评':    'Detailed Review',
  '需求评审':    'Requirements Review', '技术方案设计': 'Technical Design',
  'iOS 开发':    'iOS Development',     'UI&UX验收':   'UI/UX Acceptance',
  'Server上线':  'Server Launch',       'AB实验':      'AB Testing',
  '结束':        'Done',               'PM验收':      'PM Acceptance',
  'PM走查':      'PM Walkthrough',     '依赖判断':    'Dependency Check',
  '合规评估':    'Compliance Review',
};

// ── Gemini intent parsing ──────────────────────────────────────────────────────

interface ChatMsg { role: 'user' | 'assistant'; content: string }
interface Intent {
  action: 'create_feature' | 'create_prd' | 'update_prd' | 'complete_node' | 'chat' | 'unsupported';
  params: { featureName?: string; featureId?: string; nodeName?: string; section?: string; content?: string };
  reply: string;
}

const SYSTEM = `You are Hamlet, a friendly AI assistant that helps manage features for TikTok PM.

Classify the user's message into one of these actions:
1. create_feature   – User wants to create a new feature  (needs: featureName)
2. create_prd       – User wants to create a PRD for a feature  (needs: featureName or featureId)
3. update_prd       – User wants to update a PRD section        (needs: featureName or featureId, section, content)
4. complete_node    – User wants to mark a workflow node done    (needs: featureName or featureId, nodeName)
5. chat             – General conversation, greetings, questions, small talk, or requests for clarification
6. unsupported      – User is asking for a SPECIFIC action that is not in the list above (e.g. "create a compliance ticket", "send an email")

Respond with ONLY valid JSON — no markdown fences, no extra text:
{
  "action": "create_feature|create_prd|update_prd|complete_node|chat|unsupported",
  "params": {
    "featureName": "exact name if mentioned",
    "featureId": "numeric Meego ID if mentioned",
    "nodeName": "e.g. Tech Assessment, iOS Development, Requirements Prep",
    "section": "PRD section heading for update_prd",
    "content": "new text for update_prd"
  },
  "reply": "warm, natural response"
}

Rules:
- Use "chat" for greetings, thanks, questions about what you can do, or anything conversational — reply naturally and helpfully
- Use "unsupported" ONLY when the user asks for a specific task you cannot perform — reply EXACTLY: "Sorry, I haven't learned how to do that yet 😞. Anything else I can help you with?"
- If required info is missing for an action, use "chat" and ask for the missing info in the reply
- For create_feature: start reply with "Creating '[name]' in Meego…"
- For create_prd: start reply with "Creating a PRD for '[name]'…"
- For complete_node: start reply with "Marking '[nodeName]' as complete…"`;

async function parseIntent(messages: ChatMsg[], userMessage: string): Promise<Intent> {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_AI_API_KEY not set');

  const history = messages.length
    ? '\n\nPrevious conversation:\n' + messages.map(m => `${m.role === 'user' ? 'User' : 'Hamlet'}: ${m.content}`).join('\n')
    : '';

  const genAI  = new GoogleGenerativeAI(apiKey);
  const model  = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite-preview' });
  const result = await model.generateContent(`${SYSTEM}${history}\n\nUser: ${userMessage}`);
  const raw    = result.response.text().trim();
  console.log('[chat] Gemini raw response:', raw.slice(0, 500));

  // Extract JSON — find the first { ... } block regardless of surrounding markdown
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`No JSON object found in response: ${raw.slice(0, 200)}`);
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

  try {
    // ── Create Feature ──────────────────────────────────────────────────────────
    if (action === 'create_feature' && params.featureName) {
      const created = await createFeature({ name: params.featureName, priority: 'P2', roles: [] });

      let prd: string | undefined;
      try {
        prd = await copyPrdTemplate(params.featureName);
        await updateFeatureFields(PROJECT_KEY, created.id, { prd });
      } catch { /* best-effort */ }

      const feature: Feature = {
        id:          created.id,
        name:        params.featureName,
        description: '',
        status:      'Backlog',
        priority:    'P2',
        owner:       '',
        tasks:       [],
        lastUpdated: new Date().toISOString().slice(0, 10),
        meegoUrl:    created.meegoUrl,
        prd,
      };

      const links = [
        prd             && `[📄 PRD](${prd})`,
        created.meegoUrl && `[🎯 Meego](${created.meegoUrl})`,
      ].filter(Boolean).join('  ·  ');

      return NextResponse.json({
        reply: `${reply} ✅${links ? `\n\n${links}` : ''}`,
        action: 'create_feature',
        feature,
      });
    }

    // ── Create PRD ──────────────────────────────────────────────────────────────
    if (action === 'create_prd' && (params.featureName || params.featureId)) {
      const name = params.featureName ?? `Feature ${params.featureId}`;
      const prd  = await copyPrdTemplate(name);
      if (params.featureId) {
        await updateFeatureFields(PROJECT_KEY, params.featureId, { prd });
      }
      return NextResponse.json({ reply: `${reply} ✅ [Open PRD](${prd})`, action: 'create_prd', prd });
    }

    // ── Complete Node ────────────────────────────────────────────────────────────
    if (action === 'complete_node' && (params.featureName || params.featureId)) {
      // 1. Resolve feature ID
      let workItemId = params.featureId;
      if (!workItemId && params.featureName) {
        const features = await fetchUserStories(PROJECT_KEY);
        const term     = params.featureName.toLowerCase();
        const match    = features.find(f =>
          f.name.toLowerCase().includes(term) || term.includes(f.name.toLowerCase())
        );
        if (!match) {
          return NextResponse.json({ reply: `I couldn't find a feature matching "${params.featureName}". Could you share the Meego ID?` });
        }
        workItemId = match.id;
      }

      // 2. Get active nodes for this work item
      const brief = await callMeego('get_workitem_brief', { project_key: PROJECT_KEY, work_item_id: workItemId });
      const nodes = parseNodes(brief);

      if (nodes.length === 0) {
        return NextResponse.json({ reply: `There are no active nodes on that feature right now.` });
      }

      // 3. Match by English or Chinese name (or use first node if no name given)
      const targetName = params.nodeName?.toLowerCase();
      const node = targetName
        ? nodes.find(n => {
            const en = NODE_TRANSLATIONS[n.name]?.toLowerCase() ?? '';
            return n.name.toLowerCase().includes(targetName) || en.includes(targetName);
          }) ?? nodes[0]
        : nodes[0];

      await completeNode(PROJECT_KEY, workItemId!, node.key);
      const displayName = NODE_TRANSLATIONS[node.name] ?? node.name;
      return NextResponse.json({ reply: `${reply.replace(params.nodeName ?? '', displayName)} ✅`, action: 'complete_node' });
    }

    // ── Update PRD ───────────────────────────────────────────────────────────────
    if (action === 'update_prd') {
      return NextResponse.json({ reply: "PRD section updates via chat are coming soon! You can edit the PRD directly in Lark for now. 📝" });
    }

  } catch (err) {
    return NextResponse.json({ reply: `Something went wrong: ${err instanceof Error ? err.message : 'Unknown error'}` });
  }

  // Unsupported or clarification needed
  return NextResponse.json({ reply, action });
}
