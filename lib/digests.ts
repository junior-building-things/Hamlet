import { Feature } from './types';
import { readChatMessages, resolveOpenIds, sendDmByEmail, ChatMessage } from './lark';
import { getAgentToken } from './agents';
import { getCodeFreezeDate } from './merge-calendar';

// Direct Meego MCP client — duplicated here so the digest pipeline can talk to
// Meego without going through Hamlet's translation layer. We want raw Chinese
// node names for filtering and risk evaluation, not the English aliases that
// `syncFeatureStatus` produces.
const MEEGO_MCP_URL = 'https://meego.larkoffice.com/mcp_server/v1';
const TIKTOK_PROJECT_KEY = '5f105019a8b9a853da64767f';

async function callMeegoMcp(toolName: string, args: Record<string, unknown>): Promise<string> {
  const token = process.env.MEEGO_USER_TOKEN;
  if (!token) throw new Error('MEEGO_USER_TOKEN not configured');

  const res = await fetch(MEEGO_MCP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Mcp-Token': token },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: { name: toolName, arguments: args },
    }),
  });

  if (!res.ok) throw new Error(`Meego MCP HTTP error: ${res.status}`);
  const data = await res.json() as { error?: { message: string }; result?: { content?: Array<{ text?: string }> } };
  if (data.error) throw new Error(`Meego MCP error: ${data.error.message}`);
  return data.result?.content?.[0]?.text ?? '';
}

// ─── Types ────────────────────────────────────────────────────────────────

export type RiskLevel = 'red' | 'yellow' | 'green';

/**
 * Raw-from-Meego feature metadata used by the digest pipeline.
 * Statuses are in the original language returned by Meego (Chinese for TikTok).
 */
export interface MeegoFeature {
  workItemId: string;
  name: string;
  meegoUrl: string;
  rawStatus: string;                // e.g. 'iOS 开发' — raw Chinese node name, no translation
  chatId?: string;
  iosVersion?: string;
  lastUpdatedIso?: string;          // YYYY-MM-DD
  prd?: string;
  roles: Record<string, string[]>;  // role name → list of stakeholder display names
  roleEmails: Record<string, string>; // display name → email (for resolving open_ids)
  activeNodeOwnerEmails: string;
}

export interface RiskFinding {
  level: RiskLevel;
  reasons: string[];
  feature: MeegoFeature;
}

export interface UnansweredQuestion {
  senderOpenId: string;
  mentionNames: string[];
  text: string;
  messageId: string;
  timestamp: number;
}

export interface UnansweredFinding {
  feature: MeegoFeature;
  questions: UnansweredQuestion[];
}

export interface DigestRunResult {
  featuresChecked: number;
  riskSent: boolean;
  unansweredSent: boolean;
  riskFindings: RiskFinding[];
  unansweredFindings: UnansweredFinding[];
}

// ─── Status sets (raw Chinese from Meego) ─────────────────────────────────

/**
 * Raw Chinese node names that mean the feature is NOT actively in development.
 * Everything else is treated as in-dev. Source of truth: lib/meego.ts NODE_PRIORITY + NODE_TRANSLATIONS.
 */
const NOT_IN_DEV_RAW = new Set<string>([
  // Pre-dev
  '产品需求准备',   // Requirements Prep
  '产品线内初评',   // Initial Review
  '依赖判断',      // Dependency Check
  '合规评估',      // Compliance Review
  // Post-dev
  'PM验收',        // PM Acceptance
  'PM走查',        // PM Walkthrough
  '结束',          // Done / End
]);

function isInDev(rawStatus: string): boolean {
  if (!rawStatus) return false;
  return !NOT_IN_DEV_RAW.has(rawStatus);
}

/**
 * Raw Chinese node names that mean QA has effectively started.
 * Used to scope "not in QA yet" freeze-pressure risk checks.
 */
const QA_OR_LATER_RAW = new Set<string>([
  'QA测试',         // QA Testing
  'QA功能测试',     // QA Functional Testing
  'QA测试准备',     // QA Test Preparation
  'UI&UX验收',      // UI/UX Acceptance
  'AB实验',         // AB Testing
  '结束',           // Done / End
]);

// ─── Node priority (for picking the most-advanced active node) ────────────

