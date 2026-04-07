import { Feature } from './types';
import {
  readChatMessages,
  resolveOpenIds,
  sendTextMessage,
  sendInteractiveCardToChat,
  ChatMessage,
  CardSection,
  CardHeaderTemplate,
  PM_GROUP_CHAT_ID,
} from './lark';
import { getAgentToken } from './agents';
import { getCodeFreezeDate } from './merge-calendar';

// Direct Meego MCP client — duplicated here so the digest pipeline can talk to
// Meego without going through Hamlet's translation layer. We want raw Chinese
// node names for filtering and risk evaluation, not the English aliases that
// `syncFeatureStatus` produces.
const MEEGO_MCP_URL = 'https://meego.larkoffice.com/mcp_server/v1';
const TIKTOK_PROJECT_KEY = '5f105019a8b9a853da64767f';

async function callMeegoMcpOnce(toolName: string, args: Record<string, unknown>): Promise<string> {
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

  // The response may contain multiple content items. Pick the first one that
  // looks like the real payload (JSON, markdown, or any substantive text) —
  // not a rate-limit stub or a log_id footer.
  const items = data.result?.content ?? [];
  for (const item of items) {
    const text = (item.text ?? '').trim();
    if (!text) continue;
    if (/^rate limit/i.test(text)) continue;
    if (/^log_?id:/i.test(text)) continue;
    return text;
  }

  // If every item looked like rate-limit / log_id, surface that as the raw
  // text so the retry wrapper can detect it.
  return items[0]?.text ?? '';
}

/**
 * Call Meego MCP with retry-on-rate-limit. The MCP enforces a 5 QPS limit
 * per token; we stay under it in normal flow but occasionally bursts trip
 * the limit and the response comes back as the literal string "rate limit, qps: 5".
 */
async function callMeegoMcp(toolName: string, args: Record<string, unknown>): Promise<string> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const text = await callMeegoMcpOnce(toolName, args);
    if (!/^rate limit/i.test(text.trim())) return text;
    // Exponential-ish backoff: 600ms, 1200ms, 2400ms, 4800ms
    const wait = 600 * Math.pow(2, attempt);
    console.log(`[digests] Meego rate limited, retrying in ${wait}ms (attempt ${attempt + 1})`);
    await new Promise(r => setTimeout(r, wait));
  }
  throw new Error('Meego MCP rate limited after 4 retries');
}

// ─── Types ────────────────────────────────────────────────────────────────

export type RiskLevel = 'red' | 'yellow' | 'green';

/**
 * Raw-from-Meego feature metadata used by the digest pipeline.
 * IDs are the source of truth (stable across renames); display names are cached
 * for formatting the digest text.
 */
