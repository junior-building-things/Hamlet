import { GoogleGenerativeAI } from '@google/generative-ai';
import { Feature } from './types';
import {
  readChatMessages,
  resolveOpenIds,
  sendInteractiveCardToChat,
  joinFeatureChat,
  listJuniorChats,
  getLarkBotToken,
  refreshUserToken,
  searchAbReport,
  extractFigmaUrlFromPrd,
  ChatMessage,
  CardSection,
  CardHeaderTemplate,
  PM_GROUP_CHAT_ID,
} from './lark';
import { getAgentToken } from './agents';
import { getCodeFreezeDate } from './merge-calendar';
import {
  loadDigestState,
  saveDigestState,
  pruneStaleRisks,
  dropExitedFeatures,
  recordRunTime,
  previousRunCutoffMs,
  isJuniorChatsCacheFresh,
  getWatchlist,
  PersistedDelayChange,
  DigestStateFile,
  JuniorChatCacheEntry,
} from './digest-state';

// Direct Meego MCP client — duplicated here so the digest pipeline can talk to
// Meego without going through Hamlet's translation layer. We want raw Chinese
// node names for filtering and risk evaluation, not the English aliases that
// `syncFeatureStatus` produces.
const MEEGO_MCP_URL = 'https://meego.larkoffice.com/mcp_server/v1';
const TIKTOK_PROJECT_KEY = '5f105019a8b9a853da64767f';

// ─── Task 3: link field keys ──────────────────────────────────────────────
// Discovered via the field meta probe. These are work-item level fields.
const FIELD_KEY_FIGMA = 'ui_design_zeplin_link';          // UI&UX设计文档
const FIELD_KEY_AB_REPORT = 'effect_analyze_report_t';  // TikTok-T 实验报告
const FIELD_KEY_VERSION_NUMBER = 'description';          // 描述 (Description) — overwritten with short version number

// Version source fields — launched takes priority over planned.
const VERSION_LAUNCHED_FIELDS = ['ios_actual_online_version', 'android_actual_online_version'];
const VERSION_PLANNED_FIELDS  = ['field_08a9ca', 'field_c88970'];

/** Cooldown before re-searching a feature whose links came back empty. */
const LINK_RETRY_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Extract the shortest numeric version (e.g. "44.9") from version field
 * values. Version fields come as arrays of `{id, name}` objects where
 * `name` is like "TikTok-M-iOS-44.9.0". Returns all short versions found,
 * sorted ascending.
 */