// If a feature has multiple in-progress nodes, we pick the earliest in the
// workflow as the "current" one. Matches lib/meego.ts NODE_PRIORITY.
const NODE_PRIORITY = [
  '产品需求准备',
  '产品线内初评',
  '技术评估&排优',
  '需求详评',
  '需求评审',
  '技术方案设计',
  'iOS 开发',
  'Android 开发',
  'Server上线',
  'UI&UX验收',
  'QA测试准备',
  'QA测试',
  'QA功能测试',
  'AB实验',
  'PM走查',
  'PM验收',
  '结束',
];

function pickActiveNode(names: string[]): string {
  if (names.length === 0) return '';
  return names.slice().sort((a, b) => {
    const ia = NODE_PRIORITY.indexOf(a);
    const ib = NODE_PRIORITY.indexOf(b);
    return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib);
  })[0];
}

// ─── Meego brief parsing ──────────────────────────────────────────────────

interface ParsedActiveNode { key: string; name: string; owners: string }

function parseActiveNodes(raw: string): ParsedActiveNode[] {
  const section = raw.split('# 进行中的节点')[1] ?? '';
  return section
    .split('\n')
    .filter(l => l.startsWith('|') && !l.includes('---') && !l.includes('节点 ID'))
    .flatMap(line => {
      const parts = line.split('|').map(p => p.trim()).filter(Boolean);
      if (parts.length >= 3) return [{ key: parts[0], name: parts[1], owners: parts[2] }];
      return [];
    });
}

/**
 * Walk the get_workitem_brief JSON response looking for active nodes.
 * The exact path isn't known yet — this function tries a few common locations.
 */
function parseActiveNodesFromJson(json: Record<string, unknown>): ParsedActiveNode[] {
  const found: ParsedActiveNode[] = [];

  const coerceNode = (n: unknown): ParsedActiveNode | null => {
    if (!n || typeof n !== 'object') return null;
    const obj = n as Record<string, unknown>;
    const name = (obj.name ?? obj.node_name ?? obj.node_name_zh) as string | undefined;
    const key = (obj.key ?? obj.node_key ?? obj.node_state_key ?? obj.id) as string | undefined;
    if (!name) return null;
    const ownersArr = (obj.owners ?? obj.assignees ?? []) as unknown[];
    const owners = Array.isArray(ownersArr)
      ? ownersArr.map(o => (typeof o === 'object' && o ? ((o as Record<string, unknown>).email as string ?? '') : '')).filter(Boolean).join(',')
      : '';
    return { key: key ?? '', name, owners };
  };

  const walk = (node: unknown, pathKey: string) => {
    if (!node) return;
    if (Array.isArray(node)) {
      // If the parent key suggests this is a list of nodes, try to coerce each item
      if (/node|stage|step|进行|active/i.test(pathKey)) {
        for (const item of node) {
          const coerced = coerceNode(item);
          if (coerced) found.push(coerced);
        }
      }
      for (const item of node) walk(item, pathKey);
      return;
    }
    if (typeof node === 'object') {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        walk(v, k);
      }
    }
  };

  walk(json, 'root');
  return found;
}

function parseWorkItemField(raw: string, fieldName: string): string {
  const regex = new RegExp(`\\|\\s*${fieldName}\\s*\\|\\s*([^|\\n]+?)\\s*\\|`);
  const match = raw.match(regex);
  return match ? match[1].trim() : '';
}

/** Parse ISO-like timestamp / date / epoch from the 更新时间 field. */
function parseUpdatedIso(raw: string): string {
  const val = parseWorkItemField(raw, '更新时间') || parseWorkItemField(raw, 'updated_at');
  if (!val) return '';
  const ts = Number(val);
  if (!isNaN(ts) && ts > 1_000_000_000_000) return new Date(ts).toISOString().split('T')[0];
  const m = val.match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : '';
}

/** Extract {name: email} pairs from a Meego role member value like "Name(email), Name2(email2)". */
function parseRoleMembers(value: string): Array<{ name: string; email: string }> {
  if (!value || value === '未填写') return [];
  const pairs: Array<{ name: string; email: string }> = [];
  const regex = /([^,(]+)\(([^)]+)\)/g;
  let m;
  while ((m = regex.exec(value)) !== null) {
    const name = m[1].trim();
    const email = m[2].trim();
    if (name && email.includes('@')) pairs.push({ name, email });
  }
  return pairs;
}