export interface MeegoFeature {
  workItemId: string;
  name: string;
  meegoUrl: string;
  overallStatusKey: string;         // e.g. 'end', 'scheduled', 'in_experiment'
  overallStatusName: string;        // e.g. '已完成', '开发中', '实验中'
  allNodeIds: string[];             // every entry in work_item_current_node (for filtering)
  currentNodeId: string;            // pickedNode.id — most-relevant node (for display/risk)
  currentNodeName: string;          // pickedNode.name — for display
  chatId?: string;
  iosVersion?: string;
  // Pipeline kind controls how the deadline is resolved + displayed:
  //   'mobile' → uses iOS/Android version + merge calendar code freeze date
  //   'server' → uses the "Server Planned Launch Date" Meego field
  pipelineKind?: 'mobile' | 'server';
  // Server planned launch date for server-only features (ISO YYYY-MM-DD).
  // Sourced from the "Server Planned Launch Date" form item — looked up by
  // its stable Meego field key.
  serverPlannedLaunchDate?: string;
  lastUpdatedIso?: string;          // YYYY-MM-DD
  prd?: string;
  priority?: string;                // e.g. 'P0', 'P1'
  roles: Record<string, string[]>;  // keyed by role key (e.g. 'Tech_Owner'), NOT name
  roleDisplayNames: Record<string, string>; // role key → display name (for formatting)
  roleEmails: Record<string, string>;
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

// ─── In-dev filter (by Meego node IDs) ───────────────────────────────────

/**
 * A feature is considered "in development" if at least one of its currently-
 * active nodes is a dev stage:
 *   - state_41 → iOS 开发 (iOS Dev)
 *   - state_42 → Android 开发 (Android Dev)
 *   - state_43 → Server 开发 (Server Dev)
 *
 * Mobile dev (state_41 / state_42) takes priority for risk evaluation: a
 * feature with both mobile AND server dev active is treated as a mobile
 * feature and uses the merge-calendar code freeze date. Only features whose
 * sole active dev stage is server dev fall back to the "Server Planned
 * Launch Date" field.
 *
 * Using IDs (not Chinese names) so the filter keeps working if Meego renames
 * statuses.
 */
const MOBILE_DEV_NODE_IDS = new Set<string>([
  'state_41',  // iOS 开发
  'state_42',  // Android 开发
]);
const SERVER_DEV_NODE_ID = 'state_43';

const DEV_NODE_IDS = new Set<string>([...MOBILE_DEV_NODE_IDS, SERVER_DEV_NODE_ID]);

function isInDev(allActiveNodeIds: string[]): boolean {
  return allActiveNodeIds.some(id => DEV_NODE_IDS.has(id));
}

/** Classify whether an in-dev feature should use the mobile or server pipeline. */
function classifyPipelineKind(allActiveNodeIds: string[]): 'mobile' | 'server' | undefined {
  if (allActiveNodeIds.some(id => MOBILE_DEV_NODE_IDS.has(id))) return 'mobile';
  if (allActiveNodeIds.includes(SERVER_DEV_NODE_ID)) return 'server';
  return undefined;
}

// ─── Node priority (for picking the most-advanced active node) ────────────

/**
 * Node ID priority — the earliest matching ID is considered the "current" stage
 * when a feature has multiple active nodes. Add more IDs as we encounter them.
 */
const NODE_ID_PRIORITY = [
  // Pre-dev
  'state_61',              // 依赖判断 — Dependency Check
  // Tech / design stages
  'state_1',               // 内容设计&Starling提交
  'privacy_info_register', // 隐私技术信息登记
  'ios_review_risk_check', // iOS审核风险排查
  // Dev stages
  'state_41',              // iOS 开发
  'state_42',              // Android 开发
  'state_43',              // Server 开发
  'state_34',              // 自动化测试
  'qa_test_preparation',   // QA测试准备
  // Post-dev
  'UAT_UIUX',              // UI&UX验收
  'launch_ab',             // AB实验
  'PM_acceptance',         // PM验收
];

/**
 * Fallback name priority for nodes whose IDs aren't in NODE_ID_PRIORITY yet.
 * Matches lib/meego.ts NODE_PRIORITY.
 */
const NODE_NAME_PRIORITY = [
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

/** Pick the earliest active node from a list, preferring node IDs, falling back to names. */
function pickActiveNode(nodes: ParsedActiveNode[]): ParsedActiveNode | null {
  if (nodes.length === 0) return null;
  return nodes.slice().sort((a, b) => {
    const ia = NODE_ID_PRIORITY.indexOf(a.key);
    const ib = NODE_ID_PRIORITY.indexOf(b.key);
    if (ia !== -1 || ib !== -1) {
      return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib);
    }
    const na = NODE_NAME_PRIORITY.indexOf(a.name);
    const nb = NODE_NAME_PRIORITY.indexOf(b.name);
    return (na === -1 ? Infinity : na) - (nb === -1 ? Infinity : nb);
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

interface BriefField {
  key?: string;
  name?: string;
  value?: unknown;
}

interface BriefJson {
  work_item_attribute?: {
    work_item_status?: { key?: string; name?: string };
    work_item_id?: string;
    work_item_name?: string;
    role_members?: Array<{ key?: string; name?: string; members?: Array<{ key?: string; name?: string; email?: string }> }>;
  };
  work_item_current_node?: Array<{
    id?: string;
    name?: string;
    owners?: Array<{ key?: string; name?: string; email?: string }>;
    actual_begin_time?: string;
  }>;
  work_item_fields?: BriefField[];
}

/** Get a single field value from the work_item_fields array by key. */
function getField(fields: BriefField[] | undefined, key: string): unknown {
  return fields?.find(f => f.key === key)?.value;
}

/** Get a string-typed field (handles both plain strings and {value, label}). */
function getStringField(fields: BriefField[] | undefined, key: string): string {
  const v = getField(fields, key);
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && 'value' in v) {
    const obj = v as Record<string, unknown>;
    return typeof obj.value === 'string' ? obj.value : '';
  }
  return '';
}

/**
 * Get a select-option field's display label. Priority comes back as either a
 * plain string or a `{ value, label }` object depending on the field type;
 * we prefer label for user-facing text.
 */
function getLabelField(fields: BriefField[] | undefined, key: string): string {
  const v = getField(fields, key);
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    if (typeof obj.label === 'string') return obj.label;
    if (typeof obj.name === 'string') return obj.name;
    if (typeof obj.value === 'string') return obj.value;
  }
  return '';
}

/** Get the ISO date string from a timestamp field like start_time. */
function getDateField(fields: BriefField[] | undefined, key: string): string {
  const v = getField(fields, key);
  if (v && typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    const iso = typeof obj.iso_time === 'string' ? obj.iso_time : '';
    if (iso) {
      const m = iso.match(/(\d{4}-\d{2}-\d{2})/);
      if (m) return m[1];
    }
    const ts = typeof obj.timestamp === 'number' ? obj.timestamp : 0;
    if (ts > 0) return new Date(ts).toISOString().split('T')[0];
  }
  return '';
}

/** Extract active nodes from the parsed brief JSON. */
function parseActiveNodesFromJson(json: BriefJson): ParsedActiveNode[] {
  const current = json.work_item_current_node ?? [];
  return current
    .filter(n => n.name)
    .map(n => ({
      key: n.id ?? '',
      name: n.name ?? '',
      owners: (n.owners ?? []).map(o => o.email ?? '').filter(Boolean).join(','),
    }));
}

/** Get the overall work item status key/name, e.g. {key: 'end', name: '已完成'}. */
function parseOverallStatus(json: BriefJson): { key: string; name: string } {
  const s = json.work_item_attribute?.work_item_status;
  return { key: s?.key ?? '', name: s?.name ?? '' };
}

/**
 * Extract roles and name→email map from the parsed brief JSON.
 * Roles are keyed by the stable Meego role key (e.g. `Tech_Owner`, `PM`, `iOS`)
 * rather than the display name (`Tech owner`, `PM`, `iOS`) so the filter keeps
 * working if Meego relabels a role. Display names are cached alongside for the
 * digest text.
 */
function parseRolesFromJson(json: BriefJson): {
  roles: Record<string, string[]>;        // role key → list of member display names
  roleDisplayNames: Record<string, string>; // role key → display name (for formatting)
  emails: Record<string, string>;          // member display name → email
} {
  const roles: Record<string, string[]> = {};
  const roleDisplayNames: Record<string, string> = {};
  const emails: Record<string, string> = {};
  for (const roleEntry of json.work_item_attribute?.role_members ?? []) {
    const roleKey = roleEntry.key;
    if (!roleKey) continue;
    if (roleEntry.name) roleDisplayNames[roleKey] = roleEntry.name;
    const memberNames: string[] = [];
    for (const m of roleEntry.members ?? []) {
      if (m.name) {
        memberNames.push(m.name);
        if (m.email) emails[m.name] = m.email;
      }
    }
    if (memberNames.length > 0) roles[roleKey] = memberNames;
  }
  return { roles, roleDisplayNames, emails };
}

/** Fallback markdown field parser (kept for PRD / updated_at which may not be in typed JSON). */
function parseWorkItemField(raw: string, fieldName: string): string {
  const regex = new RegExp(`\\|\\s*${fieldName}\\s*\\|\\s*([^|\\n]+?)\\s*\\|`);
  const match = raw.match(regex);
  return match ? match[1].trim() : '';
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
      fields: ['wiki', 'priority', 'field_due3fb', 'field_532e61', 'field_a4c558', 'field_2e7909', 'start_time', 'updated_at'],
    });
  } catch (e) {
    console.warn(`[digests] failed to fetch brief for ${name}:`, e);
    return null;
  }

  // Parse the brief as typed JSON
  let json: BriefJson;
  try {
    json = JSON.parse(raw) as BriefJson;
  } catch {
    console.warn(`[digests] brief not JSON for ${name}`);
    return null;
  }

  const overall = parseOverallStatus(json);
  const activeNodes = parseActiveNodesFromJson(json);
  const pickedNode = pickActiveNode(activeNodes);
  const fields = json.work_item_fields;

  // Extract PRD, updated time, etc. from the typed work_item_fields array
  const prd = getStringField(fields, 'wiki');
  const lastUpdatedIso = getDateField(fields, 'updated_at') || getDateField(fields, 'start_time');
  const priority = getLabelField(fields, 'priority');

  const { roles, roleDisplayNames, emails: roleEmails } = parseRolesFromJson(json);
  const activeNodeOwnerEmails = pickedNode?.owners ?? '';

  return {
    workItemId,
    name,
    meegoUrl,
    overallStatusKey: overall.key,
    overallStatusName: overall.name,
    allNodeIds: activeNodes.map(n => n.key).filter(Boolean),
    currentNodeId: pickedNode?.key ?? '',
    currentNodeName: pickedNode?.name ?? '',
    iosVersion: undefined,  // resolved later for in-dev features only
    lastUpdatedIso,
    prd: prd || undefined,
    priority: priority || undefined,
    roles,
    roleDisplayNames,
    roleEmails,
    activeNodeOwnerEmails,
  };
}

