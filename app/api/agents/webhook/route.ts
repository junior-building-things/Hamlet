import { NextRequest, NextResponse } from 'next/server';
import { getAgentToken } from '@/lib/agents';
import { sendTextMessage } from '@/lib/lark';
import { readFeatureCache } from '@/lib/feature-cache';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { Feature } from '@/lib/types';

// ─── Agent config ────────────────────────────────────────────────────────────

const AGENTS: Record<string, { name: string; key: 'rio' | 'mia'; appId: string; persona: string }> = {
  [process.env.RIO_APP_ID ?? '']: {
    name: 'Rio',
    key: 'rio',
    appId: process.env.RIO_APP_ID ?? '',
    persona: `You are Rio, a proactive PM Agent for TikTok's Social team. You help PMs track feature progress, check merge deadlines, follow up on unanswered questions, and provide project status updates. You're friendly, concise, and action-oriented. Use emoji occasionally.`,
  },
  [process.env.MIA_APP_ID ?? '']: {
    name: 'Mia',
    key: 'mia',
    appId: process.env.MIA_APP_ID ?? '',
    persona: `You are Mia, an RD Agent for TikTok's Social team. You help engineers with code review follow-ups, build status checks, and technical coordination. You're technically sharp, concise, and helpful. Use emoji occasionally.`,
  },
};

// Identify which agent based on the app_id in the event header
function identifyAgent(appId: string) {
  return AGENTS[appId] ?? null;
}

// ─── Lark event handling ─────────────────────────────────────────────────────

interface LarkEvent {
  // URL verification
  challenge?: string;
  type?: string;
  // Event v2 schema
  schema?: string;
  header?: {
    event_id: string;
    event_type: string;
    app_id: string;
    token?: string;
  };
  event?: {
    sender?: {
      sender_id?: { open_id?: string; user_id?: string };
      sender_type?: string;
    };
    message?: {
      message_id: string;
      chat_id: string;
      chat_type: string;
      content: string;
      message_type: string;
      mentions?: Array<{ key: string; id: { open_id?: string }; name: string }>;
    };
  };
}

// Deduplicate events (Lark may retry)
const processedEvents = new Set<string>();

export async function POST(req: NextRequest) {
  const body = await req.json() as LarkEvent;

  // URL verification challenge
  if (body.challenge) {
    return NextResponse.json({ challenge: body.challenge });
  }

  // Event v2
  if (body.header?.event_type === 'im.message.receive_v1') {
    const eventId = body.header.event_id;

    // Deduplicate
    if (processedEvents.has(eventId)) {
      return NextResponse.json({ ok: true });
    }
    processedEvents.add(eventId);
    // Clean old events (keep last 100)
    if (processedEvents.size > 100) {
      const arr = [...processedEvents];
      arr.slice(0, arr.length - 100).forEach(id => processedEvents.delete(id));
    }

    // Process in background to respond within 3s
    handleMessage(body).catch(e => console.error('[webhook] error:', e));

    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: true });
}