/** Extract the roles block from the brief. Roles look like `"PM":"Thomas(...)","iOS":"..."`. */
function parseRoles(raw: string): { roles: Record<string, string[]>; emails: Record<string, string> } {
  const roles: Record<string, string[]> = {};
  const emails: Record<string, string> = {};
  const roleNames = ['PM', 'TPM', 'Tech owner', 'iOS', 'Android', 'Server', 'QA', 'DA', 'UI&UX', 'Content Designer'];
  for (const role of roleNames) {
    const escaped = role.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`"${escaped}":"([^"]+)"`);
    const match = raw.match(regex);
    if (!match) continue;
    const pairs = parseRoleMembers(match[1]);
    roles[role] = pairs.map(p => p.name);
    for (const { name, email } of pairs) emails[name] = email;
  }
  return { roles, emails };
}

/**
 * Fetch a single feature from Meego MCP with its raw (untranslated) Chinese status.
 */
async function fetchMeegoFeature(workItemId: string, name: string, projectKey: string): Promise<MeegoFeature | null> {
  const meegoUrl = `https://meego.larkoffice.com/${projectKey}/story/detail/${workItemId}`;
  let raw: string;
  try {
    raw = await callMeegoMcp('get_workitem_brief', {
      url: meegoUrl,
      fields: ['wiki', 'priority', 'field_due3fb', 'field_532e61', 'field_a4c558', 'field_2e7909', 'created_at'],
    });
  } catch (e) {
    console.warn(`[digests] failed to fetch brief for ${name}:`, e);
    return null;
  }

  // The MCP response is JSON — parse it and walk the tree for active nodes
  let parsedJson: Record<string, unknown> | null = null;
  try {
    parsedJson = JSON.parse(raw) as Record<string, unknown>;
  } catch { /* not JSON — fall through to legacy markdown parser */ }

  const activeNodes: ParsedActiveNode[] = parsedJson
    ? parseActiveNodesFromJson(parsedJson)
    : parseActiveNodes(raw);

  if (activeNodes.length === 0) {
    // One-time dump of the JSON keys so we can see where active nodes actually live
    const sample = parsedJson ? Object.keys(parsedJson).join(',') : 'not JSON';
    console.log(`[digests] no active nodes parsed for ${name}. Top-level keys: ${sample}`);
    console.log(`[digests] raw preview: ${raw.slice(0, 800)}`);
  }
  const rawStatus = pickActiveNode(activeNodes.map(n => n.name));
  const prd = parseWorkItemField(raw, 'PRD');
  const lastUpdatedIso = parseUpdatedIso(raw);
  const { roles, emails: roleEmails } = parseRoles(raw);
  const activeNodeOwnerEmails = activeNodes.find(n => n.name === rawStatus)?.owners ?? '';

  // iOS planned version is a node-level field (field_08a9ca) stored on qa_test_preparation.
  // For v1 of the digest we don't resolve it — risk checks that need version will simply
  // skip the freeze pressure check when iosVersion is unknown.
  return {
    workItemId,
    name,
    meegoUrl,
    rawStatus,
    iosVersion: undefined,
    lastUpdatedIso,
    prd: prd || undefined,
    roles,
    roleEmails,
    activeNodeOwnerEmails,
  };
}

// ─── Feature discovery via list_todo + MQL (raw Chinese statuses) ─────────

interface MeegoTodoItem {
  work_item_info: { work_item_id: number; work_item_type_key: string; work_item_name: string };
  project_key: string;
  node_info?: { node_name?: string; node_state_key?: string };
}