function extractShortVersions(fieldValue: unknown): string[] {
  if (!fieldValue) return [];
  const items: Array<{ name?: string }> = Array.isArray(fieldValue) ? fieldValue : [fieldValue];
  const versions: string[] = [];
  for (const item of items) {
    const name = typeof item === 'string' ? item : (item?.name ?? '');
    const m = name.match(/(\d+\.\d+)(?:\.\d+)?/);
    if (m) versions.push(m[1]);
  }
  versions.sort((a, b) => {
    const [aMaj, aMin] = a.split('.').map(Number);
    const [bMaj, bMin] = b.split('.').map(Number);
    return (aMaj - bMaj) || ((aMin ?? 0) - (bMin ?? 0));
  });
  return versions;
}

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
  // not a rate-limit stub, a log_id footer, or a Go-style error string.
  // Meego MCP wraps backend errors in a successful response envelope where
  // the text content is something like "json: unsupported value/type, ..."
  // or "id=1, code=...". Treat those as errors so the JSON parser in the
  // caller doesn't crash on garbage.
  const items = data.result?.content ?? [];
  for (const item of items) {
    const text = (item.text ?? '').trim();
    if (!text) continue;
    if (/^rate limit/i.test(text)) continue;
    if (/^log_?id:/i.test(text)) continue;
    if (/^json:\s*(unsupported|cannot|invalid)/i.test(text)) {
      throw new Error(`Meego MCP backend error (${toolName}): ${text.slice(0, 200)}`);
    }
    if (/^id=\d+,\s*code=/i.test(text)) {
      throw new Error(`Meego MCP RPC error (${toolName}): ${text.slice(0, 200)}`);
    }
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
export async function callMeegoMcp(toolName: string, args: Record<string, unknown>): Promise<string> {
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
  /**
   * If set, the card renders this finding with a "Delayed" label (using the
   * red high-tier colour) and shows ONLY the delay detail in parens. This
   * overrides the normal level + reasons display. Set when the activity log
   * shows a version or planned-launch-date edit since the previous run.
   */
  delay?: { detail: string };
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
// Multiple Meego work item templates exist with different keys for the
// server-dev stage. Both should classify a feature as server-only when no
// mobile dev is active.
const SERVER_DEV_NODE_IDS = new Set<string>([
  'state_43',           // legacy template
  'server_development', // newer template used by some teams
]);

const DEV_NODE_IDS = new Set<string>([...MOBILE_DEV_NODE_IDS, ...SERVER_DEV_NODE_IDS]);

function isInDev(allActiveNodeIds: string[]): boolean {
  return allActiveNodeIds.some(id => DEV_NODE_IDS.has(id));
}

/** Classify whether an in-dev feature should use the mobile or server pipeline. */
function classifyPipelineKind(allActiveNodeIds: string[]): 'mobile' | 'server' | undefined {
  if (allActiveNodeIds.some(id => MOBILE_DEV_NODE_IDS.has(id))) return 'mobile';
  if (allActiveNodeIds.some(id => SERVER_DEV_NODE_IDS.has(id))) return 'server';
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

  // Prefer the brief's authoritative work_item_name over whatever the
  // discovery step gave us. The Junior-chat discovery path uses the chat
  // display name (like "(45.2) [SA ]AI theatre ID 录入合并 - [需求同步群]")
  // which has a version prefix and group-type suffix wrapped around the
  // real feature name; the brief returns the clean feature name.
  const resolvedName = json.work_item_attribute?.work_item_name || name || `(workitem ${workItemId})`;

  return {
    workItemId,
    name: resolvedName,
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
 * Meego node. Discovered from a live probe — the field lives on the
 * `qa_test_preparation` node alongside the iOS/Android planned-version fields,
 * field_key `field_cde888`, field_name "Server 计划上线时间".
 *
 * The lookup still has a name-based fallback in case the key shifts.
 */
const SERVER_PLANNED_LAUNCH_FIELD_KEYS: string[] = ['field_cde888'];

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

  // 2) Fallback: name match. The Meego field is labelled "Server 计划上线时间"
  // (mixed English + Chinese). Match that plus several common variants.
  const NAME_RE = /server\s*计划上线时间|server\s*planned\s*launch\s*date|服务端\s*预计\s*上线\s*日期|服务端\s*计划\s*上线|server\s*launch\s*date/i;
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

// ─── Activity-log change detection (Delayed risk) ─────────────────────────

/**
 * Field key constants for the iOS / Android version + Server Planned Launch
 * Date fields. The op_record activity feed reports modifications to these
 * fields under their stable Meego key, so we look them up by ID.
 */
const FIELD_KEY_IOS_VERSION = 'field_08a9ca';
const FIELD_KEY_ANDROID_VERSION = 'field_c88970';
const FIELD_KEY_SERVER_LAUNCH_DATE = 'field_cde888';

/** Op record (subset of fields we care about). */
interface OpRecord {
  operation_type?: string;
  operation_time?: number; // unix ms
  op_record_module?: string;
  operator?: string;
  record_contents?: Array<{
    object?: { object_type?: string; object_value?: string };
    object_property?: string | null;
    old?: unknown;
    new?: unknown;
  }>;
}
interface OpRecordPage { has_more?: boolean; start_from?: string; total?: number; op_records?: OpRecord[] }

/**
 * Fetch op records for a feature, walking pagination only as far back as
 * `sinceMs`. Records come back newest-first, so we early-exit as soon as
 * we see one older than the cutoff (avoiding the full-history walk).
 *
 * Capped at 5 pages to bound latency in case the cursor logic ever loops.
 */
async function fetchRecentOpRecords(meegoUrl: string, sinceMs: number): Promise<OpRecord[]> {
  const all: OpRecord[] = [];
  let startFrom: string | undefined;
  for (let page = 0; page < 5; page++) {
    const args: Record<string, unknown> = { url: meegoUrl };
    if (startFrom) args.start_from = startFrom;
    let raw: string;
    try {
      raw = await callMeegoMcp('get_workitem_op_record', args);
    } catch {
      break;
    }
    let parsed: OpRecordPage;
    try {
      parsed = JSON.parse(raw) as OpRecordPage;
    } catch {
      break;
    }
    const records = parsed.op_records ?? [];
    let reachedCutoff = false;
    for (const r of records) {
      if (r.operation_time !== undefined && r.operation_time < sinceMs) {
        reachedCutoff = true;
        break;
      }
      all.push(r);
    }
    if (reachedCutoff || !parsed.has_more || !parsed.start_from) break;
    startFrom = parsed.start_from;
  }
  return all;
}

/** A single Delayed-relevant change extracted from the op records. */
export interface FieldChange {
  kind: 'version' | 'launch_date';
  /** Display string, e.g. "version 44.4 → 44.5" or "planned launch 16 Apr → 17 Apr". */
  detail: string;
  operationTimeMs: number;
}

/**
 * Format a single date value (ISO string or unix ms or `[ts]`) as `D MMM`
 * in Singapore time so the digest reads consistently with the rest of the
 * card. Returns the raw value if no date can be parsed.
 */
function formatChangeDate(value: unknown): string {
  function tryFormat(v: unknown): string {
    if (typeof v === 'number' && v > 0) {
      const ms = v > 1e12 ? v : v * 1000;
      const d = new Date(ms);
      if (!isNaN(d.getTime())) {
        return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Singapore' });
      }
    }
    if (typeof v === 'string') {
      const m = v.match(/(\d{4}-\d{2}-\d{2})/);
      if (m) {
        const d = new Date(m[1] + 'T00:00:00+08:00');
        if (!isNaN(d.getTime())) {
          return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Singapore' });
        }
      }
      const ts = Number(v);
      if (!isNaN(ts) && ts > 0) return tryFormat(ts);
    }
    return '';
  }
  if (Array.isArray(value)) {
    for (const v of value) {
      const out = tryFormat(v);
      if (out) return out;
    }
    return '';
  }
  return tryFormat(value);
}

/**
 * Extract the underlying primitive from an op_record old/new array. Op
 * records always wrap values in arrays — even single-value fields. Returns
 * the first element or the raw input if it isn't an array.
 */
function unwrapValue(v: unknown): unknown {
  if (Array.isArray(v)) return v[0];
  return v;
}

/**
 * Resolve a Meego version work item id to its short numeric form (e.g.
 * "44.9"). Used to render version-change op records like
 * "version 44.4 → 44.5". Falls back to the raw id if resolution fails.
 */
async function resolveVersionShortName(versionId: string | number): Promise<string> {
  try {
    const raw = await callMeegoMcp('get_workitem_brief', {
      url: `https://meego.larkoffice.com/${TIKTOK_PROJECT_KEY}/version/detail/${versionId}`,
    });
    let name = '';
    try {
      const parsed = JSON.parse(raw) as BriefJson;
      name = parsed.work_item_attribute?.work_item_name ?? '';
    } catch {
      const m = raw.match(/工作项名称\s*\|\s*([^|\n]+)/);
      if (m) name = m[1].trim();
    }
    const m = name.match(/(\d+\.\d+)(?:\.\d+)?$/);
    return m ? m[1] : (name || String(versionId));
  } catch {
    return String(versionId);
  }
}

/**
 * Walk a feature's recent op records and pull out any changes to the iOS
 * version, Android version, or Server Planned Launch Date fields that
 * happened after `sinceMs`. Returns one FieldChange per matching record.
 *
 * Multiple changes for the same field are collapsed: only the most recent
 * one is returned, and the "from" side is taken from the OLDEST record so
 * the displayed transition spans the full delay window.
 */
export async function detectDelayedFieldChanges(
  meegoUrl: string,
  sinceMs: number,
): Promise<FieldChange[]> {
  const records = await fetchRecentOpRecords(meegoUrl, sinceMs);
  if (records.length === 0) return [];

  // Collect changes per field, sorted oldest first.
  interface RawChange { kind: FieldChange['kind']; old: unknown; new: unknown; ts: number; fieldKey: string }
  const byKind = new Map<string, RawChange[]>();
  for (const r of records) {
    if (r.op_record_module !== 'field_mod') continue;
    if (r.operation_type !== 'modify') continue;
    const ts = r.operation_time ?? 0;
    if (ts < sinceMs) continue;
    for (const c of r.record_contents ?? []) {
      const fk = c.object?.object_value;
      if (!fk) continue;
      let kind: FieldChange['kind'] | null = null;
      if (fk === FIELD_KEY_IOS_VERSION || fk === FIELD_KEY_ANDROID_VERSION) kind = 'version';
      else if (fk === FIELD_KEY_SERVER_LAUNCH_DATE) kind = 'launch_date';
      if (!kind) continue;
      const list = byKind.get(kind) ?? [];
      list.push({ kind, old: c.old, new: c.new, ts, fieldKey: fk });
      byKind.set(kind, list);
    }
  }

  if (byKind.size === 0) return [];

  // Collapse each field's changes into a single from→to transition. Use
  // the oldest record's `old` and the newest record's `new`, so a 44.4 →
  // 44.5 → 44.6 sequence in one window reads as "44.4 → 44.6".
  const out: FieldChange[] = [];
  for (const [kind, list] of byKind.entries()) {
    list.sort((a, b) => a.ts - b.ts);
    const first = list[0];
    const last = list[list.length - 1];
    if (kind === 'version') {
      const fromIds = Array.isArray(first.old) ? first.old : [first.old];
      const toIds   = Array.isArray(last.new)  ? last.new  : [last.new];
      const fromName = fromIds[0] !== undefined && fromIds[0] !== null ? await resolveVersionShortName(fromIds[0] as string | number) : '';
      const toName   = toIds[0]   !== undefined && toIds[0]   !== null ? await resolveVersionShortName(toIds[0]   as string | number) : '';
      if (fromName && toName && fromName !== toName) {
        out.push({ kind: 'version', detail: `version ${fromName} → ${toName}`, operationTimeMs: last.ts });
      }
    } else if (kind === 'launch_date') {
      const fromStr = formatChangeDate(unwrapValue(first.old));
      const toStr   = formatChangeDate(unwrapValue(last.new));
      if (fromStr && toStr && fromStr !== toStr) {
        out.push({ kind: 'launch_date', detail: `planned launch ${fromStr} → ${toStr}`, operationTimeMs: last.ts });
      } else if (toStr && !fromStr) {
        // First time the field was set in the window — also worth surfacing.
        out.push({ kind: 'launch_date', detail: `planned launch set to ${toStr}`, operationTimeMs: last.ts });
      }
    }
  }
  return out;
}

// ─── Feature discovery via list_todo + MQL (raw Chinese statuses) ─────────

interface MeegoTodoItem {
  work_item_info: { work_item_id: number; work_item_type_key: string; work_item_name: string };
  project_key: string;
  node_info?: { node_name?: string; node_state_key?: string };
}

/**
 * Parse a Meego MCP response that's expected to be JSON. Logs the raw text
 * (truncated) on parse failure so we can see what the backend actually
 * returned, then re-throws so the caller can decide how to recover.
 */
function parseMcpJson<T>(raw: string, label: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch (e) {
    const preview = raw.length > 300 ? `${raw.slice(0, 300)}…` : raw;
    console.warn(`[digests] ${label} JSON parse failed: ${e instanceof Error ? e.message : String(e)} — raw: ${preview}`);
    throw e;
  }
}

/**
 * Refresh (or reuse) the cached list of Lark group chats Junior is in,
 * paired with the Meego work item id parsed from each chat description.
 *
 * Cached in the digest state file with a 24h TTL — chat membership doesn't
 * churn fast and the underlying Lark calls are expensive (1 list call +
 * one chat-detail call per chat for the description).
 *
 * Mutates `state` in place when it refreshes the cache; the caller will
 * write state back to GCS at the end of the run.
 *
 * Returns only chats that have a parseable Meego id in the description.
 * Chats without a Meego id (ops groups, random chats, etc.) are dropped
 * since they aren't candidate features for the digest.
 */
async function discoverJuniorFeatureChats(
  state: DigestStateFile, botToken: string,
): Promise<JuniorChatCacheEntry[]> {
  // Cache hit — return the existing list. Still filter to entries with a
  // meegoId in case stale entries snuck in.
  if (isJuniorChatsCacheFresh(state)) {
    const cached = state.juniorChatsCache?.chats ?? [];
    const withId = cached.filter(c => c.meegoId);
    console.log(`[digests] junior chats cache HIT — ${cached.length} chats, ${withId.length} feature chats`);
    return withId;
  }

  // Refresh from Lark.
  let allChats: Array<{ chatId: string; name: string; description: string }> = [];
  try {
    allChats = await listJuniorChats(botToken);
  } catch (e) {
    console.warn('[digests] listJuniorChats failed, reusing stale cache if any:', e);
    return (state.juniorChatsCache?.chats ?? []).filter(c => c.meegoId);
  }

  // Parse the meegoId out of each description. Meego work item ids are
  // 10-12 digit numbers; the chat description usually contains the full
  // /detail/<id> URL or just the id.
  const entries: JuniorChatCacheEntry[] = allChats.map(c => {
    const m = c.description.match(/\/detail\/(\d{8,})/) ?? c.description.match(/\b(\d{10,})\b/);
    return {
      chatId: c.chatId,
      chatName: c.name,
      meegoId: m?.[1] ?? '',
    };
  });

  state.juniorChatsCache = {
    fetchedAtIso: new Date().toISOString(),
    chats: entries,
  };

  const withId = entries.filter(c => c.meegoId);
  console.log(`[digests] junior chats cache REFRESHED — ${entries.length} total chats, ${withId.length} have a Meego id`);
  return withId;
}

async function fetchAllPmOwnedIds(
  projectKey: string,
  juniorChats: JuniorChatCacheEntry[],
  watchlist: string[],
): Promise<Array<{ id: string; name: string; rawStatusFromList?: string }>> {
  // Step 1: list_todo gives us features with an active node we're assigned to
  const todos = new Map<string, { id: string; name: string; rawStatusFromList?: string }>();
  let page = 1;
  try {
    while (true) {
      const raw = await callMeegoMcp('list_todo', { action: 'todo', page_num: page });
      const data = parseMcpJson<{ total?: number; list?: MeegoTodoItem[] }>(raw, 'list_todo');
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

  // Step 2: MQL gives us ALL stories where the user is in the PM role —
  // including features that have MULTIPLE PMs (where `__PM = current_login_user()`
  // would return false because the field is a list, not a single user).
  // Use `current_login_user() IN __PM` so multi-PM features are matched.
  // Retry the WHOLE MQL pagination from scratch on transient failure (e.g.
  // session_id-based pagination errors): the second attempt usually succeeds.
  interface MqlResponse {
    session_id?: string;
    list?: Array<{ count?: number }>;
    data?: Record<string, Array<{ moql_field_list?: Array<{ key: string; value: { long_value?: number; varchar_value?: string; string_value?: string } }> }>>;
  }
  const MQL = "SELECT `work_item_id`, `name` FROM `TikTok`.`需求` WHERE `__PM` = current_login_user()";
  let mqlAdded = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      let sessionId: string | undefined;
      let mqlPage = 1;
      while (true) {
        const args: Record<string, unknown> = sessionId
          ? { project_key: 'TikTok', session_id: sessionId, group_pagination_list: [{ group_id: '1', page_num: mqlPage }] }
          : { project_key: 'TikTok', mql: MQL };
        const raw = await callMeegoMcp('search_by_mql', args);
        const data = parseMcpJson<MqlResponse>(raw, `search_by_mql page=${mqlPage}`);
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
          if (id && !todos.has(id)) {
            todos.set(id, { id, name });
            mqlAdded++;
          }
        }
        if (todos.size >= total || items.length === 0) break;
        mqlPage++;
      }
      break; // success — exit retry loop
    } catch (e) {
      console.warn(`[digests] MQL fetch attempt ${attempt + 1} failed:`, e);
      if (attempt === 1) break;
      // Brief pause before retry to give the backend a moment to recover.
      await new Promise(r => setTimeout(r, 1500));
    }
  }
  console.log(`[digests] PM-owned discovery: list_todo=${todos.size - mqlAdded}, MQL added=${mqlAdded}, total=${todos.size}`);

  // Step 3: Merge in feature IDs from chats Junior is a member of. This is
  // the primary mechanism for catching co-PM features (where MQL drops the
  // feature because `__PM = current_login_user()` evaluates to false on a
  // multi-element list). Each entry already has the workItemId parsed from
  // the chat description.
  let juniorAdded = 0;
  for (const c of juniorChats) {
    if (!c.meegoId) continue;
    if (!todos.has(c.meegoId)) {
      todos.set(c.meegoId, { id: c.meegoId, name: c.chatName });
      juniorAdded++;
    }
  }
  if (juniorAdded > 0) {
    console.log(`[digests] added ${juniorAdded} feature(s) from Junior chats, new total=${todos.size}`);
  }

  // Step 4: Merge in the manual watchlist — fallback for features whose
  // chat doesn't exist yet (or that Junior was never added to). Lives in
  // the GCS state file under `watchlist`, edit via `gcloud storage cp`.
  let watchlistAdded = 0;
  for (const id of watchlist) {
    if (!todos.has(id)) {
      todos.set(id, { id, name: '' }); // name resolved by fetchMeegoFeature
      watchlistAdded++;
    }
  }
  if (watchlistAdded > 0) {
    console.log(`[digests] added ${watchlistAdded} feature(s) from watchlist, new total=${todos.size}`);
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
        reasons.push('QA not started, planned merge date within 2 days');
        levels.push('red');
      } else if (days <= 5) {
        reasons.push('QA not started, planned merge date within 5 days');
        levels.push('yellow');
      }
    }
  } else if (feature.pipelineKind === 'server') {
    if (feature.serverPlannedLaunchDate) {
      const launchDate = new Date(feature.serverPlannedLaunchDate);
      if (!isNaN(launchDate.getTime())) {
        const days = businessDaysUntil(launchDate);
        if (days <= 2) {
          reasons.push('QA not started, planned launch date within 2 days');
          levels.push('red');
        } else if (days <= 5) {
          reasons.push('QA not started, planned launch date within 5 days');
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

  // Missing PRD
  if (!feature.prd) {
    reasons.push('PRD link not set');
    levels.push('yellow');
  }

  const level = reasons.length === 0 ? 'green' : maxLevel(levels);
  return { level, reasons, feature };
}

// ─── Qualitative chat risk (Gemini 2.5 Flash Lite) ────────────────────────

/**
 * Hard cap on how many of the most-recent messages we hand to Gemini per
 * feature. Keeps the prompt size predictable and the model fast even if a
 * very chatty group has hundreds of messages in 24h.
 */
const CHAT_RISK_MAX_MESSAGES = 80;
const CHAT_RISK_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface ChatRiskFinding {
  level: 'none' | 'yellow' | 'red';
  summary: string;
}

/** Optional prior-risk context handed to Gemini so it can carry / clear / escalate. */
export interface PriorChatRisk {
  level: 'yellow' | 'red';
  summary: string;
  raisedAtIso: string;
}

/**
 * Read the last 24h of messages in a feature's Meego group chat and use
 * Gemini 2.5 Flash Lite to detect whether a team member has called out a
 * risk to the feature's progress.
 *
 * Carry-forward semantics:
 *   - No new messages, no prior risk → none.
 *   - No new messages, prior risk    → carry the prior risk forward as-is
 *                                      (Gemini is NOT called).
 *   - New messages, no prior risk    → fresh evaluation against new messages.
 *   - New messages, prior risk       → evaluation with prior risk in the
 *                                      prompt so Gemini can decide whether
 *                                      it has been resolved, escalated,
 *                                      replaced, or is still active.
 */
export async function evaluateChatRisk(
  chatId: string,
  featureName: string,
  rioToken: string,
  prior?: PriorChatRisk,
): Promise<ChatRiskFinding> {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    // If we don't have Gemini, we can still carry the prior risk forward.
    return prior ? { level: prior.level, summary: prior.summary } : { level: 'none', summary: '' };
  }

  // Pull messages — newest first per readChatMessages contract.
  let messages: ChatMessage[] = [];
  try {
    messages = await readChatMessages(chatId, Date.now() - CHAT_RISK_WINDOW_MS, rioToken);
  } catch (e) {
    console.warn(`[digests] chat read failed for ${featureName}:`, e);
    // Read failed: don't lose a prior risk just because we couldn't read.
    return prior ? { level: prior.level, summary: prior.summary } : { level: 'none', summary: '' };
  }

  // No new chatter — carry the prior risk forward unchanged. Skip Gemini.
  if (messages.length === 0) {
    if (prior) {
      console.log(
        `[digests] Gemini chat risk for "${featureName}" (0 msgs/24h, carrying prior): ${JSON.stringify({ level: prior.level, summary: prior.summary })}`,
      );
      return { level: prior.level, summary: prior.summary };
    }
    return { level: 'none', summary: '' };
  }

  // Format chronologically (oldest first), strip out Lark text JSON wrapper.
  const formatted = messages
    .slice(0, CHAT_RISK_MAX_MESSAGES)
    .reverse()
    .map(m => {
      let text = '';
      try {
        const parsed = JSON.parse(m.body?.content ?? '{}') as { text?: string };
        text = parsed.text ?? '';
      } catch {
        text = m.body?.content ?? '';
      }
      return text.trim();
    })
    .filter(Boolean)
    .join('\n');
  if (!formatted) {
    return prior ? { level: prior.level, summary: prior.summary } : { level: 'none', summary: '' };
  }

  // Build the prompt — different intro depending on whether there's a prior
  // risk to evaluate against.
  const priorBlock = prior
    ? `A previously detected risk is currently being tracked for this feature:
  Level:   ${prior.level}
  Summary: "${prior.summary}"
  Raised:  ${prior.raisedAtIso.slice(0, 10)}

Your job is to decide what the CURRENT risk situation is, given both the prior risk and the new messages below:
- If the new messages clearly resolve the prior risk and no new risk has surfaced → "none"
- If the prior risk is still relevant (or hasn't been touched) → carry it forward (re-state the same level + a short summary)
- If the new messages confirm or worsen the prior risk → escalate (bump level and update the summary)
- If a new unrelated risk has been raised → replace the prior summary with the new one (use whichever level fits)

Be conservative about clearing a risk: only return "none" if there is clear evidence the issue is resolved. Silence does NOT mean resolution.`
    : `Decide whether any of the messages below indicate a risk to the feature's progress, timeline, or successful launch.

A "risk" is something a team member has called out that may delay, block, or compromise the feature. Examples that count as risk:
- Tech owner says they need more time or won't hit the deadline
- An unresolved blocker or dependency slipping
- Quality concerns, scope creep, or readiness doubts
- Anyone explicitly saying "this is at risk", "we may not make it", or similar

Do NOT flag as a risk:
- Routine status updates ("PRD updated", "merged X")
- Open questions still being discussed
- Risks that have already been resolved in the same conversation
- Off-topic or social conversation`;

  const prompt = `You are reviewing the last 24 hours of messages from a TikTok PM team chat for the feature "${featureName}".

${priorBlock}

Messages (oldest first):
${formatted}

Respond with ONLY a single JSON object on one line, no markdown fences:
{"level":"none"|"yellow"|"red","summary":"<short clause, max 12 words, lowercase, no trailing period; empty string when level is none>"}

Use "yellow" for moderate concerns, "red" for serious risks, "none" if nothing risky is currently active.`;

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });
    const result = await model.generateContent(prompt);
    const raw = result.response.text().trim();
    // Strip optional ```json fences if Gemini ignored the instruction
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
    const parsed = JSON.parse(cleaned) as { level?: string; summary?: string };
    const level: ChatRiskFinding['level'] =
      parsed.level === 'red' ? 'red' :
      parsed.level === 'yellow' ? 'yellow' :
      'none';
    const summary = (parsed.summary ?? '').trim();
    // Log the parsed result on one line so Cloud Run doesn't split the
    // multiline raw response into separate entries.
    const priorTag = prior ? `, prior=${prior.level}` : '';
    console.log(
      `[digests] Gemini chat risk for "${featureName}" (${messages.length} msgs/24h${priorTag}): ${JSON.stringify({ level, summary })}`,
    );
    if (level === 'none') return { level, summary: '' };
    return { level, summary };
  } catch (e) {
    console.warn(`[digests] Gemini chat risk eval failed for ${featureName}:`, e);
    // Gemini failed — fall back to carrying the prior risk if any.
    return prior ? { level: prior.level, summary: prior.summary } : { level: 'none', summary: '' };
  }
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

  // Generic status bucket — always "In Development" for in-dev features
  // (regardless of mobile vs server pipeline).
  const statusLabel = f.pipelineKind === 'server'
    ? 'In Development'
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

  // Risk: when a Delayed badge is active, override the level label and
  // show ONLY the delay detail in parens (no other reasons). Otherwise,
  // render the normal level + reasons summary.
  if (finding.delay) {
    lines.push(`**Risk:** Delayed (${escapeMd(finding.delay.detail)})`);
  } else {
    const riskValue = finding.reasons.length > 0
      ? `${label} (${finding.reasons.map(escapeMd).join(', ')})`
      : label;
    lines.push(`**Risk:** ${riskValue}`);
  }

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

/**
 * Q&A scan window — last 24 h of messages, matching the chat-risk window.
 */
const UNANSWERED_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Hard cap on questions per feature in the card so a busy chat doesn't blow up the message. */
const MAX_QUESTIONS_PER_FEATURE = 5;

/**
 * Determine whether a question message has been answered. A question is
 * answered if any later message exists in the same thread:
 *   - direct reply to it (`Y.parent_id === X.message_id`)
 *   - in a thread X started (`Y.root_id === X.message_id`)
 *   - any later message in the same thread X belongs to (when X is itself
 *     a thread reply): `Y.root_id === X.root_id AND Y.create_time > X.create_time`
 *
 * The "later in same thread" check matters because Thomas can be @-mentioned
 * mid-thread and a follow-up reply from someone else still counts as an
 * answer even though it's not a direct reply to Thomas's message.
 */
function isQuestionAnswered(question: ChatMessage, all: ChatMessage[]): boolean {
  const qId = question.message_id;
  const qRoot = question.root_id ?? '';
  const qTime = Number(question.create_time ?? 0);
  for (const m of all) {
    if (m.message_id === qId) continue;
    if (m.parent_id === qId) return true;
    if (m.root_id === qId) return true;
    if (qRoot && m.root_id === qRoot && Number(m.create_time ?? 0) > qTime) return true;
  }
  return false;
}

/**
 * Scan one chat for top-level / thread messages that @-mention the owner
 * (Thomas) and have no reply within the 24h window. Returns one
 * `UnansweredFinding` per feature, or null when there's nothing to flag.
 *
 * Question definition (per user):
 *   - Sent by ANYONE (no stakeholder filter)
 *   - At ANY thread depth (top-level or thread reply)
 *   - The message's `mentions` list includes the owner's open_id
 *   - The message has no later reply in the same thread
 */
export async function collectUnansweredForFeature(
  feature: MeegoFeature,
  chatId: string,
  sinceMs: number,
  ownerOpenId: string,
  token: string,
): Promise<UnansweredFinding | null> {
  if (!chatId || !ownerOpenId) return null;

  let messages: ChatMessage[] = [];
  try {
    messages = await readChatMessages(chatId, sinceMs, token);
  } catch (e) {
    console.warn(`[digests] failed to read messages for ${feature.name}:`, e);
    return null;
  }
  if (messages.length === 0) return null;

  // Filter to messages where Thomas is in the @mentions list. Any sender,
  // any thread depth.
  const mentionMsgs = messages.filter(m => {
    if (!m.mentions || m.mentions.length === 0) return false;
    return m.mentions.some(mention => mention.id?.open_id === ownerOpenId);
  });
  if (mentionMsgs.length === 0) return null;

  // Drop the ones that have a reply.
  const unanswered: UnansweredQuestion[] = [];
  for (const msg of mentionMsgs) {
    if (isQuestionAnswered(msg, messages)) continue;

    let text = '';
    try {
      const parsed = JSON.parse(msg.body?.content ?? '{}') as { text?: string };
      text = (parsed.text ?? '').trim();
    } catch {
      text = msg.body?.content ?? '';
    }
    // Strip the mention key tokens from the body for a cleaner preview.
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
  // Newest first so the most recent question is on top.
  unanswered.sort((a, b) => b.timestamp - a.timestamp);
  return { feature, questions: unanswered.slice(0, MAX_QUESTIONS_PER_FEATURE) };
}

/**
 * Build the Unanswered Q&A digest as a Lark interactive card. Mirrors the
 * style of the risk digest: title in the header, one section per feature
 * separated by horizontal rules, inline (Meego, PRD) links next to the
 * feature name. Header colour is neutral (wathet light blue) since these
 * aren't risks per se.
 */
export function buildUnansweredDigestCard(findings: UnansweredFinding[]): {
  title: string;
  template: CardHeaderTemplate;
  sections: CardSection[];
} {
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'Asia/Singapore',
  });
  const totalQs = findings.reduce((sum, f) => sum + f.questions.length, 0);
  const title = `💬 Daily Unanswered Questions — ${today}`;
  const template: CardHeaderTemplate = 'wathet';

  const sections: CardSection[] = [];

  if (findings.length === 0) {
    sections.push({ content: 'No unanswered questions in the last 24 hours.' });
    return { title, template, sections };
  }

  // Lead with a small summary section.
  sections.push({
    content: `**${totalQs} unanswered question${totalQs === 1 ? '' : 's'} across ${findings.length} feature${findings.length === 1 ? '' : 's'}**`,
  });

  for (const finding of findings) {
    const f = finding.feature;
    const linkParts: string[] = [`[Meego](${f.meegoUrl})`];
    if (f.prd) linkParts.push(`[PRD](${f.prd})`);
    const linkSuffix = ` (${linkParts.join(', ')})`;

    const lines: string[] = [];
    lines.push(`**${escapeMd(f.name)}**${linkSuffix}`);
    for (const q of finding.questions) {
      const time = q.timestamp > 0
        ? new Date(q.timestamp).toLocaleString('en-US', {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Singapore',
          })
        : '';
      const preview = (q.text || '(no text)').replace(/\s+/g, ' ').trim();
      // Sanitize the preview for lark_md (escape * and _).
      const safePreview = escapeMd(preview);
      lines.push(`  • ${time}: "${safePreview}"`);
    }
    sections.push({ content: lines.join('\n') });
  }

  return { title, template, sections };
}

/**
 * Plain-text formatter kept for the legacy DigestRunResult log preview.
 * The actual message is sent as the interactive card built above.
 */
export function formatUnansweredDigest(findings: UnansweredFinding[]): string {
  const today = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const totalQs = findings.reduce((sum, f) => sum + f.questions.length, 0);

  const lines: string[] = [];
  lines.push(`💬 Daily Unanswered Questions — ${today}`);
  lines.push(`${totalQs} question${totalQs === 1 ? '' : 's'} across ${findings.length} feature${findings.length === 1 ? '' : 's'}`);
  lines.push('');

  for (const finding of findings) {
    lines.push(finding.feature.name);
    for (const q of finding.questions) {
      const time = q.timestamp > 0
        ? new Date(q.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
        : '';
      const preview = q.text || '(no text)';
      lines.push(`  • ${time}: "${preview}"`);
    }
    lines.push('');
  }

  return lines.join('\n').trim();
}

// ─── Task 3: Auto-fetch project links ───────────────────────────────────────

/**
 * For one feature, try to discover its Figma and AB report links using the
 * same extraction functions that Hamlet's UI uses. Respects a per-feature
 * cache in the digest state so we don't re-fetch on every run.
 *
 * DRY_RUN: currently only logs what would be written to Meego. Actual
 * update_field calls are behind a flag (`enableWrites`) that defaults to
 * false until we've verified the dry-run output looks correct. Flip it to
 * true for Deploy 3.
 */
const ENABLE_LINK_WRITES = true;

async function fetchAndCacheLinks(
  feature: MeegoFeature,
  state: DigestStateFile,
  userToken?: string,
): Promise<{ figmaUrl: string; abReportUrl: string; written: number }> {
  const cached = state.featureLinks?.[feature.workItemId];
  const nowIso = new Date().toISOString();

  // If PRD changed since last fetch, re-fetch Figma (it's extracted from PRD).
  const prdChanged = cached && cached.prdAtFetch !== (feature.prd ?? '');
  let figmaUrl = (cached?.figmaUrl && !prdChanged) ? cached.figmaUrl : '';
  let abReportUrl = cached?.abReportUrl ?? '';

  // Fetch Figma from PRD doc.
  if (!figmaUrl && feature.prd) {
    try {
      figmaUrl = await extractFigmaUrlFromPrd(feature.prd);
    } catch (e) {
      console.warn(`[digests] Figma extraction failed for ${feature.name}:`, e);
    }
  }

  // Fetch AB report via Lark Drive search. Uses a user_access_token (when
  // available) so the search covers the PM's full Drive scope — the bot's
  // tenant token only returns docs the bot itself has access to.
  if (!abReportUrl && feature.name) {
    try {
      const result = await searchAbReport(feature.name, userToken, feature.prd);
      abReportUrl = result.abReportUrl;
    } catch (e) {
      console.warn(`[digests] AB report search failed for ${feature.name}:`, e);
    }
    // Brief pause to stay under Lark rate limits.
    await new Promise(r => setTimeout(r, 500));
  }

  // Compute version number: lowest launched version, else lowest planned.
  // Fetch the 4 version fields from the brief.
  let versionNumber = cached?.versionNumber ?? '';
  if (!versionNumber) {
    try {
      const vBriefRaw = await callMeegoMcp('get_workitem_brief', {
        url: feature.meegoUrl,
        fields: [...VERSION_LAUNCHED_FIELDS, ...VERSION_PLANNED_FIELDS],
      });
      const vBrief = JSON.parse(vBriefRaw) as BriefJson;
      const vFields = vBrief.work_item_fields ?? [];

      // Collect launched versions first.
      const launched: string[] = [];
      for (const key of VERSION_LAUNCHED_FIELDS) {
        const val = vFields.find(f => f.key === key)?.value;
        launched.push(...extractShortVersions(val));
      }
      // If no launched versions, collect planned versions.
      const planned: string[] = [];
      if (launched.length === 0) {
        for (const key of VERSION_PLANNED_FIELDS) {
          const val = vFields.find(f => f.key === key)?.value;
          planned.push(...extractShortVersions(val));
        }
      }
      versionNumber = launched[0] ?? planned[0] ?? '';
    } catch (e) {
      console.warn(`[digests] version resolution failed for ${feature.name}:`, e);
    }
  }

  const allPopulated = !!(figmaUrl && abReportUrl && versionNumber);

  // Update cache.
  if (!state.featureLinks) state.featureLinks = {};
  state.featureLinks[feature.workItemId] = {
    figmaUrl,
    abReportUrl,
    versionNumber,
    lastFetchedIso: nowIso,
    allPopulated,
    prdAtFetch: feature.prd ?? '',
  };

  // Write back to Meego.
  let written = 0;
  const writes: Array<{ field_key: string; field_value: string; label: string }> = [];
  if (figmaUrl) writes.push({ field_key: FIELD_KEY_FIGMA, field_value: figmaUrl, label: 'Figma' });
  if (abReportUrl) writes.push({ field_key: FIELD_KEY_AB_REPORT, field_value: abReportUrl, label: 'AB report' });
  if (versionNumber) writes.push({ field_key: FIELD_KEY_VERSION_NUMBER, field_value: versionNumber, label: 'Version' });

  if (writes.length > 0) {
    if (ENABLE_LINK_WRITES) {
      try {
        await callMeegoMcp('update_field', {
          project_key: TIKTOK_PROJECT_KEY,
          work_item_id: feature.workItemId,
          fields: writes.map(w => ({ field_key: w.field_key, field_value: w.field_value })),
        });
        written = writes.length;
        console.log(`[digests] fields written to Meego for "${feature.name}": ${writes.map(w => `${w.label}=${w.field_value.slice(0, 60)}`).join(', ')}`);
      } catch (e) {
        console.warn(`[digests] update_field failed for ${feature.name}:`, e);
      }
    } else {
      console.log(`[digests] fields DRY-RUN for "${feature.name}": ${writes.map(w => `${w.label}=${w.field_value.slice(0, 80)}`).join(', ')}`);
    }
  }

  return { figmaUrl, abReportUrl, written };
}

// ─── Main orchestrator ─────────────────────────────────────────────────────

export async function runDailyDigests(): Promise<DigestRunResult> {
  // Destination for both the risk digest and the unanswered Q&A digest.
  // Previously DM'd to OWNER_EMAIL; now posted to the PM group chat.
  const targetChatId = PM_GROUP_CHAT_ID;

  // Step 0: Load persistent state early — we need the discoveredIdsCache as
  // a fallback if Meego MCP discovery fails this run, plus the cached Junior
  // chat list and the watchlist.
  const state = await loadDigestState();
  console.log(
    `[digests] loaded digest state: ${Object.keys(state.features).length} prior feature entries, ${state.recentRunTimes.length} run timestamps, cache=${state.discoveredIdsCache?.ids.length ?? 0}, watchlist=${(state.watchlist ?? []).length}`,
  );

  // Fetch the main Lark bot token early — needed both for the Junior chat
  // list refresh (Step 0b) and for chat lookups + chat reads later in the
  // pipeline.
  let botToken = '';
  try {
    botToken = await getLarkBotToken();
  } catch (e) {
    console.warn('[digests] failed to get Lark bot token:', e);
  }

  // ── Libra field probe (TEMPORARY) ───────────────────────────────────────────
  // The AB List uses "Libra 实验" work items (type: libra_new). Try MQL to
  // query them by parent story, and also try get_workitem_brief with all
  // effect_analyze fields to see which ones are populated.
  try {
    // 1) MQL: query Libra experiments linked to the story
    try {
      const mql = "SELECT `work_item_id`, `name` FROM `TikTok`.`Libra 实验` WHERE `__parent_id` = 6839802029";
      const raw = await callMeegoMcp('search_by_mql', { project_key: 'TikTok', mql });
      console.log(`[digests] Libra probe MQL: ${raw.slice(0, 2000)}`);
    } catch (e) {
      console.warn('[digests] Libra probe MQL failed:', e);
    }

    // 2) Fetch the brief with ALL effect_analyze fields
    try {
      const probeUrl = `https://meego.larkoffice.com/${TIKTOK_PROJECT_KEY}/story/detail/6839802029`;
      const raw = await callMeegoMcp('get_workitem_brief', {
        url: probeUrl,
        fields: ['effect_analyze', 'effect_analyze_link_t', 'effect_analyze_link_d', 'effect_analyze_link_m', 'effect_analyze_name', 'effect_analyze_report_t', 'effect_analyze_status_t'],
      });
      const briefJson = JSON.parse(raw) as BriefJson;
      const fields = (briefJson.work_item_fields ?? []).map(
        (f: BriefField) => `${f.key}=${f.name}: ${JSON.stringify(f.value).slice(0, 200)}`,
      );
      console.log(`[digests] Libra probe effect_analyze fields: ${fields.join('; ') || '(empty)'}`);
    } catch (e) {
      console.warn('[digests] Libra probe brief failed:', e);
    }
  } catch (e) {
    console.warn('[digests] Libra probe failed:', e);
  }
  // ── end probe ─────────────────────────────────────────────────────────────

  // Step 0b: Refresh (or reuse) Junior's chat list. This drives both the
  // discovery augmentation in Step 1 and the Q&A scan in Step 6.
  let juniorChats: JuniorChatCacheEntry[] = [];
  if (botToken) {
    juniorChats = await discoverJuniorFeatureChats(state, botToken);
  }

  // Step 1: Discover all PM-owned work items. Sources unioned + deduped:
  //   1. list_todo — features with an active task assignment
  //   2. search_by_mql — features where you're the sole PM
  //   3. Junior's chat list — primary mechanism for co-PM features
  //   4. State watchlist — manual fallback for features without a Junior chat
  // If everything comes back empty (Meego MCP backend hiccup), fall back to
  // the cached discovery from the last successful run so the digest still
  // produces output.
  let allIds = await fetchAllPmOwnedIds(TIKTOK_PROJECT_KEY, juniorChats, getWatchlist(state));
  if (allIds.length === 0 && state.discoveredIdsCache && state.discoveredIdsCache.ids.length > 0) {
    console.warn(
      `[digests] discovery returned 0 features — falling back to cached ${state.discoveredIdsCache.ids.length} ids from ${state.discoveredIdsCache.savedAtIso}`,
    );
    allIds = state.discoveredIdsCache.ids.map(({ id, name }) => ({ id, name }));
  } else if (allIds.length > 0) {
    // Refresh the cache on every successful discovery.
    state.discoveredIdsCache = {
      savedAtIso: new Date().toISOString(),
      ids: allIds.map(({ id, name }) => ({ id, name })),
    };
  }
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

  // Step 3c: Fetch the Rio token (needed for the final digest card send in
  // Step 7). The main Lark bot token was already fetched at Step 0a above.
  let rioToken = '';
  try {
    rioToken = await getAgentToken('rio');
  } catch (e) {
    console.warn('[digests] failed to get Rio token:', e);
  }

  // Step 3d: Resolve each in-dev feature's Lark chat ID via the main Lark
  // bot (which has both im:chat:read and chat membership).
  if (botToken) {
    for (const f of inDev) {
      try {
        const chatId = await joinFeatureChat(f.name, undefined, f.meegoUrl, true);
        if (chatId) f.chatId = chatId;
      } catch (e) {
        console.warn(`[digests] chat lookup failed for ${f.name}:`, e);
      }
    }
    const resolvedChats = inDev.filter(f => f.chatId).length;
    console.log(`[digests] resolved Lark chat for ${resolvedChats}/${inDev.length} in-dev features`);
  }

  // Step 4: Evaluate risk — Meego signals first, then two persistence-aware
  // passes:
  //   a) qualitative chat risk via Gemini 2.5 Flash Lite (last 24h of chat
  //      messages, with prior state passed in so quiet days don't drop the
  //      risk back to low)
  //   b) Delayed-state detection via the Meego activity log (any edit to
  //      the iOS/Android version or Server Planned Launch Date field since
  //      the previous digest run shows the feature as "Delayed" for the
  //      next 2 runs after detection).
  //
  // Both kinds of state are stored in the same GCS digest-state file.
  // (state was already loaded at Step 0 above so we can use the
  // discoveredIdsCache as a discovery fallback.)

  // Cutoff for "since the previous run" activity-log scans.
  const opLogCutoffMs = previousRunCutoffMs(state);

  const nowIso = new Date().toISOString();
  const riskFindings: RiskFinding[] = [];
  for (const feature of inDev) {
    try {
      const finding = await evaluateFeatureRisk(feature);
      const prior = state.features[feature.workItemId];

      // ── (a) Qualitative chat risk ──────────────────────────────────────
      if (feature.chatId && botToken) {
        const priorChat = prior?.chatRisk;
        const chatRisk = await evaluateChatRisk(
          feature.chatId,
          feature.name,
          botToken,
          priorChat
            ? { level: priorChat.level, summary: priorChat.summary, raisedAtIso: priorChat.raisedAtIso }
            : undefined,
        );

        // Persist or clear chat risk on the entry (delay state lives
        // alongside, so we update fields rather than blowing the entry away)
        const entry = state.features[feature.workItemId] ?? { name: feature.name, lastSeenIso: nowIso };
        entry.name = feature.name;
        entry.lastSeenIso = nowIso;
        if (chatRisk.level === 'none') {
          delete entry.chatRisk;
        } else {
          entry.chatRisk = {
            level: chatRisk.level,
            summary: chatRisk.summary,
            raisedAtIso: priorChat?.raisedAtIso ?? nowIso,
          };
        }
        // Only keep the entry around if SOMETHING is set on it.
        if (entry.chatRisk || entry.delayChange) {
          state.features[feature.workItemId] = entry;
        } else {
          delete state.features[feature.workItemId];
        }

        if (chatRisk.level !== 'none') {
          finding.reasons.push(chatRisk.summary || 'risk called out in chat');
          finding.level = maxLevel([finding.level, chatRisk.level]);
        }
      }

      // ── (b) Delayed-state detection from activity log ──────────────────
      // Scan the op record for any version/launch-date edit AFTER the
      // previous run. If a fresh change is found, set runsLeftToShow=2.
      // Otherwise carry forward + decrement an existing delay entry.
      let activeDelay: PersistedDelayChange | undefined;
      try {
        const changes = await detectDelayedFieldChanges(feature.meegoUrl, opLogCutoffMs);
        const priorDelay = prior?.delayChange;

        if (changes.length > 0) {
          // New change — pick the most recent one (sorted ascending by ts).
          const latest = changes.sort((a, b) => a.operationTimeMs - b.operationTimeMs).at(-1)!;
          activeDelay = {
            detail: latest.detail,
            detectedAtIso: nowIso,
            // Show on this run + 1 more = 2 total runs of "Delayed".
            runsLeftToShow: 2,
          };
          console.log(`[digests] delay detected for "${feature.name}": ${latest.detail}`);
        } else if (priorDelay && priorDelay.runsLeftToShow > 1) {
          // No new change, but a prior delay still has runs left — carry it.
          activeDelay = {
            detail: priorDelay.detail,
            detectedAtIso: priorDelay.detectedAtIso,
            runsLeftToShow: priorDelay.runsLeftToShow - 1,
          };
          console.log(`[digests] delay carried forward for "${feature.name}" (${activeDelay.runsLeftToShow} runs left): ${activeDelay.detail}`);
        }
        // else: priorDelay was undefined, or runsLeftToShow=1 → drop entirely.
      } catch (e) {
        console.warn(`[digests] activity-log scan failed for ${feature.name}:`, e);
      }

      // Persist or clear the delay entry alongside chat risk.
      const entry2 = state.features[feature.workItemId] ?? { name: feature.name, lastSeenIso: nowIso };
      entry2.name = feature.name;
      entry2.lastSeenIso = nowIso;
      if (activeDelay) {
        entry2.delayChange = activeDelay;
      } else {
        delete entry2.delayChange;
      }
      if (entry2.chatRisk || entry2.delayChange) {
        state.features[feature.workItemId] = entry2;
      } else {
        delete state.features[feature.workItemId];
      }

      // Override the finding's display if Delayed is active. The level
      // bumps to red so card sorting still places it at the top.
      if (activeDelay && activeDelay.runsLeftToShow > 0) {
        finding.delay = { detail: activeDelay.detail };
        finding.level = 'red';
      }

      riskFindings.push(finding);
    } catch (e) {
      console.warn(`[digests] risk eval failed for ${feature.name}:`, e);
    }
  }

  // Step 4b: Record this run's timestamp, drop exited features, prune stale
  // entries, and save state.
  recordRunTime(state, nowIso);
  const inDevIds = new Set(inDev.map(f => f.workItemId));
  const exited = dropExitedFeatures(state, inDevIds);
  if (exited.length > 0) console.log(`[digests] dropped ${exited.length} exited features from state: ${exited.join(', ')}`);
  const stale = pruneStaleRisks(state);
  if (stale.length > 0) console.log(`[digests] pruned ${stale.length} stale entries from state: ${stale.join(', ')}`);
  // Step 5: Auto-fetch project links (Task 3). For each non-ended feature,
  // discover Figma + AB report URLs and cache them in state. AB report search
  // requires the PM's user_access_token (bot token only sees bot-accessible
  // docs). The refresh token is bootstrapped from LARK_USER_REFRESH_TOKEN env
  // var and rotated into the GCS state on each successful refresh.
  let userAccessToken = '';
  {
    const storedRefresh = state.larkUserRefreshToken || process.env.LARK_USER_REFRESH_TOKEN;
    if (storedRefresh) {
      try {
        const result = await refreshUserToken(storedRefresh);
        if (result) {
          userAccessToken = result.accessToken;
          // Persist the rotated refresh token IMMEDIATELY so it's not lost
          // if the link-fetch loop times out before the final state save.
          state.larkUserRefreshToken = result.refreshToken;
          await saveDigestState(state);
          console.log('[digests] user token refreshed for Drive search (state saved with rotated token)');
        } else {
          console.warn('[digests] user token refresh returned null — Drive search will use bot token (limited scope)');
        }
      } catch (e) {
        console.warn('[digests] user token refresh failed:', e);
      }
    } else {
      console.log('[digests] no user refresh token available — Drive search will use bot token (limited scope)');
    }
  }

  // Cap the number of features processed per run so the digest finishes
  // within Cloud Run's timeout. Each AB report search does 3 Lark Drive
  // queries which can be slow. Unprocessed features will be picked up on
  // subsequent runs (the cache ensures already-done features are skipped).
  const LINK_FETCH_MAX_PER_RUN = 10;
  let linksFetched = 0;
  let linksFound = 0;
  let linksWritten = 0;
  let linksSkippedCached = 0;
  const nonEnded = features.filter(f => f.overallStatusKey !== 'end');
  for (const feature of nonEnded) {
    // Skip if already fully cached.
    const cached = state.featureLinks?.[feature.workItemId];
    if (cached?.allPopulated) {
      linksSkippedCached++;
      continue;
    }
    // Cooldown: skip if we tried recently and got empty.
    if (cached && !cached.allPopulated) {
      const elapsed = Date.now() - Date.parse(cached.lastFetchedIso);
      if (elapsed < LINK_RETRY_COOLDOWN_MS) {
        linksSkippedCached++;
        continue;
      }
    }
    // Cap per run.
    if (linksFetched >= LINK_FETCH_MAX_PER_RUN) break;
    try {
      const result = await fetchAndCacheLinks(feature, state, userAccessToken || undefined);
      linksFetched++;
      if (result.figmaUrl || result.abReportUrl) linksFound++;
      linksWritten += result.written;
    } catch (e) {
      console.warn(`[digests] link fetch failed for ${feature.name}:`, e);
      linksFetched++; // count toward cap so a chain of failures doesn't loop forever
    }
  }
  console.log(`[digests] Task 3 link fetch: ${linksFetched}/${nonEnded.length} processed (${linksSkippedCached} cached/cooldown, cap=${LINK_FETCH_MAX_PER_RUN}), ${linksFound} with links, ${linksWritten} written to Meego`);

  await saveDigestState(state);
  console.log(`[digests] saved digest state with ${Object.keys(state.features).length} active feature entries, ${Object.keys(state.featureLinks ?? {}).length} link cache entries`);
  const severityOrder: Record<RiskLevel, number> = { red: 0, yellow: 1, green: 2 };
  riskFindings.sort((a, b) => severityOrder[a.level] - severityOrder[b.level]);

  // Step 6: Unanswered Q&A scan — over every chat Junior is in (cached at
  // Step 0b), filtered to features whose Meego status is NOT 'end'
  // (completed/launched). Question definition: any message at any thread
  // depth that @-mentions Thomas, with no later reply in the same thread.
  // Sender can be anyone in the chat — no role filter.
  const ownerEmail = process.env.OWNER_EMAIL;
  let ownerOpenId = '';
  if (ownerEmail && botToken) {
    try {
      const map = await resolveOpenIds([ownerEmail], botToken);
      ownerOpenId = map[ownerEmail] ?? '';
    } catch (e) {
      console.warn('[digests] failed to resolve owner open_id:', e);
    }
  }
  console.log(`[digests] owner open_id: ${ownerOpenId ? 'resolved' : 'NOT resolved — Q&A scan will be skipped'}`);

  // Lookup: workItemId → MeegoFeature for the briefs already fetched in Step 2.
  const featureById = new Map<string, MeegoFeature>(features.map(f => [f.workItemId, f]));

  const sinceMs = Date.now() - UNANSWERED_WINDOW_MS;
  const unansweredFindings: UnansweredFinding[] = [];
  if (ownerOpenId && botToken) {
    let scanned = 0;
    let skippedNoBrief = 0;
    let skippedEnded = 0;
    for (const chat of juniorChats) {
      const feature = featureById.get(chat.meegoId);
      if (!feature) {
        skippedNoBrief++;
        continue;
      }
      if (feature.overallStatusKey === 'end') {
        skippedEnded++;
        continue;
      }
      scanned++;
      try {
        const finding = await collectUnansweredForFeature(
          feature, chat.chatId, sinceMs, ownerOpenId, botToken,
        );
        if (finding) unansweredFindings.push(finding);
      } catch (e) {
        console.warn(`[digests] Q&A scan failed for ${feature.name}:`, e);
      }
    }
    console.log(
      `[digests] Q&A scan: ${scanned} chats scanned (${skippedEnded} ended, ${skippedNoBrief} no brief), ${unansweredFindings.length} with unanswered questions`,
    );
  }

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

  // Step 8: Send unanswered Q&A digest (only if there are findings) —
  // interactive card to the same PM group chat.
  let unansweredSent = false;
  if (rioToken && unansweredFindings.length > 0) {
    const card = buildUnansweredDigestCard(unansweredFindings);
    const preview = [card.title, ...card.sections.map(s => s.content)].join('\n---\n');
    console.log('[digests] unanswered digest:\n' + preview);
    const id = await sendInteractiveCardToChat(
      targetChatId, card.title, card.template, card.sections, rioToken,
    );
    unansweredSent = id !== null;
  } else {
    console.log('[digests] no unanswered questions — skipping Q&A digest');
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