// ─── iOS version resolution ───────────────────────────────────────────────

/**
 * Resolve the iOS planned version (e.g. "44.9") for a work item.
 *
 * The version is stored as a node-level field (`field_08a9ca`) on the
 * `qa_test_preparation` node, containing a JSON array of version work item IDs.
 * Each version ID must be resolved via another get_workitem_brief call to get
 * the version name, then the shortest numeric version (e.g. 44.9) is returned.
 *
 * Only called for already-filtered in-dev features to minimise MCP load.
 */
async function resolveIosVersion(meegoUrl: string): Promise<string> {
  let nodeRaw: string;
  try {
    nodeRaw = await callMeegoMcp('get_node_detail', { url: meegoUrl });
  } catch {
    return '';
  }

  interface NodeFormItem { field_key?: string; field_name?: string; value?: string; value_label?: string }
  interface NodeEntry { basic?: { node_key?: string; name?: string }; form_items?: NodeFormItem[] }
  let nodeData: { list?: NodeEntry[] };
  try {
    nodeData = JSON.parse(nodeRaw) as { list?: NodeEntry[] };
  } catch {
    return '';
  }

  // Collect work item IDs from field_08a9ca (iOS) then field_c88970 (Android) as fallback
  function collectVersionIds(fieldKey: string): number[] {
    const ids: number[] = [];
    for (const node of nodeData.list ?? []) {
      for (const fi of node.form_items ?? []) {
        if (fi.field_key !== fieldKey) continue;
        try {
          const parsed = JSON.parse(fi.value ?? '[]') as number[];
          for (const id of parsed) if (!ids.includes(id)) ids.push(id);
        } catch { /* skip */ }
      }
    }
    return ids;
  }

  let versionIds = collectVersionIds('field_08a9ca');
  if (versionIds.length === 0) versionIds = collectVersionIds('field_c88970');
  if (versionIds.length === 0) return '';

  // Resolve each version work item ID → version name → short form (e.g. 44.9)
  const names: string[] = [];
  for (const id of versionIds) {
    try {
      const versionRaw = await callMeegoMcp('get_workitem_brief', {
        url: `https://meego.larkoffice.com/${TIKTOK_PROJECT_KEY}/version/detail/${id}`,
      });
      // Version brief: look for work item name in the JSON or markdown
      try {
        const parsed = JSON.parse(versionRaw) as BriefJson;
        const vname = parsed.work_item_attribute?.work_item_name;
        if (vname) names.push(vname);
      } catch {
        // Fallback to markdown parsing for older-format responses
        const nameMatch = versionRaw.match(/工作项名称\s*\|\s*([^|\n]+)/);
        if (nameMatch) names.push(nameMatch[1].trim());
      }
    } catch { /* skip */ }
  }

  // Extract short numeric version (e.g. "44.9" from "TikTok-M-iOS-44.9.0") and pick the lowest
  const shortNames = names
    .map(n => {
      const m = n.match(/(\d+\.\d+)(?:\.\d+)?$/);
      return m ? m[1] : '';
    })
    .filter(Boolean);
  if (shortNames.length === 0) return '';
  shortNames.sort((a, b) => {
    const [aMaj, aMin] = a.split('.').map(Number);
    const [bMaj, bMin] = b.split('.').map(Number);
    return (aMaj - bMaj) || ((aMin ?? 0) - (bMin ?? 0));
  });
  return shortNames[0];
}

