import { Feature } from './types';
import { readChatMessages, sendTextMessage, resolveOpenIds, mentionOpenId, senderOpenIdOf, ChatMessage } from './lark';
import { syncFeatureStatus } from './meego';
import { GoogleGenerativeAI } from '@google/generative-ai';

const LARK_BASE_URL = process.env.LARK_BASE_URL ?? 'https://open.larksuite.com';

// ─── Agent token management ─────────────────────────────────────────────────

interface TokenCache { token: string; expiresAt: number }
const tokenCache: Record<string, TokenCache> = {};

export async function getAgentToken(agent: 'rio' | 'mia'): Promise<string> {
  const cached = tokenCache[agent];
  if (cached && Date.now() < cached.expiresAt - 60_000) return cached.token;

  const appId = agent === 'rio' ? process.env.RIO_APP_ID : process.env.MIA_APP_ID;
  const appSecret = agent === 'rio' ? process.env.RIO_APP_SECRET : process.env.MIA_APP_SECRET;
  if (!appId || !appSecret) throw new Error(`${agent} credentials not configured`);

  const res = await fetch(`${LARK_BASE_URL}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const data = await res.json() as { code: number; tenant_access_token?: string; expire?: number };
  if (data.code !== 0 || !data.tenant_access_token) {
    throw new Error(`Failed to get ${agent} token: ${data.code}`);
  }

  tokenCache[agent] = {
    token: data.tenant_access_token,
    expiresAt: Date.now() + (data.expire ?? 7200) * 1000,
  };
  return data.tenant_access_token;
}

// ─── Development nodes (for merge check) ─────────────────────────────────────

const DEV_NODES = new Set([
  'iOS Dev', 'Android Dev', 'Server Dev', 'Tech Design',
  'iOS 开发', 'Android 开发', 'Server上线', '技术方案设计',
]);

// ─── Merge check (Rio only) ─────────────────────────────────────────────────

async function runMergeCheck(feature: Feature, chatId: string, _sinceMs: number, pocEmails: Record<string, string>): Promise<string[]> {
  const actions: string[] = [];

  // Need version and status
  if (!feature.iosVersion || !feature.status) return actions;
  if (!DEV_NODES.has(feature.status)) return actions;

  // Import merge calendar dynamically to avoid circular deps
  const { getCodeFreezeDate } = await import('./merge-calendar');
  const freezeDate = await getCodeFreezeDate(feature.iosVersion);
  if (!freezeDate) return actions;

  // Calculate business days remaining
  const today = new Date();
  let bizDays = 0;
  const d = new Date(today);
  while (d < freezeDate) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) bizDays++;
  }

  if (bizDays > 3) return actions;

  // Resolve @mentions for Tech Owner and PM
  const token = await getAgentToken('rio');
  const techName = feature.techOwner?.split(',')[0]?.trim() ?? '';
  const pmName = feature.pmOwner?.split(',')[0]?.trim() ?? '';
  const techEmail = pocEmails[techName] ?? '';
  const pmEmail = pocEmails[pmName] ?? '';
  const emails: string[] = [];
  if (techEmail) emails.push(techEmail);
  if (pmEmail) emails.push(pmEmail);

  const openIds = emails.length > 0 ? await resolveOpenIds(emails, token) : {};

  const techMention = techEmail && openIds[techEmail]
    ? `<at user_id="${openIds[techEmail]}">Tech Owner</at>`
    : (feature.techOwner?.split(',')[0]?.trim() ?? 'Tech Owner');
  const pmMention = pmEmail && openIds[pmEmail]
    ? `<at user_id="${openIds[pmEmail]}">PM</at>`
    : (feature.pmOwner?.split(',')[0]?.trim() ?? 'PM');

  const msg = `${techMention} The target version for this feature is ${feature.iosVersion}, and there are only ${bizDays} day${bizDays === 1 ? '' : 's'} left before code freeze. If testing has started, please update Meego status. Otherwise, check if the target version needs to be changed. cc ${pmMention}`;

  await sendTextMessage(chatId, msg, token);
  actions.push(`merge-check: sent warning for ${feature.name} (${bizDays} days left)`);
  return actions;
}

// ─── Unanswered questions check (Rio + Mia) ──────────────────────────────────

// Stakeholder role fields for each agent
const PM_ROLES: Array<keyof Feature> = ['pmOwner', 'uiuxOwner'];
const RD_ROLES: Array<keyof Feature> = ['techOwner', 'iosOwner', 'androidOwner', 'serverOwner', 'qaOwner'];

async function runUnansweredCheck(
  agent: 'rio' | 'mia',
  feature: Feature,
  chatId: string,
  sinceMs: number,
  pocEmails: Record<string, string>,
): Promise<string[]> {
  const actions: string[] = [];
  const token = await getAgentToken(agent);

  // Determine which stakeholder emails to monitor
  const roles = agent === 'rio' ? PM_ROLES : RD_ROLES;
  const stakeholderEmails = new Set<string>();
  for (const role of roles) {
    const names = (feature[role] as string | undefined)?.split(',').map(n => n.trim()) ?? [];
    for (const name of names) {
      const email = pocEmails[name];
      if (email) stakeholderEmails.add(email);
    }
  }

  if (stakeholderEmails.size === 0) return actions;

  // Fetch recent messages
  const messages = await readChatMessages(chatId, sinceMs, token);
  if (messages.length === 0) return actions;

  // Resolve open_ids for stakeholder emails to match sender IDs
  const emailToOpenId = await resolveOpenIds([...stakeholderEmails], token);
  const stakeholderOpenIds = new Set(Object.values(emailToOpenId));

  // Filter messages from stakeholders that have @mentions
  const stakeholderMsgs = messages.filter(m => {
    const senderOpenId = senderOpenIdOf(m);
    if (!senderOpenId || !stakeholderOpenIds.has(senderOpenId)) return false;
    // Must have mentions (tagging someone)
    if (!m.mentions || m.mentions.length === 0) return false;
    // Must not be a thread reply itself
    if (m.parent_id) return false;
    return true;
  });

  if (stakeholderMsgs.length === 0) return actions;

  // Check which messages are unanswered
  // A message is answered if: any reply in its thread, or a reaction (we can't easily check reactions via API, so just check thread replies)
  const unanswered: ChatMessage[] = [];
  for (const msg of stakeholderMsgs) {
    const hasReply = messages.some(m =>
      m.root_id === msg.message_id || m.parent_id === msg.message_id
    );
    if (!hasReply) unanswered.push(msg);
  }

  if (unanswered.length === 0) return actions;

  // Use Gemini to generate contextual follow-up messages
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    console.warn('[agents] GOOGLE_AI_API_KEY not set, skipping unanswered check');
    return actions;
  }

  const { getPrompt, getPromptModel } = await import('./prompts');
  const { getPromptDef, renderPrompt } = await import('./prompt-registry');
  const def = getPromptDef('hamlet.unanswered_followup');
  const modelName = await getPromptModel('hamlet.unanswered_followup', def?.model ?? 'gemini-2.5-flash-lite');
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: modelName });

  for (const msg of unanswered.slice(0, 3)) { // limit to 3 per run
    try {
      const content = msg.body?.content ?? '';
      // Extract mentioned user names
      const mentionNames = (msg.mentions ?? []).map(m => m.name).join(', ');
      const mentionTags = (msg.mentions ?? [])
        .map(m => ({ openId: mentionOpenId(m), name: m.name }))
        .filter(m => m.openId)
        .map(m => `<at user_id="${m.openId}">${m.name}</at>`)
        .join(' ');

      const tmpl = await getPrompt('hamlet.unanswered_followup', def?.default ?? '');
      const prompt = renderPrompt(tmpl, {
        agentDescription: agent === 'rio' ? 'Rio, a PM Agent' : 'Mia, an RD Agent',
        mentionNames,
        content,
      });

      const result = await model.generateContent(prompt);
      const followUp = result.response.text().trim();

      const fullMsg = mentionTags ? `${mentionTags} ${followUp}` : followUp;
      await sendTextMessage(chatId, fullMsg, token, msg.message_id);
      actions.push(`unanswered-${agent}: replied to message in ${feature.name}`);
    } catch (e) {
      console.warn(`[agents] failed to process unanswered msg:`, e);
    }
  }

  return actions;
}

// ─── Check registry (extensible) ─────────────────────────────────────────────

export interface AgentCheck {
  key: string;
  agent: 'rio' | 'mia';
  run: (feature: Feature, chatId: string, sinceMs: number, pocEmails: Record<string, string>) => Promise<string[]>;
}

export const CHECK_REGISTRY: AgentCheck[] = [
  {
    key: 'merge-check',
    agent: 'rio',
    run: async (feature, chatId, sinceMs, pocEmails) => runMergeCheck(feature, chatId, sinceMs, pocEmails),
  },
  {
    key: 'unanswered-pm',
    agent: 'rio',
    run: async (feature, chatId, sinceMs, pocEmails) => runUnansweredCheck('rio', feature, chatId, sinceMs, pocEmails),
  },
  {
    key: 'unanswered-rd',
    agent: 'mia',
    run: async (feature, chatId, sinceMs, pocEmails) => runUnansweredCheck('mia', feature, chatId, sinceMs, pocEmails),
  },
];

// ─── Main runner ─────────────────────────────────────────────────────────────

export async function runAgentsForFeature(
  feature: Feature,
  pocEmails: Record<string, string>,
): Promise<string[]> {
  const agents = feature.agents ?? [];
  if (agents.length === 0 || !feature.chatId) return [];

  const sinceMs = feature.agentLastRun
    ? new Date(feature.agentLastRun).getTime()
    : Date.now() - 24 * 60 * 60 * 1000; // default: last 24h

  const actions: string[] = [];

  for (const check of CHECK_REGISTRY) {
    if (!agents.includes(check.agent === 'rio' ? 'pm-assistant' : 'rd-assistant')) continue;

    try {
      const result = await check.run(feature, feature.chatId, sinceMs, pocEmails);
      actions.push(...result);
    } catch (e) {
      console.warn(`[agents] check ${check.key} failed for ${feature.name}:`, e);
    }
  }

  return actions;
}