async function fetchAllPmOwnedIds(projectKey: string): Promise<Array<{ id: string; name: string; rawStatusFromList?: string }>> {
  // Step 1: list_todo gives us features with an active node we're assigned to
  const todos = new Map<string, { id: string; name: string; rawStatusFromList?: string }>();
  let page = 1;
  try {
    while (true) {
      const raw = await callMeegoMcp('list_todo', { action: 'todo', page_num: page });
      const data = JSON.parse(raw) as { total?: number; list?: MeegoTodoItem[] };
      for (const item of data.list ?? []) {
        if (item.project_key !== projectKey) continue;
        if (item.work_item_info.work_item_type_key !== 'story') continue;
        const id = String(item.work_item_info.work_item_id);
        if (todos.has(id)) continue;
        todos.set(id, {
          id,
          name: item.work_item_info.work_item_name,
          rawStatusFromList: item.node_info?.node_name ?? undefined,
        });
      }
      if ((data.list?.length ?? 0) === 0) break;
      if (todos.size >= (data.total ?? 0)) break;
      page++;
    }
  } catch (e) {
    console.warn('[digests] list_todo failed:', e);
  }

  // Step 2: MQL gives us ALL stories where I'm PM (including ones not in todo)
  try {
    const MQL = "SELECT `work_item_id`, `name` FROM `TikTok`.`需求` WHERE `__PM` = current_login_user()";
    let sessionId: string | undefined;
    let mqlPage = 1;
    while (true) {
      const args: Record<string, unknown> = sessionId
        ? { project_key: 'TikTok', session_id: sessionId, group_pagination_list: [{ group_id: '1', page_num: mqlPage }] }
        : { project_key: 'TikTok', mql: MQL };
      const raw = await callMeegoMcp('search_by_mql', args);
      const data = JSON.parse(raw) as {
        session_id?: string;
        list?: Array<{ count?: number }>;
        data?: Record<string, Array<{ moql_field_list?: Array<{ key: string; value: { long_value?: number; varchar_value?: string; string_value?: string } }> }>>;
      };
      if (!sessionId) sessionId = data.session_id;
      const total = data.list?.[0]?.count ?? 0;
      const items = data.data?.['1'] ?? [];
      for (const item of items) {
        let id = '';
        let name = '';
        for (const f of item.moql_field_list ?? []) {
          if (f.key === 'work_item_id') id = String(f.value.long_value ?? '');
          else if (f.key === 'name') name = f.value.varchar_value ?? f.value.string_value ?? '';
        }
        if (id && !todos.has(id)) todos.set(id, { id, name });
      }
      if (todos.size >= total || items.length === 0) break;
      mqlPage++;
    }
  } catch (e) {
    console.warn('[digests] MQL fetch failed:', e);
  }

  return [...todos.values()];
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Count whole business days strictly between today and a future date. */
function businessDaysUntil(target: Date): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(target);
  end.setHours(0, 0, 0, 0);
  if (end <= today) return 0;
  let days = 0;
  const cursor = new Date(today);
  while (cursor < end) {
    cursor.setDate(cursor.getDate() + 1);
    const dow = cursor.getDay();
    if (dow !== 0 && dow !== 6) days++;
  }
  return days;
}

function daysSinceIsoDate(iso: string): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
}

function maxLevel(levels: RiskLevel[]): RiskLevel {
  if (levels.includes('red')) return 'red';
  if (levels.includes('yellow')) return 'yellow';
  return 'green';
}

// ─── Risk evaluation (Task 4) ──────────────────────────────────────────────

const REQUIRED_ROLES = ['PM', 'Tech owner', 'iOS', 'Android', 'Server', 'QA'];

export async function evaluateFeatureRisk(feature: MeegoFeature): Promise<RiskFinding> {
  const reasons: string[] = [];
  const levels: RiskLevel[] = [];

  const inQaOrLater = QA_OR_LATER_RAW.has(feature.rawStatus);

  // Freeze pressure — only when we know the target version
  if (feature.iosVersion) {
    const freezeDate = await getCodeFreezeDate(feature.iosVersion);
    if (freezeDate) {
      const days = businessDaysUntil(freezeDate);
      if (!inQaOrLater) {
        if (days <= 2) {
          reasons.push(`Code freeze in ${days} business day${days === 1 ? '' : 's'} but not yet in QA (target: v${feature.iosVersion})`);
          levels.push('red');
        } else if (days <= 5) {
          reasons.push(`Code freeze in ${days} business days and not yet in QA (target: v${feature.iosVersion})`);
          levels.push('yellow');
        }
      }
    }
  }

  // Stale check — no Meego updates in 7+ days
  const daysStale = feature.lastUpdatedIso ? daysSinceIsoDate(feature.lastUpdatedIso) : null;
  if (daysStale !== null && daysStale >= 7) {
    reasons.push(`No Meego updates in ${daysStale} days`);
    levels.push('red');
  }

  // Missing owner check
  const missing: string[] = [];
  for (const role of REQUIRED_ROLES) {
    if (!feature.roles[role] || feature.roles[role].length === 0) missing.push(role);
  }
  if (missing.length > 0) {
    reasons.push(`Missing ${missing.join(', ')} owner${missing.length === 1 ? '' : 's'}`);
    levels.push('yellow');
  }

  // Missing PRD
  if (!feature.prd) {
    reasons.push('PRD link not set');
    levels.push('yellow');
  }

  const level = reasons.length === 0 ? 'green' : maxLevel(levels);
  return { level, reasons, feature };
}