// ─── Server planned launch date resolution ───────────────────────────────

/**
 * Known field keys for the "Server Planned Launch Date" form item across any
 * Meego node. Add IDs here as they're discovered. The lookup falls back to a
 * name-based search and logs the discovered key so new IDs can be promoted
 * to this list after a single deploy.
 */
const SERVER_PLANNED_LAUNCH_FIELD_KEYS: string[] = [];

/**
 * Pull a YYYY-MM-DD date out of a raw Meego field value. Date fields come
 * back in several shapes: ISO strings, timestamps in seconds or milliseconds,
 * or wrapped objects like `{iso_time, timestamp}`. We accept all defensively.
 */
function extractDateFromValue(rawValue: string): string {
  if (!rawValue) return '';

  function toIso(value: unknown): string {
    if (typeof value === 'number' && value > 0) {
      const ms = value > 1e12 ? value : value * 1000; // assume seconds when < 1e12
      const d = new Date(ms);
      if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
    }
    if (typeof value === 'string') {
      const m = value.match(/(\d{4}-\d{2}-\d{2})/);
      if (m) return m[1];
      const ts = Number(value);
      if (!isNaN(ts) && ts > 0) return toIso(ts);
    }
    if (value && typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      if (typeof obj.iso_time === 'string') return toIso(obj.iso_time);
      if (typeof obj.timestamp === 'number') return toIso(obj.timestamp);
      // Date-range objects: pick the start, since the field itself is meant
      // to represent a single launch date — anything else is conservative.
      const single =
        (typeof obj.value === 'number' || typeof obj.value === 'string') ? obj.value : null;
      if (single !== null) return toIso(single);
    }
    return '';
  }

  // Try plain JSON first.
  try {
    const parsed = JSON.parse(rawValue);
    const iso = toIso(parsed);
    if (iso) return iso;
  } catch { /* not JSON, fall through */ }

  // Plain string fallback.
  return toIso(rawValue);
}