async function handleMessage(body: LarkEvent) {
  const appId = body.header?.app_id ?? '';
  const agent = identifyAgent(appId);
  if (!agent) {
    console.warn('[webhook] unknown app_id:', appId);
    return;
  }

  const message = body.event?.message;
  const sender = body.event?.sender;
  if (!message || !sender) return;

  // Ignore bot's own messages
  if (sender.sender_type === 'app') return;

  // Only handle text messages
  if (message.message_type !== 'text') return;

  // Parse message content
  let userText = '';
  try {
    const content = JSON.parse(message.content) as { text?: string };
    userText = content.text ?? '';
  } catch {
    userText = message.content;
  }

  // Remove @bot mention from the text
  if (message.mentions) {
    for (const mention of message.mentions) {
      userText = userText.replace(mention.key, '').trim();
    }
  }

  if (!userText) return;

  console.log(`[webhook] ${agent.name} received: "${userText.slice(0, 100)}" in ${message.chat_type} chat`);

  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    console.warn('[webhook] GOOGLE_AI_API_KEY not set');
    return;
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });
  const chatType = message.chat_type === 'p2p' ? 'direct message' : 'group chat';

  // ── Feature lookup: find relevant feature data for the question ──────────
  let featureContext = '';
  try {
    const cache = await readFeatureCache();
    if (cache && cache.features.length > 0) {
      // Ask Gemini to identify which feature (if any) the user is asking about.
      const featureNames = cache.features.map(f => f.name).join('\n');
      const matchResult = await model.generateContent(
        `Given this user message: "${userText}"\n\nWhich of these features is the user asking about? Return ONLY the exact feature name, or "NONE" if the question is not about a specific feature.\n\nFeatures:\n${featureNames}`
      );
      const matchedName = matchResult.response.text().trim();

      if (matchedName && matchedName !== 'NONE') {
        // Fuzzy match — find the closest feature name
        const feature = cache.features.find(f =>
          f.name === matchedName ||
          f.name.toLowerCase().includes(matchedName.toLowerCase()) ||
          matchedName.toLowerCase().includes(f.name.toLowerCase())
        );

        if (feature) {
          featureContext = formatFeatureContext(feature);
          console.log(`[webhook] matched feature: "${feature.name}"`);
        }
      }

      // If no specific feature matched but the question is general (e.g.
      // "how many features are in dev?"), provide a summary.
      if (!featureContext && /how many|list|all|summary|overview/i.test(userText)) {
        const statusCounts: Record<string, number> = {};
        for (const f of cache.features) {
          statusCounts[f.status] = (statusCounts[f.status] ?? 0) + 1;
        }
        const summary = Object.entries(statusCounts)
          .map(([s, n]) => `${s}: ${n}`)
          .join(', ');
        featureContext = `\n\nYou have access to ${cache.features.length} features. Status breakdown: ${summary}`;
      }
    }
  } catch (e) {
    console.warn('[webhook] feature lookup failed:', e);
  }

  const prompt = `${agent.persona}

A team member sent you this ${chatType} message:
"${userText}"
${featureContext}

Reply naturally and helpfully. Keep your response concise (1-3 sentences). If you have feature data, use it to answer the question directly. If you don't have the specific information requested, say so honestly. Don't make up project details.

Reply with ONLY your response text (no quotes, no explanation).`;

  try {
    const result = await model.generateContent(prompt);
    const reply = result.response.text().trim();

    if (!reply) return;

    const token = await getAgentToken(agent.key);
    const chatId = message.chat_id;

    // In group chats, reply in thread; in DMs, reply directly
    const replyToId = message.chat_type === 'group' ? message.message_id : undefined;
    await sendTextMessage(chatId, reply, token, replyToId);

    console.log(`[webhook] ${agent.name} replied: "${reply.slice(0, 100)}"`);
  } catch (e) {
    console.error(`[webhook] ${agent.name} failed to reply:`, e);
  }
}

/**
 * Format a Feature into a context block that Gemini can use to answer
 * questions. Includes all available fields so Gemini can pick the
 * relevant ones based on the user's question.
 */
function formatFeatureContext(f: Feature): string {
  const lines: string[] = [
    '',
    `Here is the data for feature "${f.name}":`,
  ];
  if (f.status)          lines.push(`  Status: ${f.status}`);
  if (f.priority)        lines.push(`  Priority: ${f.priority}`);
  if (f.iosVersion)      lines.push(`  Version: ${f.iosVersion}`);
  if (f.owner)           lines.push(`  Owner: ${f.owner}`);
  if (f.pmOwner)         lines.push(`  PM: ${f.pmOwner}`);
  if (f.techOwner)       lines.push(`  Tech Owner: ${f.techOwner}`);
  if (f.iosOwner)        lines.push(`  iOS: ${f.iosOwner}`);
  if (f.androidOwner)    lines.push(`  Android: ${f.androidOwner}`);
  if (f.serverOwner)     lines.push(`  Server: ${f.serverOwner}`);
  if (f.qaOwner)         lines.push(`  QA: ${f.qaOwner}`);
  if (f.uiuxOwner)       lines.push(`  UX: ${f.uiuxOwner}`);
  if (f.daOwner)         lines.push(`  DS: ${f.daOwner}`);
  if (f.contentDesigner) lines.push(`  Content Designer: ${f.contentDesigner}`);
  if (f.prd)             lines.push(`  PRD: ${f.prd}`);
  if (f.figmaUrl)        lines.push(`  Figma: ${f.figmaUrl}`);
  if (f.meegoUrl)        lines.push(`  Meego: ${f.meegoUrl}`);
  if (f.complianceUrl)   lines.push(`  Compliance: ${f.complianceUrl}`);
  if (f.abReportUrl)     lines.push(`  AB Report: ${f.abReportUrl}`);
  if (f.libraUrl)        lines.push(`  Libra: ${f.libraUrl}`);
  if (f.riskLevel)       lines.push(`  Risk: ${f.riskLevel === 'red' ? 'High' : f.riskLevel === 'yellow' ? 'Medium' : 'Low'}`);
  if (f.riskNotes?.length) lines.push(`  Risk Notes: ${f.riskNotes.join(', ')}`);
  if (f.quarterlyCycle)  lines.push(`  Quarterly Cycle: ${f.quarterlyCycle}`);
  if (f.businessLine)    lines.push(`  Business Line: ${f.businessLine}`);
  if (f.lastUpdated)     lines.push(`  Last Updated: ${f.lastUpdated}`);
  if (f.versionHistory?.length) lines.push(`  Version History: ${f.versionHistory.join(' → ')}`);
  return lines.join('\n');
}