export function formatRiskDigest(findings: RiskFinding[]): string {
  const today = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const red = findings.filter(f => f.level === 'red');
  const yellow = findings.filter(f => f.level === 'yellow');
  const green = findings.filter(f => f.level === 'green');

  const lines: string[] = [];
  lines.push(`📊 Daily Risk Digest — ${today}`);
  lines.push('');

  if (red.length > 0) {
    lines.push(`🔴 High-risk (${red.length})`);
    for (const f of red) {
      const ver = f.feature.iosVersion ? `, v${f.feature.iosVersion}` : '';
      lines.push(`• ${f.feature.name} (${f.feature.rawStatus}${ver})`);
      for (const r of f.reasons) lines.push(`   · ${r}`);
    }
    lines.push('');
  }

  if (yellow.length > 0) {
    lines.push(`🟡 Watch (${yellow.length})`);
    for (const f of yellow) {
      const ver = f.feature.iosVersion ? `, v${f.feature.iosVersion}` : '';
      lines.push(`• ${f.feature.name} (${f.feature.rawStatus}${ver})`);
      for (const r of f.reasons) lines.push(`   · ${r}`);
    }
    lines.push('');
  }

  if (green.length > 0) {
    lines.push(`🟢 Healthy (${green.length})`);
    for (const f of green) {
      const ver = f.feature.iosVersion ? `, v${f.feature.iosVersion}` : '';
      lines.push(`• ${f.feature.name} (${f.feature.rawStatus}${ver}) — on track`);
    }
    lines.push('');
  }

  if (findings.length === 0) {
    lines.push('No features currently in development.');
  }

  return lines.join('\n').trim();
}

// ─── Unanswered Q&A check (Task 5) ─────────────────────────────────────────

const STAKEHOLDER_ROLES = ['PM', 'UI&UX', 'Tech owner', 'iOS', 'Android', 'Server', 'QA'];

export async function collectUnansweredForFeature(
  feature: MeegoFeature, sinceMs: number, token: string,
): Promise<UnansweredFinding | null> {
  if (!feature.chatId) return null;

  const stakeholderEmails = new Set<string>();
  for (const role of STAKEHOLDER_ROLES) {
    const names = feature.roles[role] ?? [];
    for (const name of names) {
      const email = feature.roleEmails[name];
      if (email) stakeholderEmails.add(email);
    }
  }
  if (stakeholderEmails.size === 0) return null;

  const emailToOpenId = await resolveOpenIds([...stakeholderEmails], token);
  const stakeholderOpenIds = new Set(Object.values(emailToOpenId));
  if (stakeholderOpenIds.size === 0) return null;

  let messages: ChatMessage[] = [];
  try {
    messages = await readChatMessages(feature.chatId, sinceMs, token);
  } catch (e) {
    console.warn(`[digests] failed to read messages for ${feature.name}:`, e);
    return null;
  }
  if (messages.length === 0) return null;

  const stakeholderMsgs = messages.filter(m => {
    const senderOpenId = m.sender?.sender_id?.open_id;
    if (!senderOpenId || !stakeholderOpenIds.has(senderOpenId)) return false;
    if (!m.mentions || m.mentions.length === 0) return false;
    if (m.parent_id) return false;
    return true;
  });
  if (stakeholderMsgs.length === 0) return null;

  const unanswered: UnansweredQuestion[] = [];
  for (const msg of stakeholderMsgs) {
    const hasReply = messages.some(m => m.root_id === msg.message_id || m.parent_id === msg.message_id);
    if (hasReply) continue;

    let text = '';
    try {
      const parsed = JSON.parse(msg.body?.content ?? '{}') as { text?: string };
      text = (parsed.text ?? '').trim();
    } catch {
      text = msg.body?.content ?? '';
    }
    for (const mention of msg.mentions ?? []) {
      text = text.replace(mention.key, '').trim();
    }

    unanswered.push({
      senderOpenId: msg.sender?.sender_id?.open_id ?? '',
      mentionNames: (msg.mentions ?? []).map(m => m.name),
      text: text.slice(0, 280),
      messageId: msg.message_id,
      timestamp: Number(msg.create_time ?? 0) * 1000,
    });
  }

  if (unanswered.length === 0) return null;
  return { feature, questions: unanswered.slice(0, 5) };
}