/**
 * Resolve the "Server Planned Launch Date" for a server-only feature.
 *
 * The field is a node-level form item — we don't yet know which node, so we
 * walk every node returned by `get_node_detail` looking for it. Lookup
 * order:
 *   1. Known stable field keys (SERVER_PLANNED_LAUNCH_FIELD_KEYS)
 *   2. Name match: any of "Server Planned Launch Date", "服务端预计上线日期",
 *      similar variants
 * The discovered field key + node key + raw value are logged on first hit so
 * we can promote the key to the hard-coded list.
 *
 * Returns ISO YYYY-MM-DD or empty string when nothing usable is found.
 */
async function resolveServerPlannedLaunchDate(meegoUrl: string): Promise<string> {
  let nodeRaw: string;
  try {
    nodeRaw = await callMeegoMcp('get_node_detail', { url: meegoUrl });
  } catch {
    return '';
  }

  interface NodeFormItem { field_key?: string; field_name?: string; field_alias?: string; value?: string; value_label?: string }
  interface NodeEntry { basic?: { node_key?: string; name?: string }; form_items?: NodeFormItem[] }
  let nodeData: { list?: NodeEntry[] };
  try {
    nodeData = JSON.parse(nodeRaw) as { list?: NodeEntry[] };
  } catch {
    return '';
  }

  // 1) Lookup by known stable field key, walking every node.
  for (const node of nodeData.list ?? []) {
    for (const fi of node.form_items ?? []) {
      if (fi.field_key && SERVER_PLANNED_LAUNCH_FIELD_KEYS.includes(fi.field_key)) {
        const iso = extractDateFromValue(fi.value ?? '');
        if (iso) return iso;
      }
    }
  }

  // 2) Fallback: name match. Lots of variants supported because we're not
  // yet sure exactly how the field is labelled.
  const NAME_RE = /server\s*planned\s*launch\s*date|服务端\s*预计\s*上线\s*日期|服务端\s*计划\s*上线|server\s*launch\s*date/i;
  for (const node of nodeData.list ?? []) {
    for (const fi of node.form_items ?? []) {
      const name = fi.field_name ?? '';
      const alias = fi.field_alias ?? '';
      if (NAME_RE.test(name) || NAME_RE.test(alias)) {
        console.log(
          `[digests] discovered Server Planned Launch Date field on node=${node.basic?.node_key} key=${fi.field_key} name=${fi.field_name} value=${(fi.value ?? '').slice(0, 200)}`,
        );
        const iso = extractDateFromValue(fi.value ?? '');
        if (iso) return iso;
        // Found the field but value is empty — return empty so the missing-
        // schedule risk fires downstream.
        return '';
      }
    }
  }

  // No match anywhere — log every form item name across every node so we can
  // pick the right one offline.
  const summary = (nodeData.list ?? [])
    .map(n => {
      const items = (n.form_items ?? [])
        .map(i => `${i.field_key ?? '?'}=${i.field_name ?? '?'}`)
        .join(', ');
      return `${n.basic?.node_key ?? '?'}[${items}]`;
    })
    .join(' | ');
  console.log(`[digests] no Server Planned Launch Date field found; available nodes/fields: ${summary}`);
  return '';
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

// Role keys (stable IDs) required to exist for an in-dev feature, by pipeline
// kind. Role keys are the `key` values from work_item_attribute.role_members
// (e.g. `PM`, `Tech_Owner`, `iOS`, `Android`, `Server`, `QA`). Server-only
// features intentionally drop iOS/Android since they don't apply.
const REQUIRED_ROLE_KEYS_MOBILE: Array<{ key: string; label: string }> = [
  { key: 'PM',         label: 'PM' },
  { key: 'Tech_Owner', label: 'Tech Owner' },
  { key: 'iOS',        label: 'iOS' },
  { key: 'Android',    label: 'Android' },
  { key: 'Server',     label: 'Server' },
  { key: 'QA',         label: 'QA' },
];
const REQUIRED_ROLE_KEYS_SERVER: Array<{ key: string; label: string }> = [
  { key: 'PM',         label: 'PM' },
  { key: 'Tech_Owner', label: 'Tech Owner' },
  { key: 'Server',     label: 'Server' },
  { key: 'QA',         label: 'QA' },
];

export async function evaluateFeatureRisk(feature: MeegoFeature): Promise<RiskFinding> {
  const reasons: string[] = [];
  const levels: RiskLevel[] = [];

  // Deadline pressure. Mobile features use the merge calendar code freeze
  // date for their planned version; server-only features use the "Server
  // Planned Launch Date" field. The "not yet in QA" check is implicit — if
  // dev is still active, QA can't have started.
  if (feature.pipelineKind === 'mobile' && feature.iosVersion) {
    const freezeDate = await getCodeFreezeDate(feature.iosVersion);
    if (freezeDate) {
      const days = businessDaysUntil(freezeDate);
      if (days <= 2) {
        reasons.push(`Code freeze in ${days} business day${days === 1 ? '' : 's'} but dev still in progress (target: v${feature.iosVersion})`);
        levels.push('red');
      } else if (days <= 5) {
        reasons.push(`Code freeze in ${days} business days with dev still in progress (target: v${feature.iosVersion})`);
        levels.push('yellow');
      }
    }
  } else if (feature.pipelineKind === 'server') {
    if (feature.serverPlannedLaunchDate) {
      const launchDate = new Date(feature.serverPlannedLaunchDate);
      if (!isNaN(launchDate.getTime())) {
        const days = businessDaysUntil(launchDate);
        const display = formatFreezeDate(launchDate);
        if (days <= 2) {
          reasons.push(`Server planned to launch in ${days} business day${days === 1 ? '' : 's'} but dev still in progress (target: ${display})`);
          levels.push('red');
        } else if (days <= 5) {
          reasons.push(`Server planned to launch in ${days} business days with dev still in progress (target: ${display})`);
          levels.push('yellow');
        }
      }
    } else {
      // No planned launch date on the work item — surface as a yellow risk
      // so the PM nudges the server team to fill it in.
      reasons.push('Server planned launch date not set');
      levels.push('yellow');
    }
  }

  // Stale check — no Meego updates in 7+ days
  const daysStale = feature.lastUpdatedIso ? daysSinceIsoDate(feature.lastUpdatedIso) : null;
  if (daysStale !== null && daysStale >= 7) {
    reasons.push(`No Meego updates in ${daysStale} days`);
    levels.push('red');
  }

  // Missing owner check (by stable role key) — required role list depends on
  // pipeline kind so server-only features aren't dinged for missing iOS/Android.
  const requiredRoles = feature.pipelineKind === 'server'
    ? REQUIRED_ROLE_KEYS_SERVER
    : REQUIRED_ROLE_KEYS_MOBILE;
  const missing: string[] = [];
  for (const { key, label } of requiredRoles) {
    if (!feature.roles[key] || feature.roles[key].length === 0) missing.push(label);
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

// ─── Status bucketing for the card-style digest ──────────────────────────

/**
 * Map a Meego work item's current node + overall status to a generic bucket
 * label shown in the digest. The user-facing label is intentionally coarse
 * (In Development / In QA / In AB Test / Launched) — the exact stage doesn't
 * matter for the digest reader.
 */
function bucketStatus(currentNodeId: string, overallStatusKey: string): string {
  if (overallStatusKey === 'end') return 'Launched';
  // QA-stage node IDs observed in the [digests] active node ID counts log:
  //   qa_test_preparation, state_40 / 41 / 42 / 46 (various QA / UAT stages)
  if (currentNodeId === 'qa_test_preparation') return 'In QA';
  if (/^state_(40|41|42|46)$/.test(currentNodeId)) return 'In QA';
  if (currentNodeId === 'UAT_UIUX') return 'In QA';
  // AB experiment stages
  if (currentNodeId === 'launch_ab' || /ab_?(test|experiment)/i.test(currentNodeId)) return 'In AB Test';
  // Default for everything else that passed the in-dev filter
  return 'In Development';
}

/** Format a freeze date as `D MMM` in Singapore time, e.g. "16 Apr". */
function formatFreezeDate(d: Date): string {
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'Asia/Singapore',
  });
}

/** Map a risk level to its display emoji + label. */
function levelDisplay(level: RiskLevel): { emoji: string; label: string } {
  if (level === 'red')    return { emoji: '🔴', label: 'High' };
  if (level === 'yellow') return { emoji: '🟡', label: 'Medium' };
  return { emoji: '🟢', label: 'Low' };
}

/**
 * Escape lark_md formatting markers in user-supplied text. We only escape
 * `*` and `_` (bold/italic) because Lark's lark_md parser doesn't reliably
 * strip backslashes in front of other chars — so escaping `[` renders as a
 * literal `\[` in the card. Square brackets are safe as long as they aren't
 * followed by a `(url)` clause, which is unlikely in feature names.
 */
function escapeMd(text: string): string {
  return text.replace(/([*_])/g, '\\$1');
}

/**
 * Build the lark_md content block for one feature in the risk digest card.
 * Uses bold for the feature name and a bullet list for the details.
 *
 * The Meego and PRD links are rendered inline next to the feature name as
 * `(Meego, PRD)` rather than as Lark card buttons, so the entire section is
 * a single text block.
 */
async function buildFeatureSectionContent(finding: RiskFinding): Promise<string> {
  const f = finding.feature;
  const { emoji, label } = levelDisplay(finding.level);

  // Build the inline link list: always Meego, plus PRD if set.
  const linkParts: string[] = [`[Meego](${f.meegoUrl})`];
  if (f.prd) linkParts.push(`[PRD](${f.prd})`);
  const linkSuffix = ` (${linkParts.join(', ')})`;

  const lines: string[] = [];
  // Bold header with coloured dot + feature name + inline links
  lines.push(`**${emoji} ${escapeMd(f.name)}**${linkSuffix}`);

  // Priority (if known)
  if (f.priority) {
    lines.push(`**Priority:** ${escapeMd(f.priority)}`);
  }

  // Tech Owner — only if populated
  const techOwners = (f.roles['Tech_Owner'] ?? []).join(', ');
  if (techOwners) {
    lines.push(`**Tech Owner:** ${escapeMd(techOwners)}`);
  }

  // Generic status bucket — server-only features get a more specific label.
  const statusLabel = f.pipelineKind === 'server'
    ? 'In Server Development'
    : bucketStatus(f.currentNodeId, f.overallStatusKey);
  lines.push(`**Status:** ${statusLabel}`);

  // Deadline display: mobile features show their planned version + code freeze
  // date; server-only features show the Server Planned Launch Date.
  if (f.pipelineKind === 'mobile' && f.iosVersion) {
    let versionText = f.iosVersion;
    try {
      const freeze = await getCodeFreezeDate(f.iosVersion);
      if (freeze) versionText = `${f.iosVersion} (${formatFreezeDate(freeze)})`;
    } catch { /* fall back to plain version */ }
    lines.push(`**Version:** ${escapeMd(versionText)}`);
  } else if (f.pipelineKind === 'server' && f.serverPlannedLaunchDate) {
    const launchDate = new Date(f.serverPlannedLaunchDate);
    if (!isNaN(launchDate.getTime())) {
      lines.push(`**Planned launch:** ${formatFreezeDate(launchDate)}`);
    }
  }

  // Risk: level with reasons in parens if any
  const riskValue = finding.reasons.length > 0
    ? `${label} (${finding.reasons.map(escapeMd).join(', ')})`
    : label;
  lines.push(`**Risk:** ${riskValue}`);

  return lines.join('\n');
}

/**
 * Build the full risk digest as a Lark interactive card. Each feature is a
 * section separated by horizontal rules. The Meego and PRD links are
 * rendered inline next to the feature name (not as card buttons), so the
 * sections are pure text blocks.
 *
 * Header colour reflects the highest risk tier found in the digest.
 *
 * Cards are ordered red → yellow → green so the highest-risk items appear
 * first.
 */
export async function buildRiskDigestCard(findings: RiskFinding[]): Promise<{
  title: string;
  template: CardHeaderTemplate;
  sections: CardSection[];
}> {
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'Asia/Singapore',
  });
  const title = `🔥 Daily Risk Assessment — ${today}`;

  const sorted = findings.slice().sort((a, b) => {
    const order: Record<RiskLevel, number> = { red: 0, yellow: 1, green: 2 };
    return order[a.level] - order[b.level];
  });

  // Header colour reflects the highest risk found in the digest.
  const topLevel: RiskLevel = sorted[0]?.level ?? 'green';
  const template: CardHeaderTemplate =
    topLevel === 'red' ? 'red' :
    topLevel === 'yellow' ? 'orange' :
    'green';

  const sections: CardSection[] = [];
  if (sorted.length === 0) {
    sections.push({ content: 'No features currently in development.' });
    return { title, template, sections };
  }

  for (const finding of sorted) {
    const content = await buildFeatureSectionContent(finding);
    sections.push({ content });
  }

  return { title, template, sections };
}

