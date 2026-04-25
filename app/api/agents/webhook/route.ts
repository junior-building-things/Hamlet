import { NextRequest, NextResponse } from 'next/server';
import { getAgentToken } from '@/lib/agents';
import {
  sendTextMessage, searchAbReport,
  extractFigmaUrlFromPrd, searchLibraInChat, readDocContent,
  joinFeatureChat,
} from '@/lib/lark';
import { readFeatureCache } from '@/lib/feature-cache';
import { callMeegoMcp } from '@/lib/digests';
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

  // ── Feature lookup: 5-tier data resolution ──────────────────────────────
  // 1. GCS cache (instant)
  // 2. Meego MCP (live brief for missing fields)
  // 3. Lark Drive search (AB reports, docs)
  // 4. PRD doc content (Figma, design details)
  // 5. Lark group chat (Libra, recent discussions)
  let featureContext = '';
  try {
    const cache = await readFeatureCache();
    if (cache && cache.features.length > 0) {
      // Ask Gemini to identify which feature + what info is needed.
      // Include status so Gemini can prioritize ongoing features over done ones.
      const featureList = cache.features
        .map(f => `${f.name} [${f.status || 'Unknown'}]`)
        .join('\n');
      const matchResult = await model.generateContent(
        `Given this user message: "${userText}"\n\nTwo tasks:\n1. Which feature is the user most likely asking about? Match by partial name, keywords, or abbreviation — the user may omit words like "in", "the", "for" or use shorthand. IMPORTANT: If multiple features match, prefer ongoing/active features over completed ("Done") ones. Return the EXACT feature name (without the status in brackets) from the list that best matches, or "NONE" only if truly no feature is related.\n2. What info are they looking for? Return a short keyword like "figma", "status", "libra", "team", "risk", "prd", "ab_report", "existence", "general", etc.\n\nReturn as: FEATURE_NAME|||INFO_TYPE\n\nFeatures:\n${featureList}`
      );
      const matchRaw = matchResult.response.text().trim();
      const [matchedName, infoTypeParsed] = matchRaw.split('|||').map(s => s.trim());
      let infoType = infoTypeParsed;

      // Fuzzy match from Gemini's response
      let feature = matchedName && matchedName !== 'NONE'
        ? cache.features.find(f =>
            f.name === matchedName ||
            f.name.toLowerCase().includes(matchedName.toLowerCase()) ||
            matchedName.toLowerCase().includes(f.name.toLowerCase())
          )
        : undefined;

      // Fallback: if Gemini returned NONE or we couldn't match its response,
      // do a simple keyword search against feature names. This catches cases
      // like "ai self mix studio" matching "AI Self in Mix Studio".
      // Ongoing features get a bonus over Done ones when scores are tied.
      if (!feature) {
        const words = userText.toLowerCase().split(/\s+/).filter(w => w.length > 2);
        if (words.length > 0) {
          let bestScore = 0;
          for (const f of cache.features) {
            const nameLower = f.name.toLowerCase();
            let score = words.filter(w => nameLower.includes(w)).length;
            // Tiebreaker: prefer active features over Done
            if (f.status !== 'Done' && f.status !== '已完成') score += 0.5;
            if (score > bestScore && score >= Math.min(2, words.length)) {
              bestScore = score;
              feature = f;
            }
          }
          if (feature && !infoType) infoType = 'general';
        }
      }

      if (feature) {
          console.log(`[webhook] matched feature: "${feature.name}", info: "${infoType}"`);

          // Tier 1: start with cached data
          const data: Record<string, string> = {};
          Object.assign(data, formatFeatureFields(feature));

          // Tier 2: Meego MCP — fetch live brief if any relevant field is
          // missing. Covers status, priority, version, team, PRD, and more.
          const hasGaps = !feature.status || !feature.priority || !feature.iosVersion ||
            !feature.techOwner || !feature.prd ||
            (infoType && /status|priority|owner|team|version|tech|ios|android|server|qa|prd/i.test(infoType));
          if (hasGaps && feature.meegoUrl) {
            try {
              const raw = await callMeegoMcp('get_workitem_brief', {
                url: feature.meegoUrl,
                fields: ['wiki', 'priority', 'field_08a9ca', 'field_c88970', 'ios_actual_online_version', 'android_actual_online_version'],
              });
              const brief = JSON.parse(raw) as {
                work_item_attribute?: {
                  work_item_name?: string;
                  work_item_status?: { name?: string };
                  role_members?: Array<{ key?: string; name?: string; members?: Array<{ name?: string; email?: string }> }>;
                };
                work_item_fields?: Array<{ key?: string; name?: string; value?: unknown }>;
              };
              // Status
              if (brief.work_item_attribute?.work_item_status?.name)
                data['Status (live)'] = brief.work_item_attribute.work_item_status.name;
              // Team — fill any missing role from the brief
              const roles = brief.work_item_attribute?.role_members ?? [];
              const getRole = (key: string, alt?: string) =>
                roles.find(r => r.key === key || (alt && r.name === alt))?.members?.map(m => m.name).filter(Boolean).join(', ') ?? '';
              if (!data['Tech Owner']) { const v = getRole('Tech_Owner', 'Tech owner'); if (v) data['Tech Owner'] = v; }
              if (!data['PM'])         { const v = getRole('PM'); if (v) data['PM'] = v; }
              if (!data['iOS'])        { const v = getRole('iOS'); if (v) data['iOS'] = v; }
              if (!data['Android'])    { const v = getRole('Android'); if (v) data['Android'] = v; }
              if (!data['Server'])     { const v = getRole('Server'); if (v) data['Server'] = v; }
              if (!data['QA'])         { const v = getRole('QA'); if (v) data['QA'] = v; }
              if (!data['UX'])         { const v = getRole('UI_UX', 'UI&UX'); if (v) data['UX'] = v; }
              // PRD
              const wf = brief.work_item_fields ?? [];
              const getField = (k: string) => {
                const f = wf.find(x => x.key === k);
                return typeof f?.value === 'string' ? f.value : '';
              };
              if (!data['PRD']) { const v = getField('wiki'); if (v) data['PRD'] = v; }
              console.log('[webhook] Tier 2: enriched from Meego brief');
            } catch { /* skip */ }
          }

          // Tier 3: Lark Drive search — for AB report or Libra if missing.
          // The AB report doc often contains the Libra URL, so this tier
          // also serves as a Libra source before falling back to chat search.
          const needsAB = !data['AB Report'] && infoType && /ab|report|experiment/i.test(infoType);
          const needsLibraFromAB = !data['Libra'] && infoType && /libra|experiment|ab.*link/i.test(infoType);
          if (needsAB || needsLibraFromAB) {
            try {
              const abResult = await searchAbReport(feature.name, undefined, feature.prd);
              if (abResult.abReportUrl) data['AB Report'] = abResult.abReportUrl;
              if (abResult.libraUrl && !data['Libra']) data['Libra'] = abResult.libraUrl;
              console.log('[webhook] Tier 3: searched Lark Drive for AB report / Libra');
            } catch { /* skip */ }
          }

          // Tier 4: PRD doc content — for Figma if missing + requested
          if (!data['Figma'] && infoType && /figma|design|ui/i.test(infoType) && feature.prd) {
            try {
              const figma = await extractFigmaUrlFromPrd(feature.prd);
              if (figma) data['Figma'] = figma;
              console.log('[webhook] Tier 4: extracted Figma from PRD');
            } catch { /* skip */ }
          }
          // Also read PRD content for general design questions
          if (infoType && /prd|design|spec|requirement|what.*building/i.test(infoType) && feature.prd) {
            try {
              const prdContent = await readDocContent(feature.prd);
              if (prdContent && prdContent !== '(empty document)') {
                data['PRD Content (excerpt)'] = prdContent.slice(0, 1500);
                console.log('[webhook] Tier 4: read PRD content');
              }
            } catch { /* skip */ }
          }

          // Tier 5: Lark group chat — for Libra, recent discussions
          if (!data['Libra'] && infoType && /libra|experiment|ab.*link/i.test(infoType)) {
            try {
              const chatId = feature.chatId || (feature.meegoUrl
                ? (await joinFeatureChat(feature.name, undefined, feature.meegoUrl, true)) ?? ''
                : '');
              if (chatId) {
                const libra = await searchLibraInChat(chatId);
                if (libra) data['Libra'] = libra;
                console.log('[webhook] Tier 5: searched chat for Libra');
              }
            } catch { /* skip */ }
          }

          featureContext = '\n\nHere is the data for feature "' + feature.name + '":\n' +
            Object.entries(data).filter(([, v]) => v).map(([k, v]) => `  ${k}: ${v}`).join('\n');
      }

      // General queries (no specific feature)
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

  // Allow editing the persona + the wrapper template via the Prompts admin UI
  const { getPrompt } = await import('@/lib/prompts');
  const { getPromptDef, renderPrompt } = await import('@/lib/prompt-registry');
  const personaId = agent.key === 'rio' ? 'rio.persona' : 'mia.persona';
  const personaDef = getPromptDef(personaId);
  const persona = await getPrompt(personaId, personaDef?.default ?? agent.persona);
  const wrapperDef = getPromptDef('hamlet.agent_webhook');
  const wrapperTmpl = await getPrompt('hamlet.agent_webhook', wrapperDef?.default ?? '');
  const prompt = renderPrompt(wrapperTmpl, {
    persona,
    chatType,
    userText,
    featureContext,
  });

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
 * Extract all available fields from a Feature into a flat key-value map.
 * Used as the starting point for the tiered lookup — higher tiers can
 * add/overwrite fields if the cache doesn't have them.
 */
function formatFeatureFields(f: Feature): Record<string, string> {
  const d: Record<string, string> = {};
  if (f.status)          d['Status'] = f.status;
  if (f.priority)        d['Priority'] = f.priority;
  if (f.iosVersion)      d['Version'] = f.iosVersion;
  if (f.owner)           d['Owner'] = f.owner;
  if (f.pmOwner)         d['PM'] = f.pmOwner;
  if (f.techOwner)       d['Tech Owner'] = f.techOwner;
  if (f.iosOwner)        d['iOS'] = f.iosOwner;
  if (f.androidOwner)    d['Android'] = f.androidOwner;
  if (f.serverOwner)     d['Server'] = f.serverOwner;
  if (f.qaOwner)         d['QA'] = f.qaOwner;
  if (f.uiuxOwner)       d['UX'] = f.uiuxOwner;
  if (f.daOwner)         d['DS'] = f.daOwner;
  if (f.contentDesigner) d['Content Designer'] = f.contentDesigner;
  if (f.prd)             d['PRD'] = f.prd;
  if (f.figmaUrl)        d['Figma'] = f.figmaUrl;
  if (f.meegoUrl)        d['Meego'] = f.meegoUrl;
  if (f.complianceUrl)   d['Compliance'] = f.complianceUrl;
  if (f.abReportUrl)     d['AB Report'] = f.abReportUrl;
  if (f.libraUrl)        d['Libra'] = f.libraUrl;
  if (f.riskLevel)       d['Risk'] = f.riskLevel === 'red' ? 'High' : f.riskLevel === 'yellow' ? 'Medium' : 'Low';
  if (f.riskNotes?.length) d['Risk Notes'] = f.riskNotes.join(', ');
  if (f.quarterlyCycle)  d['Quarterly Cycle'] = f.quarterlyCycle;
  if (f.businessLine)    d['Business Line'] = f.businessLine;
  if (f.lastUpdated)     d['Last Updated'] = f.lastUpdated;
  if (f.versionHistory?.length) d['Version History'] = f.versionHistory.join(' → ');
  return d;
}