export function formatUnansweredDigest(findings: UnansweredFinding[]): string {
  const today = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const totalQs = findings.reduce((sum, f) => sum + f.questions.length, 0);

  const lines: string[] = [];
  lines.push(`💬 Daily Unanswered Questions — ${today}`);
  lines.push(`${totalQs} question${totalQs === 1 ? '' : 's'} across ${findings.length} feature${findings.length === 1 ? '' : 's'}`);
  lines.push('');

  for (const finding of findings) {
    lines.push(`${finding.feature.name} (${finding.feature.rawStatus})`);
    for (const q of finding.questions) {
      const time = q.timestamp > 0
        ? new Date(q.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
        : '';
      const mentioned = q.mentionNames.length > 0 ? ` → ${q.mentionNames.join(', ')}` : '';
      const preview = q.text || '(no text)';
      lines.push(`  • ${time}${mentioned}: "${preview}"`);
    }
    lines.push('');
  }

  return lines.join('\n').trim();
}

// ─── Main orchestrator ─────────────────────────────────────────────────────

export async function runDailyDigests(): Promise<DigestRunResult> {
  const ownerEmail = process.env.OWNER_EMAIL;
  if (!ownerEmail) throw new Error('OWNER_EMAIL not configured');

  // Step 1: Discover all PM-owned work items
  const allIds = await fetchAllPmOwnedIds(TIKTOK_PROJECT_KEY);
  console.log(`[digests] discovered ${allIds.length} PM-owned stories`);

  // Step 2: Fetch each feature's raw Meego state
  const features: MeegoFeature[] = [];
  for (const { id, name } of allIds) {
    const f = await fetchMeegoFeature(id, name, TIKTOK_PROJECT_KEY);
    if (f) features.push(f);
    await new Promise(r => setTimeout(r, 200));
  }
  console.log(`[digests] fetched raw state for ${features.length} features`);

  // Log the actual raw status distribution
  const statusCounts = new Map<string, number>();
  for (const f of features) {
    statusCounts.set(f.rawStatus || '(none)', (statusCounts.get(f.rawStatus || '(none)') ?? 0) + 1);
  }
  console.log(`[digests] raw status distribution: ${[...statusCounts.entries()].map(([s, n]) => `${s}:${n}`).join(', ')}`);

  // Step 3: Filter to in-dev features using the raw Chinese statuses
  const inDev = features.filter(f => isInDev(f.rawStatus));
  console.log(`[digests] ${inDev.length} features in dev (raw status)`);

  // Step 4: Evaluate risk
  const riskFindings: RiskFinding[] = [];
  for (const feature of inDev) {
    try {
      const finding = await evaluateFeatureRisk(feature);
      riskFindings.push(finding);
    } catch (e) {
      console.warn(`[digests] risk eval failed for ${feature.name}:`, e);
    }
  }
  const severityOrder: Record<RiskLevel, number> = { red: 0, yellow: 1, green: 2 };
  riskFindings.sort((a, b) => severityOrder[a.level] - severityOrder[b.level]);

  // Step 5: Get Rio token for DM delivery + chat reads
  let rioToken = '';
  try {
    rioToken = await getAgentToken('rio');
  } catch (e) {
    console.warn('[digests] failed to get Rio token:', e);
  }

  // Step 6: Collect unanswered questions
  // NOTE: feature.chatId is not resolved in this raw pipeline (we don't have
  // chat lookup here). For v1 we skip unanswered checks since we don't know
  // which Lark chat corresponds to each feature without going through Hamlet.
  // TODO: resolve chatId via lark chat search or by adding it to fetchMeegoFeature.
  const unansweredFindings: UnansweredFinding[] = [];

  // Step 7: Send risk digest (always)
  let riskSent = false;
  if (rioToken) {
    const riskText = formatRiskDigest(riskFindings);
    console.log('[digests] risk digest:\n' + riskText);
    const id = await sendDmByEmail(ownerEmail, riskText, rioToken);
    riskSent = id !== null;
  }

  // Step 8: Send unanswered digest (only if content)
  let unansweredSent = false;
  if (rioToken && unansweredFindings.length > 0) {
    const text = formatUnansweredDigest(unansweredFindings);
    console.log('[digests] unanswered digest:\n' + text);
    const id = await sendDmByEmail(ownerEmail, text, rioToken);
    unansweredSent = id !== null;
  } else {
    console.log(`[digests] no unanswered questions — skipping Q&A digest`);
  }

  return {
    featuresChecked: inDev.length,
    riskSent,
    unansweredSent,
    riskFindings,
    unansweredFindings,
  };
}

// Silence unused import warnings — kept for when chatId resolution is added.
export type { Feature };