// ─── Unanswered Q&A check (Task 5) ─────────────────────────────────────────

// Stakeholder role KEYS (stable IDs) — anyone with an @-mention in these
// roles whose question goes unanswered is surfaced in the digest.
const STAKEHOLDER_ROLE_KEYS = ['PM', 'UI_UX', 'UI&UX', 'Tech_Owner', 'iOS', 'Android', 'Server', 'QA'];

export async function collectUnansweredForFeature(
  feature: MeegoFeature, sinceMs: number, token: string,
): Promise<UnansweredFinding | null> {
  if (!feature.chatId) return null;

  const stakeholderEmails = new Set<string>();
  for (const roleKey of STAKEHOLDER_ROLE_KEYS) {
    const names = feature.roles[roleKey] ?? [];
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
    const stage = finding.feature.currentNodeName || finding.feature.overallStatusName;
    lines.push(`${finding.feature.name} (${stage})`);
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
  // Destination for both the risk digest and the unanswered Q&A digest.
  // Previously DM'd to OWNER_EMAIL; now posted to the PM group chat.
  const targetChatId = PM_GROUP_CHAT_ID;

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

  // Log distribution of active node IDs across all features (how many times
  // each ID appears as one of a feature's active nodes). This is what the
  // filter actually operates on.
  const nodeIdCounts = new Map<string, number>();
  for (const f of features) {
    if (f.allNodeIds.length === 0) {
      nodeIdCounts.set('(no active nodes)', (nodeIdCounts.get('(no active nodes)') ?? 0) + 1);
    } else {
      for (const id of f.allNodeIds) {
        nodeIdCounts.set(id, (nodeIdCounts.get(id) ?? 0) + 1);
      }
    }
  }
  console.log(`[digests] active node ID counts: ${[...nodeIdCounts.entries()].map(([s, n]) => `${s}:${n}`).join(', ')}`);

  // Step 3: Filter to in-dev features — iOS / Android / Server dev in progress.
  // Mobile dev (state_41/42) takes priority; pure server-only features
  // (state_43 with no mobile dev active) get the server-pipeline treatment.
  const inDev = features.filter(f => isInDev(f.allNodeIds));
  for (const f of inDev) f.pipelineKind = classifyPipelineKind(f.allNodeIds);
  const mobileCount = inDev.filter(f => f.pipelineKind === 'mobile').length;
  const serverCount = inDev.filter(f => f.pipelineKind === 'server').length;
  console.log(`[digests] ${inDev.length} features in dev (mobile: ${mobileCount}, server-only: ${serverCount})`);

  // Step 3b: Resolve the deadline source per pipeline kind. Mobile features
  // need their planned iOS/Android version (used to look up the merge
  // calendar code freeze date); server-only features need the "Server Planned
  // Launch Date" Meego field. Both calls are expensive so only run after
  // the in-dev filter.
  for (const f of inDev) {
    try {
      if (f.pipelineKind === 'mobile') {
        f.iosVersion = await resolveIosVersion(f.meegoUrl);
      } else if (f.pipelineKind === 'server') {
        f.serverPlannedLaunchDate = await resolveServerPlannedLaunchDate(f.meegoUrl);
      }
      await new Promise(r => setTimeout(r, 300));
    } catch (e) {
      console.warn(`[digests] deadline lookup failed for ${f.name}:`, e);
    }
  }
  const resolvedMobile = inDev.filter(f => f.pipelineKind === 'mobile' && f.iosVersion).length;
  const resolvedServer = inDev.filter(f => f.pipelineKind === 'server' && f.serverPlannedLaunchDate).length;
  console.log(
    `[digests] resolved iOS version ${resolvedMobile}/${mobileCount}, server launch date ${resolvedServer}/${serverCount}`,
  );

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

  // Step 7: Send risk digest (always) — interactive card with per-feature
  // buttons, posted to the PM group chat.
  let riskSent = false;
  if (rioToken) {
    const card = await buildRiskDigestCard(riskFindings);
    const preview = [card.title, ...card.sections.map(s => s.content)].join('\n---\n');
    console.log('[digests] risk digest:\n' + preview);
    const id = await sendInteractiveCardToChat(
      targetChatId, card.title, card.template, card.sections, rioToken,
    );
    riskSent = id !== null;
  }

  // Step 8: Send unanswered digest (only if content) — plain text to the PM
  // group chat, same destination as the risk digest.
  let unansweredSent = false;
  if (rioToken && unansweredFindings.length > 0) {
    const text = formatUnansweredDigest(unansweredFindings);
    console.log('[digests] unanswered digest:\n' + text);
    const id = await sendTextMessage(targetChatId, text, rioToken);
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
