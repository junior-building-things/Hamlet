import { syncFeatureStatus } from './meego';
import { readChatMessages, sendTextToUser, getLarkBotToken, senderOpenIdOf, type ChatMessage } from './lark';
import { getAgentToken } from './agents';
import { chatMessageText } from './digests';
import { generateText } from './llm';
import { getPrompt, getPromptModel } from './prompts';
import { getPromptDef, renderPrompt } from './prompt-registry';
import { loadDigestState, updateDigestState, type ProactiveWatch } from './digest-state';
import { readFeatureCache } from './feature-cache';

// Thomas — recipient of every Proactive update. Same id as digests.ts AB_OPEN_MENTION_OPEN_ID.
const OWNER_OPEN_ID = 'ou_1e7fa98f1e46311d8a5e4554dc7a668e';
const LARK_BASE_URL = process.env.LARK_BASE_URL ?? 'https://open.larksuite.com';
const MAX_CHAT_MESSAGES = 60;

/** "45.10" > "45.8": compare dotted versions numerically. */
function versionLater(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

async function readGroupSince(chatId: string, sinceMs: number): Promise<ChatMessage[]> {
  // Junior (the main bot) is the member in most feature groups; Rio in a few.
  // readChatMessages returns [] when the bot isn't in the chat, so try both.
  let messages = await readChatMessages(chatId, sinceMs, await getLarkBotToken());
  if (messages.length === 0) {
    try { messages = await readChatMessages(chatId, sinceMs, await getAgentToken('rio')); } catch { /* not configured */ }
  }
  return messages.filter(m => m.sender?.sender_type !== 'app' && senderOpenIdOf(m) !== OWNER_OPEN_ID);
}

/** open_id → display name for a group's members (the bot has no contact scope, but can list its chats' members). */
async function memberNames(chatId: string, token: string): Promise<Record<string, string>> {
  const names: Record<string, string> = {};
  let pageToken = '';
  try {
    for (let page = 0; page < 10; page++) {
      const res = await fetch(`${LARK_BASE_URL}/open-apis/im/v1/chats/${chatId}/members?member_id_type=open_id&page_size=100${pageToken ? `&page_token=${pageToken}` : ''}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json() as { code: number; data?: { items?: Array<{ member_id?: string; name?: string }>; has_more?: boolean; page_token?: string } };
      for (const m of data.data?.items ?? []) if (m.member_id && m.name) names[m.member_id] = m.name;
      if (!data.data?.has_more || !data.data.page_token) break;
      pageToken = data.data.page_token;
    }
  } catch { /* bare @-mentions still render */ }
  return names;
}

async function summariseChat(featureName: string, chatId: string, messages: ChatMessage[]): Promise<string> {
  const recent = messages.slice(-MAX_CHAT_MESSAGES);
  const lines = recent
    .map(m => ({ sender: senderOpenIdOf(m), text: chatMessageText(m).trim() }))
    .filter(l => l.text)
    .map(l => `{${l.sender || 'unknown'}} ${l.text}`);
  if (lines.length === 0) return '';
  const def = getPromptDef('hamlet.proactive_chat');
  const tmpl = await getPrompt('hamlet.proactive_chat', def?.default ?? '');
  const model = await getPromptModel('hamlet.proactive_chat', def?.model ?? 'claude-sonnet-5');
  const raw = await generateText(renderPrompt(tmpl, { featureName, messages: lines.join('\n') }), { model, label: 'proactive-chat' });
  const json = JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')) as { notable?: boolean; summary?: string };
  const summary = json.notable ? json.summary?.trim() ?? '' : '';
  if (!summary) return '';

  // Turn {ou_…} tokens into real Lark @-mentions.
  const ids = [...new Set([...summary.matchAll(/\{(ou_[A-Za-z0-9]+)\}/g)].map(m => m[1]))];
  const names = ids.length ? await memberNames(chatId, await getLarkBotToken()) : {};
  return summary.replace(/\{(ou_[A-Za-z0-9]+)\}/g, (_, id: string) => `<at user_id="${id}">${names[id] ?? ''}</at>`);
}

/**
 * Diff one watched feature against its snapshot. Returns the update lines (empty
 * when nothing worth telling) and the watch entry to store back. The first check
 * only records a baseline, so turning the toggle on never dumps history.
 */
export async function checkFeature(watch: ProactiveWatch, now = Date.now()): Promise<{ lines: string[]; next: ProactiveWatch }> {
  const synced = await syncFeatureStatus(watch.meegoUrl, undefined, watch.chatId);
  const current = { status: synced.status ?? '', iosVersion: synced.iosVersion ?? '' };
  // syncFeatureStatus can't always find the group without Thomas's token; the
  // feature cache already knows it for most features.
  let chatId = synced.chatId || watch.chatId;
  if (!chatId) {
    const id = watch.meegoUrl.match(/detail\/(\d+)/)?.[1];
    chatId = (await readFeatureCache().catch(() => null))?.features.find(f => (f.meegoIssueId ?? f.id) === id)?.chatId;
  }
  const next: ProactiveWatch = { ...watch, name: synced.name || watch.name, chatId, snapshot: current, lastCheckedAt: new Date(now).toISOString() };
  if (!watch.snapshot || !watch.lastCheckedAt) return { lines: [], next };

  const lines: string[] = [];
  const before = watch.snapshot;
  if (current.status && current.status !== before.status) {
    lines.push(`• Status: ${before.status || '—'} → ${current.status}`);
  }
  if (current.iosVersion && current.iosVersion !== before.iosVersion) {
    const delayed = before.iosVersion && versionLater(current.iosVersion, before.iosVersion);
    lines.push(`• Target version: ${before.iosVersion || '—'} → ${current.iosVersion}${delayed ? ' (delayed)' : ''}`);
  }
  if (chatId) {
    try {
      const messages = await readGroupSince(chatId, Date.parse(watch.lastCheckedAt));
      const summary = messages.length ? await summariseChat(next.name, chatId, messages) : '';
      if (summary) lines.push(`• Group chat: ${summary}`);
    } catch (e) {
      console.warn(`[proactive] chat check failed for "${next.name}":`, e);
    }
  }
  return { lines, next };
}

/** One pass over every feature with Proactive updates on (the Job's 10-minute poll). */
export async function runProactiveUpdates(): Promise<void> {
  const watched = (await loadDigestState()).proactiveWatch ?? {};
  const ids = Object.keys(watched);
  if (ids.length === 0) return;
  const botToken = await getLarkBotToken();

  for (const id of ids) {
    try {
      const { lines, next } = await checkFeature(watched[id]);
      if (lines.length > 0) {
        const sent = await sendTextToUser(OWNER_OPEN_ID, [`🔔 ${next.name}`, ...lines, next.meegoUrl].join('\n'), botToken);
        console.log(`[proactive] "${next.name}": ${lines.length} update(s), DM ${sent ? 'sent' : 'FAILED'}`);
        if (!sent) continue; // leave the snapshot so the next poll retries
      }
      // Re-check the entry exists: the toggle may have been switched off mid-pass.
      await updateDigestState(s => {
        if (s.proactiveWatch?.[id]) s.proactiveWatch = { ...s.proactiveWatch, [id]: next };
      });
    } catch (e) {
      console.warn(`[proactive] check failed for ${id}:`, e);
    }
  }
}
