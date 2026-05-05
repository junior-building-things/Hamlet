import { GoogleGenerativeAI } from '@google/generative-ai';
import { Feature } from './types';
import {
  readChatMessages,
  resolveOpenIds,
  sendInteractiveCardToChat,
  sendFeatureCard,
  joinFeatureChat,
  listJuniorChats,
  getLarkBotToken,
  refreshUserToken,
  searchAbReport,
  extractFigmaUrlFromPrd,
  readDocContent,
  readDocContentWithToken,
  extractDocSections,
  extractAbSetupTable,
  extractSectionImageTokens,
  uploadDocImageForMessage,
  resolveDocIdFromUrl,
  listDocCommentsDetailed,
  resolveUserName,
  listMessageReactions,
  PostParagraph,
  ChatMessage,
  mentionOpenId,
  senderOpenIdOf,
  CardButton,
  CardSection,
  CardHeaderTemplate,
  PM_GROUP_CHAT_ID,
  appendPrdChangeLog,
} from './lark';
import { getAgentToken } from './agents';
import { getCodeFreezeDate } from './merge-calendar';
import { resolveDisplayStatus, fetchTicketComments } from './meego';
import { readFeatureCache, writeFeatureCache, patchFeaturesInCache } from './feature-cache';

/** Append a new version to the history if it differs from the last entry. */
function trackVersionHistory(history: string[] | undefined, newVersion: string | undefined): string[] | undefined {
  if (!newVersion) return history;
  const h = history ?? [];
  if (h.length === 0 || h[h.length - 1] !== newVersion) return [...h, newVersion];
  return h;
}
import {
  loadDigestState,
  saveDigestState,
  pruneStaleRisks,
  dropExitedFeatures,
  recordRunTime,
  isJuniorChatsCacheFresh,
  getWatchlist,
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

/**
 * Whether a digest sub-section should send on this run. False if:
 *  - the section is paused via state.cronPaused, OR
 *  - opts.sectionFilter is set and this isn't the requested section.
 *
 * The section-filter path is used by the Cron Jobs UI's "Trigger once"
 * button on a single sub-section — we still do all the data fetching
 * (since sections share work), but we only SEND the requested card.
 */
function shouldSendSection(
  state: DigestStateFile,
  opts: DigestRunOptions,
  id: string,
): boolean {
  if (Array.isArray(state.cronPaused) && state.cronPaused.includes(id)) return false;
  if (opts.sectionFilter && opts.sectionFilter !== id) return false;
  return true;
}

/**
 * Run mode for runDailyDigests.
 *  - 'full' (default, back-compat): pull Meego, detect transitions/PRD changes, send all cards.
 *    Used by the manual /api/digests/run endpoint and the legacy hamlet-daily-digest cron.
 *  - 'refresh': pull Meego, detect transitions/PRD changes, write feature-snapshots.json,
 *    QUEUE cards into DigestState (don't send). Used by refresh-feature-cache cron.
 *  - 'sections-only': skip Meego pull (load from snapshots), skip detection (refresh did it),
 *    only send the section in `sectionFilter`. Used by the per-section crons.
 */
export type DigestRunMode = 'full' | 'refresh' | 'sections-only';

export interface DigestRunOptions {
  /** Default 'full'. See DigestRunMode for details. */
  mode?: DigestRunMode;
  /** When set, only this digest section's send fires. Other sections
   *  still do their data work (because sections share fetches), but
   *  the card-send for non-matching sections is skipped. */
  sectionFilter?: string;
}

/**
 * In refresh + full mode, returns whether the section should send NOW
 * (paused check + sectionFilter check). In refresh mode we never SEND;
 * we always QUEUE — but we still respect the paused flag so a paused
 * section's queue doesn't grow unbounded.
 */
function shouldQueueSection(state: DigestStateFile, id: string): boolean {
  if (Array.isArray(state.cronPaused) && state.cronPaused.includes(id)) return false;
  return true;
}

export interface UnansweredQuestion {
  senderOpenId: string;
  /** Display name of the asker (resolved at scan time, empty if lookup failed). */
  senderName?: string;
  mentionNames: string[];
  text: string;
  messageId: string;
  timestamp: number;
  /**
   * Where the question came from. Defaults to 'chat' for back-
   * compatibility; 'prd_comment' marks Lark doc comment threads
   * that the digest now also surfaces.
   */
  source?: 'chat' | 'prd_comment';
}

export interface UnansweredFinding {
  feature: MeegoFeature;
  questions: UnansweredQuestion[];
}

export interface DigestRunResult {
  featuresChecked: number;
  riskSent: boolean;
  unansweredSent: boolean;
  prdChangesSent: boolean;
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
// QA and UAT nodes — included in the risk digest too. These features have
// passed dev but still have deadlines (code freeze, launch) and risks.
// Default pipelineKind is 'mobile' since most features targeting these
// stages are mobile.
const QA_UAT_NODE_IDS = new Set<string>([
  'qa_test_preparation', // QA测试准备
  'state_34',            // 自动化测试
  'UAT_UIUX',            // UI&UX验收
  'PM_acceptance',       // PM验收
]);

const DEV_NODE_IDS = new Set<string>([
  ...MOBILE_DEV_NODE_IDS,
  ...SERVER_DEV_NODE_IDS,
  ...QA_UAT_NODE_IDS,
]);

function isInDev(allActiveNodeIds: string[]): boolean {
  return allActiveNodeIds.some(id => DEV_NODE_IDS.has(id));
}

/** Classify whether an in-dev feature should use the mobile or server pipeline. */
function classifyPipelineKind(allActiveNodeIds: string[]): 'mobile' | 'server' | undefined {
  if (allActiveNodeIds.some(id => MOBILE_DEV_NODE_IDS.has(id))) return 'mobile';
  if (allActiveNodeIds.some(id => SERVER_DEV_NODE_IDS.has(id))) return 'server';
  // QA/UAT features default to mobile pipeline (uses iosVersion + code freeze)
  if (allActiveNodeIds.some(id => QA_UAT_NODE_IDS.has(id))) return 'mobile';
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
export async function fetchMeegoFeature(workItemId: string, name: string, projectKey: string): Promise<MeegoFeature | null> {
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
  // Match Hamlet UI's logic (lib/meego.ts fetchFeature): pull all four
  // version fields off the work item brief, take the lowest LAUNCHED
  // version across iOS / Android; fall back to the lowest PLANNED if
  // neither launched field is set yet.
  let raw: string;
  try {
    raw = await callMeegoMcp('get_workitem_brief', {
      url: meegoUrl,
      fields: ['ios_actual_online_version', 'android_actual_online_version', 'field_08a9ca', 'field_c88970'],
    });
  } catch {
    return '';
  }
  let parsed: BriefJson;
  try { parsed = JSON.parse(raw) as BriefJson; } catch { return '';}
  const fields = parsed.work_item_fields ?? [];

  const lowest = (versions: string[]): string => {
    if (versions.length === 0) return '';
    return [...versions].sort((a, b) => {
      const [aMaj, aMin] = a.split('.').map(Number);
      const [bMaj, bMin] = b.split('.').map(Number);
      return (aMaj - bMaj) || ((aMin ?? 0) - (bMin ?? 0));
    })[0];
  };
  const get = (key: string): string[] =>
    extractShortVersions(fields.find(f => f.key === key)?.value);

  const launched = lowest([
    ...get('ios_actual_online_version'),
    ...get('android_actual_online_version'),
  ]);
  if (launched) return launched;
  return lowest([
    ...get('field_08a9ca'),
    ...get('field_c88970'),
  ]);
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
 * Fetch field-modification op records for a feature, walking pagination
 * to the end (capped at `maxPages` for safety). Records are returned by
 * the Meego API in chronological order (oldest first), so we can't early-
 * exit on a `sinceMs` cutoff — instead we collect everything past the
 * cutoff and filter in memory.
 *
 * `op_record_module` and `operation_type` filters are passed to the API
 * so each page only contains the records we care about; this drastically
 * reduces the number of pages a feature with thousands of op events
 * would otherwise need.
 */
async function fetchRecentOpRecords(meegoUrl: string, sinceMs: number, maxPages = 200): Promise<OpRecord[]> {
  const all: OpRecord[] = [];
  let startFrom: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const args: Record<string, unknown> = {
      url: meegoUrl,
      op_record_module: ['field_mod'],
      operation_type: ['modify'],
    };
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
    for (const r of records) {
      if (r.operation_time !== undefined && r.operation_time <= sinceMs) continue;
      all.push(r);
    }
    if (!parsed.has_more || !parsed.start_from) break;
    startFrom = parsed.start_from;
  }
  return all;
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
 * Walk the Meego activity log and return EVERY iOS / Android version change
 * for this feature, oldest first. Each entry is `{ date: 'YYYY-MM-DD', from,
 * to }` where `from`/`to` are short version names (e.g. "44.9").
 *
 * If `sinceMs` is provided, only records with `operation_time > sinceMs` are
 * scanned — used for incremental updates against a previously-cached list.
 * When `sinceMs` is omitted (or 0), the entire op log is walked, paginating
 * up to 50 pages.
 *
 * Multiple entries on the same date for the same field are kept as separate
 * transitions (so we don't lose intermediate hops).
 */
export async function getAllVersionChanges(
  meegoUrl: string,
  sinceMs = 0,
): Promise<Array<{ date: string; iso: string; from: string; to: string }>> {
  const records = await fetchRecentOpRecords(meegoUrl, sinceMs, 50);
  if (records.length === 0) return [];

  // Collect raw changes with timestamp, then resolve version names + sort.
  interface Raw { ts: number; oldId: string | number | undefined; newId: string | number | undefined }
  const raws: Raw[] = [];
  for (const r of records) {
    if (r.op_record_module !== 'field_mod') continue;
    if (r.operation_type !== 'modify') continue;
    const ts = r.operation_time ?? 0;
    if (ts <= sinceMs) continue;
    for (const c of r.record_contents ?? []) {
      const fk = c.object?.object_value;
      if (fk !== FIELD_KEY_IOS_VERSION && fk !== FIELD_KEY_ANDROID_VERSION) continue;
      const oldId = unwrapValue(c.old) as string | number | undefined;
      const newId = unwrapValue(c.new) as string | number | undefined;
      if (oldId === undefined || oldId === null || newId === undefined || newId === null) continue;
      raws.push({ ts, oldId, newId });
    }
  }
  if (raws.length === 0) return [];

  // Resolve unique version IDs once, then map back.
  const ids = new Set<string>();
  for (const r of raws) { ids.add(String(r.oldId)); ids.add(String(r.newId)); }
  const nameById = new Map<string, string>();
  await Promise.all([...ids].map(async id => {
    nameById.set(id, await resolveVersionShortName(id));
  }));

  const out: Array<{ date: string; iso: string; from: string; to: string }> = [];
  for (const r of raws) {
    const from = nameById.get(String(r.oldId)) ?? String(r.oldId);
    const to   = nameById.get(String(r.newId)) ?? String(r.newId);
    if (!from || !to || from === to) continue;
    const d = new Date(r.ts);
    if (isNaN(d.getTime())) continue;
    // Use Singapore time so the day boundary matches the rest of the digest.
    const date = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' }); // YYYY-MM-DD
    out.push({ date, iso: d.toISOString(), from, to });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

/**
 * Compare a numeric short version like "44.9" or "45.0" — returns
 * positive if a > b, negative if a < b, zero if equal. Returns null if
 * either side can't be parsed.
 */
function compareShortVersion(a: string, b: string): number | null {
  const pa = a.match(/^(\d+)\.(\d+)/);
  const pb = b.match(/^(\d+)\.(\d+)/);
  if (!pa || !pb) return null;
  const maj = Number(pa[1]) - Number(pb[1]);
  if (maj !== 0) return maj;
  return Number(pa[2]) - Number(pb[2]);
}

/**
 * Fetch a feature's iOS / Android planned + actual launched versions
 * from Meego and detect whether the actual launched version is higher
 * than the planned version on either platform (i.e. it slipped to a
 * later release than planned). Returns null if no mismatch — or if the
 * comparison can't be made because one side is empty / unparseable.
 */
export async function detectVersionMismatch(
  meegoUrl: string,
): Promise<{ platform: 'ios' | 'android'; planned: string; actual: string } | null> {
  let raw: string;
  try {
    raw = await callMeegoMcp('get_workitem_brief', {
      url: meegoUrl,
      fields: [...VERSION_LAUNCHED_FIELDS, ...VERSION_PLANNED_FIELDS],
    });
  } catch {
    return null;
  }
  let brief: BriefJson;
  try { brief = JSON.parse(raw) as BriefJson; } catch { return null; }
  const fields = brief.work_item_fields ?? [];
  const get = (key: string): string => {
    const val = fields.find(f => f.key === key)?.value;
    return extractShortVersions(val)[0] ?? '';
  };
  const iosPlanned   = get('field_08a9ca');
  const iosActual    = get('ios_actual_online_version');
  const androidPlanned = get('field_c88970');
  const androidActual  = get('android_actual_online_version');

  // Delayed when actual > planned on either platform. Both sides must be
  // present + parseable for the comparison to count.
  if (iosPlanned && iosActual) {
    const cmp = compareShortVersion(iosActual, iosPlanned);
    if (cmp !== null && cmp > 0) return { platform: 'ios', planned: iosPlanned, actual: iosActual };
  }
  if (androidPlanned && androidActual) {
    const cmp = compareShortVersion(androidActual, androidPlanned);
    if (cmp !== null && cmp > 0) return { platform: 'android', planned: androidPlanned, actual: androidActual };
  }
  return null;
}

/**
 * Walk the Meego op log to find the YYYY-MM-DD (Singapore time) of the
 * most recent edit to the given field key. Returns null if no matching
 * edit is found within the pagination cap.
 *
 * Pagination is oldest-first, so this walks ALL pages — expensive (~80s
 * for an active feature with hundreds of edits). Callers should only
 * invoke this on a transition (e.g. first detection of a new mismatch)
 * and cache the resulting date alongside their other state.
 */
export async function findLatestFieldEditDate(meegoUrl: string, fieldKey: string): Promise<string | null> {
  let records: OpRecord[];
  try {
    records = await fetchRecentOpRecords(meegoUrl, 0, 200);
  } catch {
    return null;
  }
  let latestMs = 0;
  for (const r of records) {
    const ts = r.operation_time ?? 0;
    if (ts <= latestMs) continue;
    const matched = (r.record_contents ?? []).some(c => c.object?.object_value === fieldKey);
    if (matched) latestMs = ts;
  }
  if (!latestMs) return null;
  const d = new Date(latestMs);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
}

/**
 * Format a unix-ms timestamp as "Apr 9" in Singapore time. Returns ''
 * for invalid / non-positive inputs so callers can short-circuit.
 */
function formatShortDateMs(ms: number): string {
  if (!ms || ms <= 0) return '';
  const d = new Date(ms);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'Asia/Singapore' });
}

/**
 * Compare a feature's "Server 计划上线时间" (Server Planned Launch Date,
 * field_cde888 on the QA-test-preparation node) against the schedule on
 * its "Server上线" (Server Launch) node. If the node's scheduled finish
 * is later than the planned launch date, the feature has slipped on the
 * server side — return both dates formatted as "Apr 9" / "Apr 13".
 *
 * Returns null when there is no Server上线 node, when either date is
 * missing, or when the schedule isn't past the planned date.
 */
export async function detectServerLaunchDelay(
  meegoUrl: string,
): Promise<{ planned: string; scheduled: string } | null> {
  let raw: string;
  try {
    raw = await callMeegoMcp('get_node_detail', { url: meegoUrl });
  } catch {
    return null;
  }
  let parsed: { list?: Array<{ basic?: { name?: string; node_key?: string }; schedule?: { estimate_finish_time?: number | null }; form_items?: Array<{ field_key?: string; value?: unknown }> }> };
  try { parsed = JSON.parse(raw); } catch { return null; }
  const nodes = parsed.list ?? [];

  // Find the Server Planned Launch Date (field_cde888) — typically lives
  // on the QA-test-preparation node but we accept it from any node.
  let plannedMs = 0;
  for (const node of nodes) {
    const item = (node.form_items ?? []).find(f => f.field_key === 'field_cde888');
    if (!item || item.value === null || item.value === undefined || item.value === '') continue;
    const v = typeof item.value === 'string' ? Number(item.value) : Number(item.value);
    if (!isNaN(v) && v > 0) { plannedMs = v; break; }
  }
  if (!plannedMs) return null;

  // Find the Server上线 node and its scheduled finish.
  const launchNode = nodes.find(n => n.basic?.name === 'Server上线');
  const scheduledMs = launchNode?.schedule?.estimate_finish_time ?? 0;
  if (!scheduledMs || scheduledMs <= 0) return null;

  // Treat scheduled-later-than-planned as a delay. Use a 1-day grace so
  // small intra-day differences don't false-positive.
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  if (scheduledMs - plannedMs <= ONE_DAY_MS) return null;

  const planned = formatShortDateMs(plannedMs);
  const scheduled = formatShortDateMs(scheduledMs);
  if (!planned || !scheduled) return null;
  return { planned, scheduled };
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
  } else if (feature.pipelineKind === 'server' && feature.serverPlannedLaunchDate) {
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
  }
  // Server features without a planned launch date: no deadline warning —
  // they default to green (Low risk) unless other signals flag them.

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
 * Stale-prior expiry: a Medium/High risk auto-resets to Low this many
 * days after it was first raised, regardless of whether new chat or
 * Meego comments arrive. Forces the system to re-derive the risk fresh
 * from the latest sources rather than keep an old summary alive
 * indefinitely. The Delayed marker (versionChanges) is unaffected —
 * that's a discrete event tracked separately.
 */
const RISK_STALE_PRIOR_DAYS = 7;

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
/**
 * Infer the cause of a planned-version slip from the feature's recent
 * group chat AND the latest Meego ticket comments. Slips are typically
 * decided over a longer horizon than the daily chat-risk window, so we
 * widen to 7 days here and also pull Meego comments — those are often
 * the most authoritative source ("moved to next ver because…").
 *
 * Returns a short clause (no leading "due to", no period) or null if
 * Gemini can't tell. Used only for newly-detected slips — the result
 * is cached on the versionChanges entry so we don't re-run Gemini on
 * every digest pass. Quietly returns null when Gemini isn't configured,
 * both sources are empty, or the model replies "unknown".
 */
const SLIP_REASON_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const SLIP_REASON_MAX_MESSAGES = 150;
const SLIP_REASON_MAX_COMMENTS = 30;

export async function inferVersionSlipReason(
  featureName: string,
  fromVersion: string,
  toVersion: string,
  chatId: string,
  rioToken: string,
  meegoUrl?: string,
): Promise<string | null> {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) return null;

  // (a) Last 7d of chat — best-effort. If chat is empty, the comments
  // path below may still produce a reason.
  let chatFormatted = '';
  if (chatId) {
    try {
      const messages = await readChatMessages(chatId, Date.now() - SLIP_REASON_WINDOW_MS, rioToken);
      chatFormatted = messages
        .slice(0, SLIP_REASON_MAX_MESSAGES)
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
    } catch (e) {
      console.warn(`[digests] slip-reason chat read failed for "${featureName}":`, e);
    }
  }

  // (b) Meego ticket comments — most reliable when the dev/PM logs the
  // slip cause directly on the ticket. Capped to the latest N to keep
  // the prompt small.
  let commentsFormatted = '';
  if (meegoUrl) {
    const m = meegoUrl.match(/meego\.larkoffice\.com\/([^/]+)\/(?:[^/]+)\/detail\/(\d+)/);
    if (m) {
      try {
        const comments = await fetchTicketComments(m[1], m[2]);
        commentsFormatted = comments
          .slice(-SLIP_REASON_MAX_COMMENTS)
          .map(c => {
            const date = c.createdAt ? `${c.createdAt} ` : '';
            const who = c.author ? `${c.author}: ` : '';
            const body = c.content.length > 400 ? `${c.content.slice(0, 400)}…` : c.content;
            return `${date}${who}${body}`;
          })
          .join('\n');
      } catch (e) {
        console.warn(`[digests] slip-reason Meego comments fetch failed for "${featureName}":`, e);
      }
    }
  }

  if (!chatFormatted && !commentsFormatted) return null;

  const { getPrompt: getPromptFn, getPromptModel: getModelFn } = await import('./prompts');
  const { renderPrompt: renderFn, getPromptDef: getDefFn } = await import('./prompt-registry');
  const def = getDefFn('hamlet.version_slip_reason');
  const tmpl = await getPromptFn('hamlet.version_slip_reason', def?.default ?? '');
  const modelName = await getModelFn('hamlet.version_slip_reason', def?.model ?? 'gemini-2.5-flash-lite');
  const prompt = renderFn(tmpl, {
    featureName,
    fromVersion,
    toVersion,
    messages: chatFormatted || '(no chat in the last 7 days)',
    comments: commentsFormatted || '(no Meego comments)',
  });

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: modelName });
    const result = await model.generateContent(prompt);
    const raw = result.response.text().trim().replace(/^["']|["']$/g, '').replace(/[.!?]+\s*$/, '');
    if (!raw || raw.toLowerCase() === 'unknown') {
      console.log(`[digests] slip-reason "${featureName}" ${fromVersion}→${toVersion}: (none inferred)`);
      return null;
    }
    console.log(`[digests] slip-reason "${featureName}" ${fromVersion}→${toVersion}: ${raw}`);
    return raw;
  } catch (e) {
    console.warn(`[digests] slip-reason Gemini failed for "${featureName}":`, e);
    return null;
  }
}

/**
 * Run the version-slip detection (op-log scan + snapshot mismatch +
 * server-launch slip) and slip-reason inference for every cached
 * feature, then patch the resulting `versionChanges` arrays into the
 * GCS feature cache. The risk-level computation (riskLevel/riskNotes/
 * riskHistory) is intentionally NOT done here — that depends on the
 * Gemini chat-risk findings which only run during the full-mode
 * pipeline. This extract lets the cheap, no-Gemini-risk-dependent
 * cache writeback also happen on every refresh-feature-cache run.
 *
 * Idempotent: subsequent calls (including the full-mode Step 6b that
 * also runs version detection) reach the same result for unchanged
 * data.
 */
async function patchVersionChangesInCache(
  features: MeegoFeature[],
  botToken: string,
): Promise<void> {
  let featureCache: Awaited<ReturnType<typeof readFeatureCache>>;
  try {
    featureCache = await readFeatureCache();
  } catch (e) {
    console.warn('[digests] patchVersionChangesInCache: cache read failed:', e);
    return;
  }
  if (!featureCache) return;
  const featureByWorkItemId = new Map(features.map(f => [f.workItemId, f]));
  const deltas = new Map<string, Partial<import('./types').Feature>>();
  let scanned = 0;
  let changed = 0;
  for (const cached of featureCache.features) {
    const fId = cached.meegoIssueId ?? cached.id;
    if (cached.status === 'Done' || cached.status === '已完成') continue;
    const meegoFeature = featureByWorkItemId.get(fId);
    const meegoUrl = meegoFeature?.meegoUrl ?? cached.meegoUrl;
    if (!meegoUrl) continue;
    scanned++;
    let nextVersionChanges = cached.versionChanges;
    let versionChangesChanged = false;
    // (i) Op-log scan.
    try {
      const existing = cached.versionChanges ?? [];
      const sinceMs = existing.length > 0
        ? Date.parse(existing[existing.length - 1].date + 'T00:00:00+08:00') || 0
        : 0;
      const fresh = await getAllVersionChanges(meegoUrl, sinceMs);
      if (fresh.length > 0) {
        const seen = new Set(existing.map(c => `${c.date}|${c.from}|${c.to}`));
        const merged = [...existing];
        for (const c of fresh) {
          const k = `${c.date}|${c.from}|${c.to}`;
          if (!seen.has(k)) { merged.push(c); seen.add(k); }
        }
        merged.sort((a, b) => a.date.localeCompare(b.date));
        nextVersionChanges = merged;
        versionChangesChanged = true;
      }
    } catch (e) {
      console.warn(`[digests] patchVC: op-log scan failed for ${cached.name}:`, e);
    }
    // (ii) Snapshot mismatch.
    try {
      const mismatch = await detectVersionMismatch(meegoUrl);
      if (mismatch) {
        const list = nextVersionChanges ?? [];
        const matchesPair = (c: { from: string; to: string }) =>
          c.from === mismatch.planned && c.to === mismatch.actual;
        const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
        const matchingEntries = list.filter(matchesPair);
        const alreadyCached = matchingEntries.length === 1 && matchingEntries[0].date !== today;
        if (!alreadyCached) {
          const launchedFieldKey = mismatch.platform === 'ios'
            ? 'ios_actual_online_version'
            : 'android_actual_online_version';
          let date: string | null = null;
          try { date = await findLatestFieldEditDate(meegoUrl, launchedFieldKey); } catch {}
          if (!date) date = today;
          const cleaned = list.filter(c => !matchesPair(c));
          nextVersionChanges = [...cleaned, { date, iso: new Date().toISOString(), from: mismatch.planned, to: mismatch.actual }]
            .sort((a, b) => a.date.localeCompare(b.date));
          versionChangesChanged = true;
        }
      }
    } catch (e) {
      console.warn(`[digests] patchVC: mismatch check failed for ${cached.name}:`, e);
    }
    // (iii) Server-launch slip.
    try {
      const serverDelay = await detectServerLaunchDelay(meegoUrl);
      if (serverDelay) {
        const list = nextVersionChanges ?? [];
        const matchesPair = (c: { from: string; to: string }) =>
          c.from === serverDelay.planned && c.to === serverDelay.scheduled;
        const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
        const matchingEntries = list.filter(matchesPair);
        const alreadyCached = matchingEntries.length === 1 && matchingEntries[0].date !== today;
        if (!alreadyCached) {
          let date: string | null = null;
          try { date = await findLatestFieldEditDate(meegoUrl, 'field_cde888'); } catch {}
          if (!date) date = today;
          const cleaned = list.filter(c => !matchesPair(c));
          nextVersionChanges = [...cleaned, { date, iso: new Date().toISOString(), from: serverDelay.planned, to: serverDelay.scheduled }]
            .sort((a, b) => a.date.localeCompare(b.date));
          versionChangesChanged = true;
        }
      }
    } catch (e) {
      console.warn(`[digests] patchVC: server-launch check failed for ${cached.name}:`, e);
    }
    // (iv) Slip-reason inference. Same logic as Step 6b's path (iv):
    // carry forward cached reason; never re-infer; one retroactive
    // pass for entries lacking both reason and reasonAttempted.
    if (!nextVersionChanges) nextVersionChanges = cached.versionChanges;
    const needsRetroactive = (nextVersionChanges ?? []).some(
      e => !e.reason && !e.reasonAttempted,
    );
    if ((versionChangesChanged || needsRetroactive) && nextVersionChanges && nextVersionChanges.length > 0 && (cached.chatId || cached.meegoUrl)) {
      const prior = cached.versionChanges ?? [];
      // Match on (from, to) only — the version transition uniquely
      // identifies the slip. Paths (ii)/(iii) sometimes re-record an
      // entry with a slightly different date (op-log lookup vs today
      // fallback), so keying on date here would lose the cached reason
      // and cause Gemini to re-infer with a fresh (possibly different)
      // wording. Once a reason is set for a (from, to) pair, keep it.
      const findCached = (e: { from: string; to: string }) =>
        prior.find(p => p.from === e.from && p.to === e.to);
      const updated = await Promise.all(nextVersionChanges.map(async e => {
        const cachedEntry = findCached(e);
        if (cachedEntry?.reason) return { ...e, reason: cachedEntry.reason, reasonAttempted: true };
        if (cachedEntry?.reasonAttempted) return { ...e, reasonAttempted: true };
        try {
          const reason = await inferVersionSlipReason(cached.name, e.from, e.to, cached.chatId ?? '', botToken, cached.meegoUrl);
          return reason ? { ...e, reason, reasonAttempted: true } : { ...e, reasonAttempted: true };
        } catch (err) {
          console.warn(`[digests] patchVC: slip-reason failed for "${cached.name}":`, err);
          return e;
        }
      }));
      const inferenceChanged = updated.some((u, i) => {
        const before = nextVersionChanges![i];
        return u.reason !== before.reason || u.reasonAttempted !== before.reasonAttempted;
      });
      if (inferenceChanged) versionChangesChanged = true;
      nextVersionChanges = updated;
    }
    if (versionChangesChanged) {
      deltas.set(fId, { versionChanges: nextVersionChanges });
      changed++;
    }
  }
  if (deltas.size > 0) {
    try { await patchFeaturesInCache(deltas); } catch (e) {
      console.warn('[digests] patchVersionChangesInCache: patchFeaturesInCache failed:', e);
    }
  }
  console.log(`[digests] patchVersionChangesInCache: ${scanned} scanned, ${changed} updated`);
}

export async function evaluateChatRisk(
  chatId: string,
  featureName: string,
  rioToken: string,
  prior?: PriorChatRisk,
  meegoUrl?: string,
): Promise<ChatRiskFinding> {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    return prior ? { level: prior.level, summary: prior.summary } : { level: 'none', summary: '' };
  }

  // Pull messages over the wider 7d window — risks usually surface in
  // discussion that pre-dates the digest run, similar to how slips get
  // discussed before the field actually moves.
  let messages: ChatMessage[] = [];
  try {
    messages = await readChatMessages(chatId, Date.now() - SLIP_REASON_WINDOW_MS, rioToken);
  } catch (e) {
    console.warn(`[digests] chat read failed for ${featureName}:`, e);
    // Read failed: don't lose a prior risk just because we couldn't read.
    return prior ? { level: prior.level, summary: prior.summary } : { level: 'none', summary: '' };
  }

  // Format chronologically (oldest first), strip out Lark text JSON wrapper.
  const chatFormatted = messages
    .slice(0, SLIP_REASON_MAX_MESSAGES)
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

  // Pull recent Meego ticket comments — devs/PMs often log the cause
  // there directly. Filter to the same 7d window as the chat: a comment
  // from 4+ weeks ago describing a since-resolved blocker shouldn't
  // drive current-state risk inference. (Slip-reason is different and
  // intentionally keeps a wider window — the slip is a discrete event
  // that may have been discussed weeks before the field actually moved.)
  let commentsFormatted = '';
  if (meegoUrl) {
    const m = meegoUrl.match(/meego\.larkoffice\.com\/([^/]+)\/(?:[^/]+)\/detail\/(\d+)/);
    if (m) {
      try {
        const allComments = await fetchTicketComments(m[1], m[2]);
        const cutoffMs = Date.now() - SLIP_REASON_WINDOW_MS;
        const recent = allComments.filter(c => {
          if (!c.createdAt) return false;
          const ts = Date.parse(`${c.createdAt}T00:00:00+08:00`);
          return Number.isFinite(ts) && ts >= cutoffMs;
        });
        commentsFormatted = recent
          .slice(-SLIP_REASON_MAX_COMMENTS)
          .map(c => {
            const date = c.createdAt ? `${c.createdAt} ` : '';
            const who = c.author ? `${c.author}: ` : '';
            const body = c.content.length > 400 ? `${c.content.slice(0, 400)}…` : c.content;
            return `${date}${who}${body}`;
          })
          .join('\n');
      } catch (e) {
        console.warn(`[digests] chat-risk Meego comments fetch failed for "${featureName}":`, e);
      }
    }
  }

  if (!chatFormatted && !commentsFormatted) {
    // No fresh material in either source. Staleness was already
    // checked at the call site, so any `prior` here is within the
    // 7-day window — carry it forward unchanged.
    if (prior) {
      console.log(
        `[digests] Gemini risk for "${featureName}" (no recent chat or comments, carrying prior): ${JSON.stringify({ level: prior.level, summary: prior.summary })}`,
      );
      return { level: prior.level, summary: prior.summary };
    }
    return { level: 'none', summary: '' };
  }

  // Build the prompt from the registry — separate templates for "with prior"
  // vs "no prior" so each can be edited independently in the admin UI.
  const { getPrompt: getPromptFn, getPromptModel: getModelFn } = await import('./prompts');
  const { renderPrompt: renderFn, getPromptDef: getDefFn } = await import('./prompt-registry');
  const promptId = prior ? 'hamlet.chat_risk_eval_prior' : 'hamlet.chat_risk_eval';
  const def = getDefFn(promptId);
  const tmpl = await getPromptFn(promptId, def?.default ?? '');
  const modelName = await getModelFn(promptId, def?.model ?? 'gemini-2.5-flash-lite');
  const prompt = renderFn(tmpl, prior ? {
    featureName,
    priorLevel: prior.level,
    priorSummary: prior.summary,
    priorDate: prior.raisedAtIso.slice(0, 10),
    messages: chatFormatted || '(no chat in the last 7 days)',
    comments: commentsFormatted || '(no Meego comments)',
  } : {
    featureName,
    messages: chatFormatted || '(no chat in the last 7 days)',
    comments: commentsFormatted || '(no Meego comments)',
  });

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: modelName });
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
    const priorTag = prior ? `, prior=${prior.level}` : '';
    console.log(
      `[digests] Gemini risk for "${featureName}" (${messages.length} msgs/7d, ${commentsFormatted ? 'with' : 'no'} Meego comments${priorTag}): ${JSON.stringify({ level, summary })}`,
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

  // Use the same Chinese→English overall-status mapping that Hamlet's
  // UI uses, so the digest card and Hamlet display the same label
  // (e.g. "AB Testing" for 实验中) instead of the picked-active-node
  // bucket (which would say "In Development" for the same feature).
  const statusLabel = resolveDisplayStatus(f.overallStatusName);
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
    // Reasons display in parens after the level label — capitalise the
    // first letter of each so they read as their own short clauses
    // regardless of how Gemini emitted them.
    const riskValue = finding.reasons.length > 0
      ? `${label} (${finding.reasons.map(r => escapeMd(r ? r.charAt(0).toUpperCase() + r.slice(1) : r)).join(', ')})`
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

/**
 * Per-digest-run cache of user name lookups. Keyed by `${idType}:${id}`
 * so we don't repeat the contact API call for the same user across
 * features. Populated lazily by `lookupUserName`.
 */
const userNameCache = new Map<string, string>();

async function lookupUserName(id: string, idType: 'open_id' | 'user_id'): Promise<string> {
  if (!id) return '';
  const key = `${idType}:${id}`;
  if (userNameCache.has(key)) return userNameCache.get(key)!;
  const name = await resolveUserName(id, idType);
  userNameCache.set(key, name);
  return name;
}

/**
 * Use Gemini to decide whether any of `laterReplies` actually answers
 * the original `question`. The thread-activity gate (parent_id /
 * root_id matching for chat, additional reply_list entries for PRD
 * comments) only proves there's activity AFTER the question — it
 * doesn't prove a real answer. Many "replies" are follow-ups,
 * restatements, or unrelated chatter.
 *
 * Returns true if Gemini says the question is answered. On any
 * failure (no API key, network error, parse failure) returns true
 * so we trust the thread-activity rule and don't flood the digest
 * with false positives.
 */
async function isAnsweredByGemini(
  question: string,
  laterReplies: string[],
  contextLabel: string,
): Promise<boolean> {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey || laterReplies.length === 0) return true;
  const prompt = `Original question/request: "${question.replace(/"/g, '\\"')}"

Later messages in the same thread, in chronological order:
${laterReplies.map((r, i) => `(${i + 1}) "${r.replace(/"/g, '\\"').slice(0, 500)}"`).join('\n')}

Did any of the later messages actually answer or directly address the original question/request? Treat reactions, restatements, follow-up questions, or unrelated chatter as NOT answers. Only count messages that provide a real response.

Reply with ONLY "yes" or "no", no other text.`;
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });
    const result = await model.generateContent(prompt);
    const raw = result.response.text().trim().toLowerCase();
    const answered = raw.startsWith('y');
    console.log(`[digests] Gemini answer-check (${contextLabel}): ${answered ? 'answered' : 'unanswered'} (raw=${JSON.stringify(raw).slice(0, 60)})`);
    return answered;
  } catch (e) {
    console.warn(`[digests] Gemini answer-check failed (${contextLabel}), defaulting to "answered":`, e);
    return true;
  }
}

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
  return findLaterThreadMessages(question, all).length > 0;
}

/**
 * Return all messages that come AFTER `question` in the same thread:
 *   - direct replies (`parent_id === question.message_id`)
 *   - thread members (`root_id === question.message_id`)
 *   - if the question is itself a thread reply, any later message in
 *     the same thread (shared `root_id`, later `create_time`)
 *
 * Sorted by create_time ascending. Used both for the structural
 * "has any later activity" gate and for the Gemini answer check.
 */
function findLaterThreadMessages(question: ChatMessage, all: ChatMessage[]): ChatMessage[] {
  const qId = question.message_id;
  const qRoot = question.root_id ?? '';
  const qTime = Number(question.create_time ?? 0);
  const out: ChatMessage[] = [];
  for (const m of all) {
    if (m.message_id === qId) continue;
    const mt = Number(m.create_time ?? 0);
    const matches =
      m.parent_id === qId ||
      m.root_id === qId ||
      (qRoot !== '' && m.root_id === qRoot && mt > qTime);
    if (matches) out.push(m);
  }
  out.sort((a, b) => Number(a.create_time ?? 0) - Number(b.create_time ?? 0));
  return out;
}

function chatMessageText(m: ChatMessage): string {
  const raw = m.body?.content ?? '';
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    let text = '';
    // text msg: {text: "..."}
    if (typeof parsed.text === 'string') {
      text = parsed.text;
    }
    // post msg (rich text): {title, content: [[{tag,text,user_id,...}]]}
    // OR localised: {zh_cn: {title, content}, en_us: {...}}
    // OR Lark interactive shape: {title, elements: [[...]]}
    if (!text) {
      let blocks: unknown[][] | null = null;
      if ('content' in parsed && Array.isArray(parsed.content)) blocks = parsed.content as unknown[][];
      else if ('elements' in parsed && Array.isArray(parsed.elements)) blocks = parsed.elements as unknown[][];
      if (!blocks) {
        for (const v of Object.values(parsed)) {
          if (v && typeof v === 'object' && Array.isArray((v as { content?: unknown }).content)) {
            blocks = (v as { content: unknown[][] }).content;
            break;
          }
        }
      }
      if (blocks) {
        const lines: string[] = [];
        for (const para of blocks) {
          const lineParts = (para as Array<Record<string, unknown>>).map(inline => {
            if (inline.tag === 'text' && typeof inline.text === 'string') return inline.text;
            if (inline.tag === 'a' && typeof inline.text === 'string') return inline.text;
            // Skip 'at' inlines — they appear in mentions[] separately and get stripped below.
            return '';
          });
          const line = lineParts.join('').trim();
          if (line) lines.push(line);
        }
        text = lines.join(' ');
      }
    }
    text = text.trim();
    for (const mention of m.mentions ?? []) text = text.replace(mention.key, '').trim();
    return text;
  } catch {
    return raw.trim();
  }
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
    // includeThreadReplies: Lark's v1 list-messages API only returns
    // top-level messages; thread replies must be fetched separately.
    // Without this, findLaterThreadMessages can't see any answers.
    messages = await readChatMessages(chatId, sinceMs, token, { includeThreadReplies: true });
  } catch (e) {
    console.warn(`[digests] failed to read messages for ${feature.name}:`, e);
    return null;
  }
  if (messages.length === 0) {
    console.log(`[digests] Q&A "${feature.name}" (chat=${chatId}): 0 messages in 24h window`);
    return null;
  }
  console.log(`[digests] Q&A "${feature.name}" (chat=${chatId}): ${messages.length} messages fetched`);

  // Candidates: any message in the window that @-mentions the owner.
  // Exclude messages sent by the bot itself (Junior auto-posts that
  // happen to tag Thomas — those arent real questions) and by Thomas
  // himself (he's the answerer, not the asker).
  // Defensive create_time filter: Lark's /im/v1/messages list filters
  // by message UPDATE time, not CREATE time — so an older message
  // whose thread saw recent activity can sneak past the start_time
  // parameter. Enforce the window here on the actual question's
  // create_time so the digest only ever surfaces questions asked in
  // the last 24h.
  const botOpenId = process.env.LARK_BOT_OPEN_ID ?? '';
  const mentionMsgs = messages.filter(m => {
    const createMs = Number(m.create_time ?? 0) * 1000;
    if (createMs && createMs < sinceMs) return false;
    if (!(m.mentions ?? []).some(mention => mentionOpenId(mention) === ownerOpenId)) return false;
    const sender = senderOpenIdOf(m);
    if (sender && (sender === ownerOpenId || sender === botOpenId)) return false;
    return true;
  });
  console.log(`[digests] Q&A "${feature.name}": ${mentionMsgs.length} msgs mentioning owner (bot/owner senders filtered out)`);
  if (mentionMsgs.length === 0) return null;

  // Newest first — per-chat dedup means the freshest unanswered wins.
  mentionMsgs.sort((a, b) => Number(b.create_time ?? 0) - Number(a.create_time ?? 0));

  // Decision rules (per-question), in order:
  //   (a) Owner reacted with any emoji on the question → answered.
  //   (b) Otherwise, ask Gemini ONE question with the whole subsequent
  //       conversation in this chat (top-level + thread replies, since
  //       readChatMessages was called with includeThreadReplies: true).
  //       Gemini returns one of:
  //         - not_a_question: tagged message isn't actually asking
  //           anything (FYIs, statements). Skip.
  //         - addressed: question was answered by the later messages.
  //           Skip.
  //         - outstanding: still needs the owner's response. Flag.
  //
  // We deliberately do NOT short-circuit on "any thread reply exists"
  // anymore — a follow-up @-mention from a third party in the same
  // thread (e.g. "@Thomas yes please confirm") is itself a thread
  // reply but doesn't actually answer the original. Gemini judges the
  // reply contents instead.
  // Surface every unanswered question in the chat (no per-chat cap).
  const flaggedQuestions: UnansweredQuestion[] = [];
  for (const msg of mentionMsgs) {
    const qLabel = `chat "${feature.name}" msg=${msg.message_id}`;

    // (a) Owner reaction → acknowledged.
    let ownerReacted = false;
    try {
      const reactions = await listMessageReactions(msg.message_id, token);
      ownerReacted = reactions.some(r => r.openId === ownerOpenId);
    } catch { /* fall through */ }
    if (ownerReacted) {
      console.log(`[digests] ${qLabel} → answered (owner reacted)`);
      continue;
    }

    // (b) Gemini check with the whole subsequent chat (may be empty).
    // laterChat includes both top-level messages and in-thread replies
    // sent after this question, because readChatMessages was called
    // with includeThreadReplies: true.
    const qTime = Number(msg.create_time ?? 0);
    const laterChat = messages
      .filter(m => m.message_id !== msg.message_id && Number(m.create_time ?? 0) > qTime)
      .sort((a, b) => Number(a.create_time ?? 0) - Number(b.create_time ?? 0));
    const threadReplyCount = findLaterThreadMessages(msg, messages).length;
    console.log(`[digests] ${qLabel} → Gemini check (${laterChat.length} later msgs, ${threadReplyCount} thread replies)`);
    const questionText = chatMessageText(msg);
    const laterTexts = laterChat.map(chatMessageText).filter(t => t.length > 0);
    const outstanding = await isOutstandingByGemini(questionText, laterTexts, qLabel);
    if (!outstanding) continue;

    flaggedQuestions.push(await buildUnansweredQuestion(msg));
  }

  if (flaggedQuestions.length === 0) return null;
  // Re-sort oldest-first so the digest shows them in conversation order.
  flaggedQuestions.sort((a, b) => a.timestamp - b.timestamp);
  return { feature, questions: flaggedQuestions };
}

async function buildUnansweredQuestion(msg: ChatMessage): Promise<UnansweredQuestion> {
  const text = chatMessageText(msg);
  const senderOpenId = senderOpenIdOf(msg);
  const senderName = senderOpenId ? await lookupUserName(senderOpenId, 'open_id') : '';
  return {
    senderOpenId,
    senderName,
    mentionNames: (msg.mentions ?? []).map(m => m.name),
    text: text.slice(0, 280),
    messageId: msg.message_id,
    timestamp: Number(msg.create_time ?? 0) * 1000,
    source: 'chat',
  };
}

/**
 * Ask Gemini whether a question is still outstanding given all messages
 * that came after it in the same chat. Returns true when Gemini says
 * the question is unanswered. Defaults to true on any failure (better
 * to over-flag than miss).
 */
async function isOutstandingByGemini(
  question: string,
  laterConversation: string[],
  contextLabel: string,
): Promise<boolean> {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  // Without a key we can't run the gate — default to "outstanding" so we
  // don't silently swallow real questions.
  if (!apiKey) return true;
  // Cap to avoid massive prompts on busy chats.
  const capped = laterConversation.slice(0, 50);
  const conversationBlock = capped.length === 0
    ? '(no subsequent messages in the chat)'
    : capped.map((r, i) => `(${i + 1}) "${r.replace(/"/g, '\\"').slice(0, 500)}"`).join('\n');
  const prompt = `A team member tagged the chat owner in this message in a feature group chat:
"${question.replace(/"/g, '\\"').slice(0, 800)}"

Subsequent messages in the same chat, chronological order:
${conversationBlock}

Decide one of three labels:
- "not_a_question": the tagged message is not actually asking a question or requesting a decision/action from the owner. Examples: status updates, FYI shares, links being passed along, statements of fact, observations, conclusions.
- "addressed": the tagged message IS a question or request, AND it was directly addressed/answered by a subsequent message. Reactions, restatements, follow-up questions, and unrelated chatter do NOT count as addressing it.
- "outstanding": the tagged message IS a question or request that has NOT been addressed yet — the owner still needs to respond.

Reply with ONLY one word: "not_a_question", "addressed", or "outstanding". No other text.`;
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });
    const result = await model.generateContent(prompt);
    const raw = result.response.text().trim().toLowerCase();
    // Only "outstanding" flags the message; both "not_a_question" and
    // "addressed" mean we should skip it.
    const outstanding = raw.startsWith('outstanding');
    const verdict = raw.startsWith('not') ? 'not_a_question'
      : raw.startsWith('addressed') ? 'addressed'
      : raw.startsWith('outstanding') ? 'outstanding'
      : `unknown(${raw.slice(0, 30)})`;
    console.log(`[digests] Gemini outstanding-check (${contextLabel}): ${verdict}`);
    return outstanding;
  } catch (e) {
    console.warn(`[digests] Gemini outstanding-check failed (${contextLabel}), defaulting to "outstanding":`, e);
    return true;
  }
}

/**
 * Scan a feature's PRD for unanswered comment threads. Mirrors the
 * chat-based check: a thread counts as unanswered when it isn't
 * resolved AND was created/touched in the last 24h AND the owner
 * (Thomas) hasn't posted any reply in the thread. We optionally
 * tighten further to threads that explicitly @-mention the owner.
 *
 * NOTE: Lark's doc-comment API labels its identifier field `user_id`
 * but actually returns OPEN_IDs (values like `ou_…`). The
 * `ownerOpenId` parameter must therefore be the open_id, not the
 * employee user_id.
 */
export async function collectUnansweredCommentsForFeature(
  feature: MeegoFeature,
  ownerOpenId: string,
  sinceMs: number,
  opts: { mentionOnly?: boolean } = {},
): Promise<UnansweredQuestion[]> {
  if (!feature.prd) return [];
  let threads: Awaited<ReturnType<typeof listDocCommentsDetailed>>;
  try {
    threads = await listDocCommentsDetailed(feature.prd);
  } catch (e) {
    console.warn(`[digests] PRD comments fetch failed for "${feature.name}":`, e);
    return [];
  }
  const out: UnansweredQuestion[] = [];
  for (const t of threads) {
    if (t.isSolved) continue;
    if (t.replies.length === 0) continue;
    const original = t.replies[0];
    // The thread should have been created or last updated recently —
    // either the original is fresh, or someone replied recently.
    const lastTouchMs = Math.max(t.updateTime, ...t.replies.map(r => r.createTime));
    if (lastTouchMs < sinceMs) continue;
    // Skip threads where the owner has already replied.
    const ownerReplied = t.replies.some(r => r.userId === ownerOpenId);
    if (ownerReplied) continue;
    // Skip threads the owner started (they're the asker, not the askee).
    if (original.userId === ownerOpenId) continue;
    // Optional stricter filter: only threads that @-mention the owner.
    if (opts.mentionOnly) {
      const mentionsOwner = t.replies.some(r => r.mentionedUserIds.includes(ownerOpenId));
      if (!mentionsOwner) continue;
    }
    // If there are OTHER non-owner replies in the thread, ask Gemini
    // whether any of them actually answers the original comment. The
    // owner can't have replied (we'd have skipped above), so any
    // later reply is from a different participant — they may or may
    // not have addressed the question.
    const laterReplies = t.replies.slice(1).filter(r => r.text.length > 0);
    if (laterReplies.length > 0) {
      const questionText = (t.quote ? `"${t.quote}" — ` : '') + (original.text || '');
      const replyTexts = laterReplies.map(r => r.text);
      const answered = await isAnsweredByGemini(
        questionText,
        replyTexts,
        `prd "${feature.name}" comment=${t.commentId}`,
      );
      if (answered) continue;
    }
    // For PRD comments, drop the quoted text from the preview — the
    // bullet should show the actual question, not the snippet of doc
    // the comment was anchored to.
    const preview = (original.text || '(no text)').slice(0, 500);
    // Lark's doc-comment user_id field actually contains an open_id,
    // so resolve as open_id rather than user_id.
    const senderName = await lookupUserName(original.userId, 'open_id');
    out.push({
      senderOpenId: original.userId,
      senderName,
      mentionNames: [],
      text: preview,
      messageId: t.commentId,
      timestamp: original.createTime,
      source: 'prd_comment',
    });
  }
  // Newest first, capped at MAX_QUESTIONS_PER_FEATURE.
  out.sort((a, b) => b.timestamp - a.timestamp);
  return out.slice(0, MAX_QUESTIONS_PER_FEATURE);
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
    finding.questions.forEach((q, qIdx) => {
      const sourceLabel = q.source === 'prd_comment' ? 'PRD comment' : 'Chat';
      // Render the asker as a Lark @mention via open_id — Lark's
      // client resolves the display name + avatar from the id.
      let fromTag = '';
      if (q.senderOpenId && q.senderOpenId.startsWith('ou_')) {
        fromTag = ` from <at id="${q.senderOpenId}"></at>`;
      } else if (q.senderName) {
        fromTag = ` from @${q.senderName}`;
      }
      const preview = (q.text || '(no text)').replace(/\s+/g, ' ').trim();
      const safePreview = escapeMd(preview);
      // Fold the feature name into the first question's section so
      // every question gets its own action row without an extra
      // header section bloating the divider count.
      const lines: string[] = [];
      if (qIdx === 0) lines.push(`**${escapeMd(f.name)}**`);
      lines.push(`${sourceLabel}${fromTag}: ${safePreview}`);

      const buttons: CardButton[] = [];
      if (f.prd) buttons.push({ text: 'Open PRD', type: 'default', url: f.prd });
      if (f.chatId) {
        buttons.push({
          text: 'Open Group',
          type: 'default',
          url: `https://applink.larkoffice.com/client/chat/open?openChatId=${f.chatId}`,
        });
      }
      if (q.source === 'prd_comment' || q.source === 'chat') {
        buttons.push({
          text: 'Let me Reply',
          type: 'primary',
          value: {
            action: 'letjr_reply',
            featureName: f.name,
            prdUrl: f.prd ?? '',
            chatId: f.chatId ?? '',
            questionText: q.text,
            askerOpenId: q.senderOpenId,
            questionSource: q.source,
            commentId: q.source === 'prd_comment' ? q.messageId : '',
            chatMessageId: q.source === 'chat' ? q.messageId : '',
          },
        });
      }
      sections.push({ content: lines.join('\n'), buttons: buttons.length > 0 ? buttons : undefined });
    });
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

// ─── Task 2: PRD Changes digest card ────────────────────────────────────────

export function buildPrdChangesDigestCard(
  changes: Array<{
    name: string;
    prdUrl: string;
    meegoUrl: string;
    summary: string;
    chatId?: string;
    workItemId?: string;
    pocEmails?: string[];
  }>,
): { title: string; template: CardHeaderTemplate; sections: CardSection[] } {
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'Asia/Singapore',
  });
  const title = `📝 Daily PRD Changes — ${today}`;
  const template: CardHeaderTemplate = 'blue';
  const sections: CardSection[] = [];

  if (changes.length === 0) {
    sections.push({ content: 'No PRD changes in the last 24 hours.' });
    return { title, template, sections };
  }

  sections.push({
    content: `**${changes.length} PRD${changes.length === 1 ? '' : 's'} updated**`,
  });

  for (const c of changes) {
    const linkParts = [`[Meego](${c.meegoUrl})`, `[PRD](${c.prdUrl})`];
    const lines: string[] = [];
    lines.push(`**${escapeMd(c.name)}** (${linkParts.join(', ')})`);
    lines.push(`  • ${escapeMd(c.summary)}`);

    const buttons = c.chatId
      ? [{
          text: 'Send to Feature Group',
          type: 'primary' as const,
          value: {
            action: 'send_prd_change_to_group',
            chatId: c.chatId,
            featureName: c.name,
            prdUrl: c.prdUrl,
            summary: c.summary,
            pocEmails: c.pocEmails ?? [],
          },
        }]
      : undefined;

    sections.push({ content: lines.join('\n'), buttons });
  }

  return { title, template, sections };
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

// ─── AB Testing transition notification ───────────────────────────────────

/**
 * Lark chat IDs for the AB-open notification flow. The "draft" card
 * (with a Send button) goes to the PM's personal group; in production
 * the button forwards the formatted message to the wider PM group.
 *
 * For now BOTH the draft AND the button-forwarded message land in the
 * personal group so we can iterate on the format without spamming the
 * real PM group. Flip AB_OPEN_TARGET_CHAT_ID to AB_OPEN_PM_GROUP_CHAT_ID
 * once we're satisfied.
 */
const AB_OPEN_PERSONAL_CHAT_ID = 'oc_d1f9b0ad6b325ef6699e0422fa1e8541';
const AB_OPEN_PM_GROUP_CHAT_ID = 'oc_ea2940122b041a9c9ee4153596d6a15c';
const AB_OPEN_TARGET_CHAT_ID = AB_OPEN_PERSONAL_CHAT_ID; // ← change to AB_OPEN_PM_GROUP_CHAT_ID when ready
// Open ID of the PM whose name should be @-mentioned in the
// forwarded post (so the message looks "from" them). Sent by the
// bot but pinging the PM gives the same effect for readers.
const AB_OPEN_MENTION_OPEN_ID = 'ou_1e7fa98f1e46311d8a5e4554dc7a668e';

const AB_SETUP_ALIASES = [
  'ab set-up',
  'a/b set-up',
  'a/b testing setup',
  'ab testing setup',
  'a/b testing set-up',
  'ab testing set-up',
  'a/b setup',
  'ab setup',
  'experiment setup',
  'a/b test setup',
  'ab test setup',
  'a/b 设置',
  'ab实验设置',
];

/**
 * Build the per-feature card section + Send-button payload for one
 * AB-open transition. Reads + parses the feature's PRD on each call;
 * called once per transitioning feature in parallel. Returns the
 * lark_md card content and the rich-text post payload that the Send
 * button will forward.
 */
export async function buildAbOpenSection(
  feature: MeegoFeature,
  libraUrl: string,
  userAccessToken?: string,
): Promise<{
  cardContent: string;
  cardImages: Array<{ image_key: string; alt?: string }>;
  postTitle: string;
  postParagraphs: PostParagraph[];
}> {
  let background = '_(Background section not found in PRD — fill in)_';
  let abSetup = '_(A/B Setup section not found in PRD — fill in)_';
  if (feature.prd) {
    try {
      const md = await readDocContent(feature.prd);
      const sections = extractDocSections(md, [
        { canonical: 'Background', aliases: [
          'what we are building?',
          'what we are building and why?',
          'what we are building and why',
          'what we are building',
          'what are we building?',
          'what are we building and why?',
          'what are we building and why',
          'what are we building',
        ] },
        { canonical: 'AbSetup', aliases: AB_SETUP_ALIASES },
      ]);
      if (sections.has('Background')) background = sections.get('Background')!;
      if (sections.has('AbSetup'))    abSetup    = sections.get('AbSetup')!;
      try {
        const fromTable = await extractAbSetupTable(feature.prd, AB_SETUP_ALIASES);
        if (fromTable) abSetup = fromTable;
      } catch (e) {
        console.warn(`[digests] AB Setup table extraction failed for "${feature.name}":`, e);
      }
    } catch (e) {
      console.warn(`[digests] PRD section extraction failed for "${feature.name}":`, e);
    }
  }

  const versionSuffix = feature.iosVersion ? ` (${feature.iosVersion})` : '';
  const refs: Array<{ label: string; url: string }> = [];
  if (feature.prd) refs.push({ label: 'PRD',   url: feature.prd });
  if (libraUrl)    refs.push({ label: 'Libra', url: libraUrl });

  // Always prefix the feature name with [IM] (the team's product
  // line tag), even when the name already starts with another
  // bracketed tag like [Half-Day PRD].
  const headlineName = `[IM] ${feature.name}`;

  // Card section: bold lead line, then the structured body.
  const cardContent = [
    `**${headlineName} [📲 AB open]**`,
    `**Background**: ${background}`,
    `**A/B Setup${versionSuffix}**: ${abSetup}`,
    refs.length > 0
      ? `**Reference**: ${refs.map(r => `[${r.label}](${r.url})`).join(' | ')}`
      : '',
  ].filter(Boolean).join('\n');

  // Post (rich text) variant — sent by the Send button. No title; the
  // bolded lead paragraph IS the visual title.
  const postTitle = '';
  const postParagraphs: PostParagraph[] = [
    [{ tag: 'text', text: `${headlineName} [📲 AB open]`, style: ['bold'] }],
    [
      { tag: 'text', text: 'Background: ', style: ['bold'] },
      { tag: 'text', text: background },
    ],
    [
      { tag: 'text', text: `A/B Setup${versionSuffix}: `, style: ['bold'] },
      { tag: 'text', text: abSetup },
    ],
  ];
  if (refs.length > 0) {
    const inlines: Array<{ tag: 'text'; text: string; style?: string[] } | { tag: 'a'; text: string; href: string }> = [
      { tag: 'text', text: 'Reference: ', style: ['bold'] },
    ];
    refs.forEach((r, i) => {
      if (i > 0) inlines.push({ tag: 'text', text: ' | ' });
      inlines.push({ tag: 'a', text: r.label, href: r.url });
    });
    postParagraphs.push(inlines);
  }

  // Pull any images that live under the Background section in the
  // PRD, re-upload them as IM message images, and append each both
  // to the card section AND as a paragraph in the post message.
  // Failures are silent per image rather than failing the whole card.
  const cardImages: Array<{ image_key: string; alt?: string }> = [];
  if (feature.prd) {
    try {
      const imageTokens = await extractSectionImageTokens(feature.prd, [
        'what we are building?',
        'what we are building and why?',
        'what we are building and why',
        'what we are building',
        'what are we building?',
        'what are we building and why?',
        'what are we building and why',
        'what are we building',
      ]);
      if (imageTokens.length > 0) {
        console.log(`[digests] AB-open: found ${imageTokens.length} image(s) in Background for "${feature.name}"`);
        const parentDocToken = await resolveDocIdFromUrl(feature.prd);
        const uploaded = await Promise.all(
          imageTokens.map(t => uploadDocImageForMessage(t, parentDocToken, userAccessToken)),
        );
        for (const img of uploaded) {
          if (!img) continue;
          cardImages.push({ image_key: img.image_key });
          postParagraphs.push([
            { tag: 'img', image_key: img.image_key, width: img.width, height: img.height },
          ]);
        }
      }
    } catch (e) {
      console.warn(`[digests] AB-open image extraction failed for "${feature.name}":`, e);
    }
  }

  // @-mention the PM at the very bottom of the post, prefixed with
  // "cc" (no space) so it reads as "cc@Thomas". Sent by the bot but
  // pinging the PM gives the same effect for readers. Sits below the
  // image when there is one.
  postParagraphs.push([
    { tag: 'text', text: 'cc' },
    { tag: 'at', user_id: AB_OPEN_MENTION_OPEN_ID },
  ]);

  return { cardContent, cardImages, postTitle, postParagraphs };
}

// Shared list of PRD heading aliases for the "What we are building"
// section, reused by both AB-open and AB-concluded card builders.
const BACKGROUND_ALIASES = [
  'what we are building?',
  'what we are building and why?',
  'what we are building and why',
  'what we are building',
  'what are we building?',
  'what are we building and why?',
  'what are we building and why',
  'what are we building',
];

/**
 * Read the feature's AB report and run it through Gemini using the
 * 'hamlet.ab_results_summary' prompt. Returns 2-3 bullet lines or a
 * placeholder if anything fails (no AB report URL, can't read the
 * doc, no Gemini key, etc.). The bullets are emitted as plain text;
 * the card / post renderer wraps them as separate paragraphs.
 */
async function summariseAbReport(
  featureName: string,
  abReportUrl: string,
  userAccessToken?: string,
): Promise<string> {
  if (!abReportUrl) return '_(AB report URL not available — fill in)_';
  let content = '';
  try {
    content = await readDocContent(abReportUrl);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Bot doesn't have read access. Retry the same fetch but using
    // the PM's user token, which already has full Drive scope on the
    // PM's docs. We keep the request to read-only — no permission
    // grants on the bot identity.
    if ((msg.includes('1770032') || /forbidden/i.test(msg)) && userAccessToken) {
      try {
        content = await readDocContentWithToken(abReportUrl, userAccessToken);
      } catch (e2) {
        console.warn(`[digests] AB-concluded: user-token read failed for "${featureName}":`, e2);
      }
    }
    if (!content) {
      console.warn(`[digests] AB-concluded: read AB report failed for "${featureName}":`, e);
      return '_(Could not read AB report — fill in)_';
    }
  }
  if (!content) return '_(AB report is empty — fill in)_';

  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) return '_(Gemini not configured — fill in)_';
  const { getPrompt: getPromptFn, getPromptModel: getModelFn } = await import('./prompts');
  const { renderPrompt: renderFn, getPromptDef: getDefFn } = await import('./prompt-registry');
  const def = getDefFn('hamlet.ab_results_summary');
  const tmpl = await getPromptFn('hamlet.ab_results_summary', def?.default ?? '');
  const modelName = await getModelFn('hamlet.ab_results_summary', def?.model ?? 'gemini-2.5-flash-lite');
  // Cap report content so we don't blow Gemini's input budget on
  // very long reports — first 30k chars typically covers the
  // headline tables + key metrics section.
  const truncated = content.length > 30_000 ? content.slice(0, 30_000) + '\n…[truncated]' : content;
  const prompt = renderFn(tmpl, { featureName, abReportContent: truncated });
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: modelName });
    const result = await model.generateContent(prompt);
    const raw = result.response.text().trim();
    return raw || '_(Gemini returned empty — fill in)_';
  } catch (e) {
    console.warn(`[digests] AB-concluded: Gemini summary failed for "${featureName}":`, e);
    return '_(Gemini summary failed — fill in)_';
  }
}

/**
 * Read the feature's AB report and ask Gemini to return the first bullet
 * from the "Next Steps" section, verbatim. Returns '' on any failure or
 * when the section / bullets are missing — caller decides whether to
 * skip or show a placeholder.
 */
async function getFirstNextStep(
  featureName: string,
  abReportUrl: string,
  userAccessToken?: string,
): Promise<string> {
  if (!abReportUrl) return '';
  let content = '';
  try {
    content = await readDocContent(abReportUrl);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if ((msg.includes('1770032') || /forbidden/i.test(msg)) && userAccessToken) {
      try {
        content = await readDocContentWithToken(abReportUrl, userAccessToken);
      } catch (e2) {
        console.warn(`[digests] AB-concluded: next-step user-token read failed for "${featureName}":`, e2);
      }
    }
    if (!content) {
      console.warn(`[digests] AB-concluded: next-step AB report read failed for "${featureName}":`, e);
      return '';
    }
  }
  if (!content) return '';
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) return '';
  const { getPrompt: getPromptFn, getPromptModel: getModelFn } = await import('./prompts');
  const { renderPrompt: renderFn, getPromptDef: getDefFn } = await import('./prompt-registry');
  const def = getDefFn('hamlet.first_next_step');
  const tmpl = await getPromptFn('hamlet.first_next_step', def?.default ?? '');
  const modelName = await getModelFn('hamlet.first_next_step', def?.model ?? 'gemini-2.5-flash-lite');
  // Next Steps is almost always at the END of an AB report. If we have
  // to truncate, keep the head (for context) + the last 60k (so the end
  // section is preserved). Total cap 100k chars — comfortably under
  // gemini-2.5-flash-lite's 1M-token context.
  let truncated: string;
  if (content.length <= 100_000) {
    truncated = content;
  } else {
    truncated = content.slice(0, 40_000) + '\n…[middle truncated]…\n' + content.slice(-60_000);
  }
  const prompt = renderFn(tmpl, { featureName, abReportContent: truncated });
  console.log(`[digests] AB-concluded: first_next_step "${featureName}" report=${content.length}c, sent=${truncated.length}c, tail=${JSON.stringify(content.slice(-400))}`);
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: modelName });
    const result = await model.generateContent(prompt);
    const raw = result.response.text().trim();
    console.log(`[digests] AB-concluded: first_next_step for "${featureName}": ${JSON.stringify(raw).slice(0, 300)}`);
    if (!raw || raw === '(none)') return '';
    return raw;
  } catch (e) {
    console.warn(`[digests] AB-concluded: Gemini next-step extraction failed for "${featureName}":`, e);
    return '';
  }
}

/**
 * Build the per-feature card section + Send-button payload for one
 * AB-concluded transition. Mirrors buildAbOpenSection but swaps:
 *   - Title tag: [✅ AB concluded] instead of [📲 AB open]
 *   - "A/B Results" (Gemini summary of AB report) instead of "A/B Setup"
 *   - "Next Steps" line (first bullet of PRD's Next Steps section)
 *   - Reference links: AB Report | Libra (instead of PRD | Libra)
 * Background image (from PRD "What we are building" section) and the
 * trailing cc@Thomas mention are unchanged.
 */
export async function buildAbConcludedSection(
  feature: MeegoFeature,
  abReportUrl: string,
  libraUrl: string,
  userAccessToken?: string,
): Promise<{
  cardContent: string;
  cardImages: Array<{ image_key: string; alt?: string }>;
  postTitle: string;
  postParagraphs: PostParagraph[];
}> {
  let background = '_(Background section not found in PRD — fill in)_';
  if (feature.prd) {
    try {
      const md = await readDocContent(feature.prd);
      const sections = extractDocSections(md, [
        { canonical: 'Background', aliases: BACKGROUND_ALIASES },
      ]);
      if (sections.has('Background')) background = sections.get('Background')!;
    } catch (e) {
      console.warn(`[digests] AB-concluded: PRD section extraction failed for "${feature.name}":`, e);
    }
  }
  const [abResults, nextStep] = await Promise.all([
    summariseAbReport(feature.name, abReportUrl, userAccessToken),
    getFirstNextStep(feature.name, abReportUrl, userAccessToken),
  ]);

  const refs: Array<{ label: string; url: string }> = [];
  if (abReportUrl) refs.push({ label: 'AB Report', url: abReportUrl });
  if (libraUrl)    refs.push({ label: 'Libra',     url: libraUrl });
  const headlineName = `[IM] ${feature.name}`;

  // Card section: bold lead line, then the structured body. The
  // multi-line abResults (each line a bullet) is embedded directly
  // into the lark_md content — Lark renders \n as a soft break.
  const cardContent = [
    `**${headlineName} [✅ AB concluded]**`,
    `**Background**: ${background}`,
    `**A/B Results**:`,
    abResults,
    nextStep ? `**Next Steps**:\n- ${nextStep}` : '',
    refs.length > 0
      ? `**Reference**: ${refs.map(r => `[${r.label}](${r.url})`).join(' | ')}`
      : '',
  ].filter(Boolean).join('\n');

  // Post (rich text). Each AB-results bullet is its own paragraph
  // so the rich-text rendering preserves the bullet shape.
  const postTitle = '';
  const postParagraphs: PostParagraph[] = [
    [{ tag: 'text', text: `${headlineName} [✅ AB concluded]`, style: ['bold'] }],
    [
      { tag: 'text', text: 'Background: ', style: ['bold'] },
      { tag: 'text', text: background },
    ],
    [{ tag: 'text', text: 'A/B Results:', style: ['bold'] }],
  ];
  for (const line of abResults.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    postParagraphs.push([{ tag: 'text', text: trimmed }]);
  }
  if (nextStep) {
    postParagraphs.push([{ tag: 'text', text: 'Next Steps:', style: ['bold'] }]);
    postParagraphs.push([{ tag: 'text', text: `- ${nextStep}` }]);
  }
  if (refs.length > 0) {
    const inlines: Array<{ tag: 'text'; text: string; style?: string[] } | { tag: 'a'; text: string; href: string }> = [
      { tag: 'text', text: 'Reference: ', style: ['bold'] },
    ];
    refs.forEach((r, i) => {
      if (i > 0) inlines.push({ tag: 'text', text: ' | ' });
      inlines.push({ tag: 'a', text: r.label, href: r.url });
    });
    postParagraphs.push(inlines);
  }

  // Same Background images as AB-open: lifted from the PRD's "What we
  // are building" section, re-uploaded for use in IM.
  const cardImages: Array<{ image_key: string; alt?: string }> = [];
  if (feature.prd) {
    try {
      const imageTokens = await extractSectionImageTokens(feature.prd, BACKGROUND_ALIASES);
      if (imageTokens.length > 0) {
        const parentDocToken = await resolveDocIdFromUrl(feature.prd);
        const uploaded = await Promise.all(
          imageTokens.map(t => uploadDocImageForMessage(t, parentDocToken, userAccessToken)),
        );
        for (const img of uploaded) {
          if (!img) continue;
          cardImages.push({ image_key: img.image_key });
          postParagraphs.push([
            { tag: 'img', image_key: img.image_key, width: img.width, height: img.height },
          ]);
        }
      }
    } catch (e) {
      console.warn(`[digests] AB-concluded image extraction failed for "${feature.name}":`, e);
    }
  }

  // Trailing cc@Thomas mention (matches AB-open).
  postParagraphs.push([
    { tag: 'text', text: 'cc' },
    { tag: 'at', user_id: AB_OPEN_MENTION_OPEN_ID },
  ]);

  return { cardContent, cardImages, postTitle, postParagraphs };
}

/**
 * Send the AB-concluded digest card aggregating all features whose
 * AB Brief meeting was just scheduled. Mirrors sendAbOpenDigestCard
 * — green header, one section per feature, Send-to-PM-Group button
 * routes through the same card-action handler.
 */
/**
 * Persist a per-card snapshot keyed by message_id so the Edit button
 * can look up the section the user wants to change, and so an editor
 * (Junior) can rebuild + patch the full card after applying the edit.
 *
 * Skips silently on failure — the card itself is already sent and
 * usable; only the Edit affordance is degraded.
 */
async function saveCardEditContext(
  msgId: string,
  args: {
    cardKind: 'ab_open' | 'ab_concluded';
    chatId: string;
    headerText: string;
    headerTemplate: 'green' | 'yellow';
    built: Array<PromiseSettledResult<{
      cardContent: string;
      cardImages: Array<{ image_key: string; alt?: string }>;
      postTitle: string;
      postParagraphs: PostParagraph[];
    }>>;
    features: Array<{ feature: MeegoFeature; libraUrl: string; abReportUrl?: string }>;
  },
): Promise<void> {
  try {
    const featureSnapshots = args.built
      .map((b, i) => ({ b, src: args.features[i] }))
      .filter(({ b }) => b.status === 'fulfilled')
      .map(({ b, src }) => {
        const v = (b as PromiseFulfilledResult<{
          cardContent: string;
          cardImages: Array<{ image_key: string; alt?: string }>;
          postTitle: string;
          postParagraphs: PostParagraph[];
        }>).value;
        return {
          workItemId: src.feature.workItemId,
          featureName: src.feature.name,
          cardContent: v.cardContent,
          cardImages: v.cardImages,
          postTitle: v.postTitle,
          postParagraphsJson: JSON.stringify(v.postParagraphs),
          libraUrl: src.libraUrl,
          abReportUrl: src.abReportUrl,
        };
      });
    const state = await loadDigestState();
    if (!state.cardEditContexts) state.cardEditContexts = {};
    state.cardEditContexts[msgId] = {
      cardKind: args.cardKind,
      chatId: args.chatId,
      headerText: args.headerText,
      headerTemplate: args.headerTemplate,
      features: featureSnapshots,
      createdAt: new Date().toISOString(),
    };
    // Light pruning: drop entries older than 30 days to keep the
    // state object bounded.
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    for (const [id, ctx] of Object.entries(state.cardEditContexts)) {
      if (new Date(ctx.createdAt).getTime() < cutoff) delete state.cardEditContexts[id];
    }
    await saveDigestState(state);
  } catch (e) {
    console.warn(`[digests] saveCardEditContext failed for ${msgId}:`, e);
  }
}

export async function sendAbConcludedDigestCard(
  features: Array<{ feature: MeegoFeature; abReportUrl: string; libraUrl: string }>,
): Promise<void> {
  if (features.length === 0) return;
  const token = await getLarkBotToken();
  if (!token) {
    console.warn('[digests] no bot token; skipping AB-concluded digest card');
    return;
  }
  let userAccessToken: string | undefined;
  try {
    const state = await loadDigestState();
    const userRefreshToken = state.larkUserRefreshToken || process.env.LARK_USER_REFRESH_TOKEN;
    if (userRefreshToken) {
      const result = await refreshUserToken(userRefreshToken);
      if (result) {
        userAccessToken = result.accessToken;
        state.larkUserRefreshToken = result.refreshToken;
        await saveDigestState(state);
      }
    }
  } catch (e) {
    console.warn('[digests] AB-concluded: user token refresh failed:', e);
  }
  const built: Array<PromiseSettledResult<{ cardContent: string; cardImages: Array<{ image_key: string; alt?: string }>; postTitle: string; postParagraphs: PostParagraph[] }>> = [];
  for (const { feature, abReportUrl, libraUrl } of features) {
    try {
      const value = await buildAbConcludedSection(feature, abReportUrl, libraUrl, userAccessToken);
      built.push({ status: 'fulfilled', value });
    } catch (e) {
      built.push({ status: 'rejected', reason: e });
    }
  }
  const sections: CardSection[] = [];
  for (let i = 0; i < built.length; i++) {
    const result = built[i];
    if (result.status !== 'fulfilled') {
      console.warn(`[digests] AB-concluded section build failed for "${features[i].feature.name}":`, result.reason);
      continue;
    }
    const { cardContent, cardImages, postTitle, postParagraphs } = result.value;
    const f = features[i];
    sections.push({
      content: cardContent,
      images: cardImages,
      buttons: [
        {
          text: 'Send to PM Group',
          type: 'primary',
          value: { action: 'send_ab_open_to_pm_group', postTitle, postParagraphs },
        },
        {
          text: 'Edit',
          type: 'default',
          value: {
            action: 'edit_ab_card',
            cardKind: 'ab_concluded',
            featureWorkItemId: f.feature.workItemId,
            featureName: f.feature.name,
          },
        },
      ],
    });
  }
  if (sections.length === 0) return;
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'Asia/Singapore',
  });
  const headerText = `✅ AB Concluded — ${today}`;
  const id = await sendInteractiveCardToChat(AB_OPEN_PERSONAL_CHAT_ID, headerText, 'green', sections, token);
  console.log(`[digests] AB-concluded digest card sent (${sections.length} feature${sections.length === 1 ? '' : 's'}): message_id=${id ?? 'null'}`);
  // Snapshot per-feature state so the Edit button can later locate
  // the section, edit it, and patch the card back into Lark.
  if (id) {
    await saveCardEditContext(id, {
      cardKind: 'ab_concluded',
      chatId: AB_OPEN_PERSONAL_CHAT_ID,
      headerText,
      headerTemplate: 'green',
      built,
      features,
    });
  }
}

/**
 * Send the daily AB-open digest card aggregating ALL features that
 * transitioned into 实验中 in this digest run. One card with a yellow
 * header dated today; one section per feature with its own Send button.
 */
export async function sendAbOpenDigestCard(
  features: Array<{ feature: MeegoFeature; libraUrl: string }>,
): Promise<void> {
  if (features.length === 0) return;
  const token = await getLarkBotToken();
  if (!token) {
    console.warn('[digests] no bot token; skipping AB Testing digest card');
    return;
  }
  // Resolve the PM's user-access token once — needed so PRD image
  // downloads succeed (the bot lacks docs:document.media:download).
  let userAccessToken: string | undefined;
  try {
    const state = await loadDigestState();
    const userRefreshToken = state.larkUserRefreshToken || process.env.LARK_USER_REFRESH_TOKEN;
    if (userRefreshToken) {
      const result = await refreshUserToken(userRefreshToken);
      if (result) {
        userAccessToken = result.accessToken;
        // Persist the rotated refresh token so the next run can chain.
        state.larkUserRefreshToken = result.refreshToken;
        await saveDigestState(state);
      }
    }
  } catch (e) {
    console.warn('[digests] AB-open: user token refresh failed (image download may fail):', e);
  }
  // Build sections sequentially (rather than via Promise.all) so we
  // don't fan out N concurrent PRD reads — each PRD already paginates
  // through 1-2 get_blocks calls and Lark throttles aggressively on
  // 99991400 when many features parse at once.
  const built: Array<PromiseSettledResult<{ cardContent: string; cardImages: Array<{ image_key: string; alt?: string }>; postTitle: string; postParagraphs: PostParagraph[] }>> = [];
  for (const { feature, libraUrl } of features) {
    try {
      const value = await buildAbOpenSection(feature, libraUrl, userAccessToken);
      built.push({ status: 'fulfilled', value });
    } catch (e) {
      built.push({ status: 'rejected', reason: e });
    }
  }
  const sections: CardSection[] = [];
  for (let i = 0; i < built.length; i++) {
    const result = built[i];
    if (result.status !== 'fulfilled') {
      console.warn(`[digests] AB-open section build failed for "${features[i].feature.name}":`, result.reason);
      continue;
    }
    const { cardContent, cardImages, postTitle, postParagraphs } = result.value;
    const f = features[i];
    sections.push({
      content: cardContent,
      images: cardImages,
      buttons: [
        {
          text: 'Send to PM Group',
          type: 'primary',
          value: { action: 'send_ab_open_to_pm_group', postTitle, postParagraphs },
        },
        {
          text: 'Edit',
          type: 'default',
          value: {
            action: 'edit_ab_card',
            cardKind: 'ab_open',
            featureWorkItemId: f.feature.workItemId,
            featureName: f.feature.name,
          },
        },
      ],
    });
  }
  if (sections.length === 0) return;
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'Asia/Singapore',
  });
  const headerText = `📲 Features in AB Testing — ${today}`;
  const id = await sendInteractiveCardToChat(AB_OPEN_PERSONAL_CHAT_ID, headerText, 'yellow', sections, token);
  console.log(`[digests] AB-open digest card sent (${sections.length} feature${sections.length === 1 ? '' : 's'}): message_id=${id ?? 'null'}`);
  if (id) {
    await saveCardEditContext(id, {
      cardKind: 'ab_open',
      chatId: AB_OPEN_PERSONAL_CHAT_ID,
      headerText,
      headerTemplate: 'yellow',
      built,
      // ab-open features lack abReportUrl; abReportUrl is undefined on save
      features: features.map(f => ({ feature: f.feature, libraUrl: f.libraUrl, abReportUrl: undefined as string | undefined })),
    });
  }
}

// ─── Main orchestrator ─────────────────────────────────────────────────────

export async function runDailyDigests(opts: DigestRunOptions = {}): Promise<DigestRunResult> {
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
  // Search for a known Libra URL across every MCP response for feature 6740389019.
  // Known URL: https://libra-sg.tiktok-row.net/libra/flight/71926724/report/main
  try {
    const probeUrl = `https://meego.larkoffice.com/${TIKTOK_PROJECT_KEY}/story/detail/6740389019`;
    const NEEDLE = 'libra';
    const tools: Array<{ name: string; args: Record<string, unknown> }> = [
      { name: 'get_workitem_brief', args: { url: probeUrl } },
      { name: 'get_node_detail', args: { url: probeUrl } },
      { name: 'get_workitem_op_record', args: { url: probeUrl } },
      { name: 'list_workitem_comments', args: { url: probeUrl } },
      { name: 'list_deliverables', args: { url: probeUrl } },
    ];
    for (const tool of tools) {
      try {
        const raw = await callMeegoMcp(tool.name, tool.args);
        if (raw.toLowerCase().includes(NEEDLE)) {
          const idx = raw.toLowerCase().indexOf(NEEDLE);
          console.log(`[digests] Libra probe FOUND in ${tool.name} at idx=${idx}: ...${raw.slice(Math.max(0, idx - 100), idx + 200)}...`);
        } else {
          console.log(`[digests] Libra probe: NOT in ${tool.name} (${raw.length} chars)`);
        }
      } catch (e) {
        console.warn(`[digests] Libra probe ${tool.name} failed:`, e);
      }
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

  // Step 2b: Update the GCS feature cache with fresh status/name/priority
  // from each brief, AND detect status transitions that need notifications.
  // Currently notifies when a feature enters 待线内评审 (Line Review) or
  // 实验中 (AB Testing).
  const LINE_REVIEW_STATUS = '待线内评审';
  const AB_TESTING_STATUS = '实验中';
  // Mutable across the loop so the changed flag controls whether we
  // re-save state at the end. Loaded once from GCS digest state.
  const abOpenNotified = new Set<string>(state.abOpenNotified ?? []);
  const lineReviewNotified = new Set<string>(state.lineReviewNotified ?? []);
  let notifiedSetChanged = false;
  // Features transitioning into AB Testing this run; sent as one
  // aggregate card at the end of Step 2b.
  const abOpenTransitions: Array<{ feature: MeegoFeature; libraUrl: string }> = [];
  try {
    const prevCache = await readFeatureCache();
    const prevStatusMap = new Map<string, string>();
    if (prevCache) {
      for (const f of prevCache.features) {
        if (f.meegoIssueId || f.id) prevStatusMap.set(f.meegoIssueId ?? f.id, f.status);
      }
    }

    // Detect transitions to Line Review and send notification cards.
    // Hard guardrails — this card may trigger compliance review downstream,
    // so we err on the side of *missing* a card vs. sending one wrongly:
    //   1. Meego's *current* overall status must be 待线内评审 (Line Review).
    //   2. The cached previous status must be 'PRD/Design Prep' — the ONLY
    //      legitimate forward predecessor. Anything else (Development, Done,
    //      AB Testing, …) means we either backfilled wrong or the feature
    //      is moving backwards, neither of which should fire compliance.
    //   3. We must not have already sent the card for this workItemId
    //      (lineReviewNotified set, persisted across runs).
    for (const f of features) {
      const prevStatus = prevStatusMap.get(f.workItemId);
      const isLineReviewNow = f.overallStatusName === LINE_REVIEW_STATUS;
      const isForwardTransition = prevStatus === 'PRD/Design Prep';
      const alreadyNotified = lineReviewNotified.has(f.workItemId);
      if (isLineReviewNow && isForwardTransition && !alreadyNotified) {
        if (opts.mode === 'refresh') {
          // Refresh mode: queue for the digest-line-review cron to consume.
          if (!shouldQueueSection(state, 'digest.line_review')) {
            console.log(`[digests] Line Review queue skipped (paused): "${f.name}"`);
            continue;
          }
          console.log(`[digests] PRD Ready queued → "${f.name}" (PRD/Design Prep → Line Review)`);
          lineReviewNotified.add(f.workItemId);
          notifiedSetChanged = true;
          state.pendingLineReviewCards = [
            ...(state.pendingLineReviewCards ?? []),
            {
              workItemId: f.workItemId,
              name: f.name,
              meegoUrl: f.meegoUrl,
              prdUrl: f.prd,
              priority: f.priority ?? 'P1',
              queuedAtIso: new Date().toISOString(),
            },
          ];
          continue;
        }
        if (!shouldSendSection(state, opts, 'digest.line_review')) {
          console.log(`[digests] Line Review card skipped (paused or section-filtered): "${f.name}"`);
          continue;
        }
        console.log(`[digests] PRD Ready card → "${f.name}" (PRD/Design Prep → Line Review)`);
        lineReviewNotified.add(f.workItemId);
        notifiedSetChanged = true;
        sendFeatureCard({
          name: f.name,
          meegoUrl: f.meegoUrl,
          prdUrl: f.prd,
          priority: f.priority ?? 'P1',
          headerTitle: 'PRD Ready ✅',
          headerTemplate: 'green',
        }).catch(e => console.warn(`[digests] Line Review card send failed for "${f.name}":`, e));
      } else if (f.overallStatusName === LINE_REVIEW_STATUS && !alreadyNotified) {
        // Skipped: log why so we can audit cases where prevStatus wasn't
        // PRD/Design Prep (likely the source of the recent over-firing).
        console.log(`[digests] PRD Ready card SKIPPED for "${f.name}" — prevStatus=${prevStatus ?? '∅'} (only fires from PRD/Design Prep)`);
      }
      // Notify on AB Testing. Fires once per feature ever — covers both
      // (a) the initial backfill of features already in 实验中 when this
      // shipped, and (b) future fresh transitions into 实验中. Tracked
      // by Meego workItemId in DigestState.abOpenNotified. Cards are
      // collected and sent as ONE aggregate digest at the end of the
      // loop (similar to the PRD-changes digest).
      if (f.overallStatusName === AB_TESTING_STATUS) {
        const alreadyNotified = abOpenNotified.has(f.workItemId);
        if (!alreadyNotified) {
          const reason = (prevStatus && prevStatus !== 'AB Testing' && prevStatus !== AB_TESTING_STATUS)
            ? `transition from ${prevStatus}`
            : 'backfill (already in AB Testing)';
          console.log(`[digests] AB-open queue "${f.name}" — ${reason}`);
          const libraUrl = prevCache?.features.find(c => (c.meegoIssueId ?? c.id) === f.workItemId)?.libraUrl ?? '';
          abOpenNotified.add(f.workItemId);
          notifiedSetChanged = true;
          abOpenTransitions.push({ feature: f, libraUrl });
        }
      }
    }
    // Send the aggregated AB-open card after the loop. Fire-and-forget
    // (with .catch) because a slow PRD parse shouldn't block the rest
    // of the digest pipeline.
    if (opts.mode === 'refresh') {
      // Refresh mode: queue each transition for the digest-ab-open cron.
      if (abOpenTransitions.length > 0 && shouldQueueSection(state, 'digest.ab_open')) {
        const now = new Date().toISOString();
        state.pendingAbOpenCards = [
          ...(state.pendingAbOpenCards ?? []),
          ...abOpenTransitions.map(t => ({
            workItemId: t.feature.workItemId,
            libraUrl: t.libraUrl,
            queuedAtIso: now,
          })),
        ];
        console.log(`[digests] AB-open queued ${abOpenTransitions.length} transitions`);
      } else if (abOpenTransitions.length > 0) {
        console.log('[digests] AB-open queue skipped (paused)');
      }
    } else if (abOpenTransitions.length > 0 && shouldSendSection(state, opts, 'digest.ab_open')) {
      sendAbOpenDigestCard(abOpenTransitions)
        .catch(e => console.warn('[digests] AB-open digest card send failed:', e));
    } else if (abOpenTransitions.length > 0) {
      console.log('[digests] AB-open digest skipped (paused or section-filtered)');
    }

    // MERGE into the existing GCS cache — update features the digest knows
    // about, add new ones, but NEVER remove features. Only Sync All (the UI's
    // GET /api/meego/features?force=1) is allowed to remove features, because
    // the digest and UI discover different feature sets (digest uses Junior
    // chats + watchlist, UI uses fetchUserStories). Replacing the cache here
    // would drop features the digest doesn't discover and re-add ones the UI
    // already removed.
    const existingFeatures = prevCache?.features ?? [];
    const existingById = new Map(existingFeatures.map(f => [f.meegoIssueId ?? f.id, f]));

    // Update/add features from the digest's discovery set.
    for (const f of features) {
      const prev = existingById.get(f.workItemId);
      existingById.set(f.workItemId, {
        ...(prev ?? {}),
        id: f.workItemId,
        meegoIssueId: f.workItemId,
        name: f.name,
        description: prev?.description ?? '',
        // Translate Chinese overall status to the English display label so the
        // UI shows e.g. "Done" instead of "已完成" on refresh.
        status: resolveDisplayStatus(f.overallStatusName),
        priority: (f.priority ?? prev?.priority ?? 'P1') as import('./types').Priority,
        owner: (f.roles['PM'] ?? [])[0] ?? prev?.owner ?? '',
        tasks: prev?.tasks ?? ([] as import('./types').Task[]),
        lastUpdated: f.lastUpdatedIso ?? prev?.lastUpdated ?? '',
        meegoUrl: f.meegoUrl,
        meegoProjectKey: TIKTOK_PROJECT_KEY,
        prd: f.prd ?? prev?.prd,
        iosVersion: f.iosVersion ?? prev?.iosVersion,
        versionHistory: trackVersionHistory(prev?.versionHistory, f.iosVersion),
      } as import('./types').Feature);
    }

    const mergedFeatures = [...existingById.values()];
    await writeFeatureCache(mergedFeatures);
    console.log(`[digests] GCS feature cache merged: ${features.length} from digest, ${mergedFeatures.length} total (${mergedFeatures.length - features.length} preserved from UI)`);
  } catch (e) {
    console.warn('[digests] feature cache update / transition detection failed:', e);
  }

  // Helpers shared by Step 2c (PRD updates) and Step 6b (risk transitions)
  // for appending to per-feature history arrays in the cache. Caps each
  // history at the last 20 entries so the cache stays compact.
  function appendCappedHistory<T>(prev: T[] | undefined, entry: T, max = 20): T[] {
    return [...(prev ?? []).slice(-(max - 1)), entry];
  }

  // Step 2c: PRD Change Log auto-update — scan each feature's PRD for
  // content changes since the last run. If the text differs, use Gemini
  // to summarize what changed and append it to the Change Log section.
  const PRD_SNAPSHOTS_PATH = 'hamlet/prd-snapshots.json';
  const prdChanges: Array<{
    name: string;
    prdUrl: string;
    meegoUrl: string;
    summary: string;
    chatId?: string;
    workItemId?: string;
    pocEmails?: string[];
  }> = [];
  try {
    const { readDocContent, grantBotEditAccess } = await import('./lark');
    const { readJsonState, writeJsonState } = await import('./gcs-state');
    const snapshots: Record<string, string> = await readJsonState<Record<string, string>>(PRD_SNAPSHOTS_PATH).catch(() => ({})) ?? {};
    // Use Singapore time (SGT = UTC+8) for the change log date
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Singapore' }); // YYYY-MM-DD

    // Get user access token (for granting bot access to PRDs on permission errors)
    let userAccessTokenForPrd: string | undefined;
    try {
      const userRefreshToken = state.larkUserRefreshToken || process.env.LARK_USER_REFRESH_TOKEN;
      if (userRefreshToken) {
        const result = await refreshUserToken(userRefreshToken);
        if (result) {
          userAccessTokenForPrd = result.accessToken;
          state.larkUserRefreshToken = result.refreshToken;
        }
      }
    } catch { /* ignore */ }
    let prdScanned = 0;
    let prdChanged = 0;

    for (const f of features) {
      if (!f.prd || f.overallStatusKey === 'end') continue;
      prdScanned++;
      try {
        const currentText = await readDocContent(f.prd);
        if (!currentText) continue;
        const prevText = snapshots[f.workItemId];

        if (prevText && prevText !== currentText) {
          // PRD content changed — use Gemini to summarize the diff
          prdChanged++;
          let summary = 'PRD content updated';
          try {
            const { getPrompt, getPromptModel } = await import('./prompts');
            const { renderPrompt, getPromptDef } = await import('./prompt-registry');
            const def = getPromptDef('hamlet.prd_change_summary');
            const modelName = await getPromptModel('hamlet.prd_change_summary', def?.model ?? 'gemini-3.1-flash-lite-preview');
            const prdGenAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY ?? '');
            const model = prdGenAI.getGenerativeModel({ model: modelName });
            const tmpl = await getPrompt('hamlet.prd_change_summary', def?.default ?? '');
            const prompt = renderPrompt(tmpl, {
              prevText: prevText.slice(0, 4000),
              currentText: currentText.slice(0, 4000),
            });
            const result = await model.generateContent(prompt);
            summary = result.response.text()?.trim() ?? 'PRD content updated';
            console.log(`[digests] PRD changed for "${f.name}": ${summary}`);
          } catch (e) {
            console.warn(`[digests] Gemini PRD diff failed for "${f.name}":`, e);
          }
          // Skip trivial wording-only edits: don't append to the PRD change
          // log and don't include in the daily digest card. Snapshot still
          // gets updated below so we compare against the latest text next run.
          const normalized = summary.trim().toLowerCase().replace(/[.!]+$/, '');
          if (normalized === 'minor wording edits') {
            console.log(`[digests] PRD change for "${f.name}" is minor wording — skipping log + digest`);
            snapshots[f.workItemId] = currentText;
            continue;
          }
          try {
            await appendPrdChangeLog(f.prd, [{ date: today, detail: summary, by: '@Thomas Jr.' }]);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            // Retry: if forbidden, grant bot access via user token then retry
            if ((msg.includes('forBidden') || msg.includes('1770032') || msg.includes('forbidden')) && userAccessTokenForPrd) {
              console.log(`[digests] PRD forbidden for "${f.name}" — granting bot access via user token`);
              const granted = await grantBotEditAccess(f.prd, userAccessTokenForPrd);
              if (granted) {
                try {
                  await appendPrdChangeLog(f.prd, [{ date: today, detail: summary, by: '@Thomas Jr.' }]);
                  console.log(`[digests] PRD changelog written after access grant for "${f.name}"`);
                } catch (retryErr) {
                  console.warn(`[digests] append PRD changelog retry failed for "${f.name}":`, retryErr);
                }
              }
            } else {
              console.warn(`[digests] append PRD changelog failed for "${f.name}":`, e);
            }
          }
          // Collect POC emails (Tech Owner, Server, Android, iOS, QA, DA), deduped
          const POC_ROLE_KEYS = ['Tech_Owner', 'Server', 'Android', 'iOS', 'QA', 'DA'];
          const pocEmails: string[] = [];
          for (const roleKey of POC_ROLE_KEYS) {
            const members = f.roles[roleKey] ?? [];
            for (const memberName of members) {
              const email = f.roleEmails[memberName];
              if (email && !pocEmails.includes(email)) pocEmails.push(email);
            }
          }

          // Resolve chatId: MeegoFeature → Junior chats cache → GCS feature cache
          let chatId = f.chatId
            || juniorChats.find(jc => jc.meegoId === f.workItemId)?.chatId
            || '';
          if (!chatId) {
            try {
              const featureCache = await readFeatureCache();
              const cached = featureCache?.features.find(
                cf => cf.id === f.workItemId || cf.meegoIssueId === f.workItemId,
              );
              if (cached?.chatId) chatId = cached.chatId;
            } catch { /* ignore */ }
          }
          prdChanges.push({
            name: f.name,
            prdUrl: f.prd,
            meegoUrl: f.meegoUrl,
            summary,
            chatId,
            workItemId: f.workItemId,
            pocEmails,
          });

          // Append the diff summary to feature.prdUpdates in the cache so
          // the FeatureDrawer's Activity feed can show "Junior summarised
          // PRD edits". Best-effort — failures here don't block anything
          // downstream.
          try {
            const cache = await readFeatureCache();
            const cached = cache?.features.find(
              cf => cf.id === f.workItemId || cf.meegoIssueId === f.workItemId,
            );
            if (cached) {
              const next = appendCappedHistory(cached.prdUpdates, { date: today, iso: new Date().toISOString(), summary });
              await patchFeaturesInCache(new Map([[f.workItemId, { prdUpdates: next }]]));
            }
          } catch (e) {
            console.warn(`[digests] prdUpdates append failed for "${f.name}":`, e);
          }
        }

        // Update snapshot (always, even on first run)
        snapshots[f.workItemId] = currentText;
      } catch (e) {
        console.warn(`[digests] PRD scan failed for "${f.name}":`, e);
      }
    }

    await writeJsonState(PRD_SNAPSHOTS_PATH, snapshots);
    console.log(`[digests] PRD scan: ${prdScanned} scanned, ${prdChanged} changed`);
  } catch (e) {
    console.warn('[digests] PRD change log scan failed:', e);
  }

  // Step 2c.5: Send PRD Changes digest NOW — don't wait for Q&A scan which can
  // time out the whole digest run. This ensures the PRD digest is delivered
  // even if later steps fail.
  let prdChangesSentEarly = false;
  if (opts.mode === 'refresh') {
    // Refresh mode: queue for the digest-prd-changes cron to consume.
    if (prdChanges.length > 0 && shouldQueueSection(state, 'digest.prd_changes')) {
      const now = new Date().toISOString();
      state.pendingPrdChanges = [
        ...(state.pendingPrdChanges ?? []),
        ...prdChanges.map(p => ({ ...p, queuedAtIso: now })),
      ];
      console.log(`[digests] PRD changes queued: ${prdChanges.length}`);
    } else if (prdChanges.length > 0) {
      console.log('[digests] PRD changes queue skipped (paused)');
    }
  } else if (prdChanges.length > 0 && !shouldSendSection(state, opts, 'digest.prd_changes')) {
    // We're in full mode but the section is filtered out (e.g. user
    // triggered digest.risk, which re-runs the data scan but should
    // only send the risk card). Don't drop the PRD changes on the
    // floor — queue them so the next digest-prd-changes run sends.
    if (shouldQueueSection(state, 'digest.prd_changes')) {
      const now = new Date().toISOString();
      state.pendingPrdChanges = [
        ...(state.pendingPrdChanges ?? []),
        ...prdChanges.map(p => ({ ...p, queuedAtIso: now })),
      ];
      await saveDigestState(state);
      console.log(`[digests] PRD changes queued (section-filtered): ${prdChanges.length}`);
    } else {
      console.log('[digests] PRD changes digest skipped (paused or section-filtered, queue paused too)');
    }
  } else if (prdChanges.length > 0) {
    const card = buildPrdChangesDigestCard(prdChanges);
    const preview = [card.title, ...card.sections.map(s => s.content)].join('\n---\n');
    console.log('[digests] PRD changes digest:\n' + preview);
    try {
      const juniorToken = await getLarkBotToken();
      const id = await sendInteractiveCardToChat(
        PM_GROUP_CHAT_ID, card.title, card.template, card.sections, juniorToken,
      );
      prdChangesSentEarly = id !== null;
      console.log(`[digests] PRD changes digest sent: ${prdChangesSentEarly}`);
    } catch (e) {
      console.warn('[digests] PRD changes digest send failed:', e);
    }
  } else {
    console.log('[digests] no PRD changes — skipping PRD changes digest');
  }

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
  // The risk digest covers ONLY features whose overall status is Tech
  // Design, Development, or QA Testing — features that have moved on
  // to AB Testing / Done / etc. don't need daily risk follow-up. We
  // match by overall status name (the same value Hamlet's UI shows)
  // rather than by active node IDs, because Meego often leaves QA /
  // UAT / AB nodes simultaneously active for a feature whose overall
  // status has advanced.
  const RISK_DIGEST_STATUSES = new Set(['技术方案设计中', '开发中', '测试中']);
  const inDev = features.filter(f => RISK_DIGEST_STATUSES.has(f.overallStatusName));
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

  // ── Refresh-mode early return ─────────────────────────────────────────────
  // Refresh's job is finished here: we have features with resolved chatIds
  // + deadlines, queues populated by Steps 2b/2c, and notify sets updated.
  // Skip Steps 4-8 (risk eval, link auto-fetch, Q&A scan, AB-concluded scan,
  // version-delay cache patch, sends) — those belong to the per-section crons.
  if (opts.mode === 'refresh') {
    try {
      const { saveFeatureSnapshots } = await import('./feature-snapshots');
      const snapshotMap: Record<string, MeegoFeature> = {};
      for (const f of features) snapshotMap[f.workItemId] = f;
      await saveFeatureSnapshots({
        refreshedAtIso: new Date().toISOString(),
        features: snapshotMap,
        inDevIds: inDev.map(f => f.workItemId),
        juniorChats,
      });
      console.log(`[digests] feature-snapshots.json written: ${features.length} features, ${inDev.length} inDev, ${juniorChats.length} juniorChats`);
    } catch (e) {
      console.warn('[digests] saveFeatureSnapshots failed:', e);
    }
    // Cache writeback for version-slip detection + slip-reason inference.
    // Doesn't depend on Step 4's chat-risk findings, so it's safe to run
    // in refresh mode. The full-mode Step 6b later re-runs version
    // detection idempotently and adds the riskLevel/riskNotes layer.
    if (botToken) {
      try {
        await patchVersionChangesInCache(features, botToken);
      } catch (e) {
        console.warn('[digests] patchVersionChangesInCache (refresh) failed:', e);
      }
    }
    if (notifiedSetChanged) {
      state.abOpenNotified = [...abOpenNotified];
      state.lineReviewNotified = [...lineReviewNotified];
    }
    await saveDigestState(state);
    return {
      featuresChecked: inDev.length,
      riskSent: false,
      unansweredSent: false,
      prdChangesSent: false,
      riskFindings: [],
      unansweredFindings: [],
    };
  }

  // Step 4: Evaluate risk — Meego signals (deadline pressure) plus a
  // persistence-aware qualitative chat risk pass via Gemini 2.5 Flash Lite
  // (last 24h of chat messages, with prior state passed in so quiet days
  // don't drop the risk back to low). Persisted in the GCS digest-state
  // file. (state was already loaded at Step 0 above so we can use the
  // discoveredIdsCache as a discovery fallback.)
  //
  // Delayed-state detection (full version-change history per feature)
  // happens later in Step 6b alongside the feature-cache writeback.

  const nowIso = new Date().toISOString();
  const riskFindings: RiskFinding[] = [];
  for (const feature of inDev) {
    try {
      const finding = await evaluateFeatureRisk(feature);
      // Deadline-pressure reasons (e.g. "QA not started, planned merge date
      // within 5 days") are kept ONLY for level computation. The displayed
      // reason should describe the actual cause from chat / Meego comments,
      // so wipe the array now and re-populate from the Gemini summary
      // below if one is available.
      const deadlineLevel = finding.level;
      finding.reasons = [];
      const prior = state.features[feature.workItemId];

      // ── (a) Qualitative chat risk ──────────────────────────────────────
      if (feature.chatId && botToken) {
        const rawPriorChat = prior?.chatRisk;
        // Hard staleness expiry: a prior raised more than
        // RISK_STALE_PRIOR_DAYS ago is dropped before Gemini even sees
        // it, regardless of any new chat or Meego comments since. The
        // re-evaluation runs as a fresh detection (no prior context),
        // so a previously red/yellow feature reverts to whatever the
        // latest 7d window actually says.
        let priorChat = rawPriorChat;
        let priorExpired = false;
        if (rawPriorChat) {
          const ageMs = Date.now() - Date.parse(rawPriorChat.raisedAtIso);
          const ageDays = Number.isFinite(ageMs) ? ageMs / (24 * 60 * 60 * 1000) : 0;
          if (ageDays >= RISK_STALE_PRIOR_DAYS) {
            console.log(
              `[digests] risk for "${feature.name}" stale (${ageDays.toFixed(1)}d since raised) → clearing prior, re-evaluating fresh`,
            );
            priorChat = undefined;
            priorExpired = true;
          }
        }
        const chatRisk = await evaluateChatRisk(
          feature.chatId,
          feature.name,
          botToken,
          priorChat
            ? {
                level: priorChat.level,
                summary: priorChat.summary,
                raisedAtIso: priorChat.raisedAtIso,
              }
            : undefined,
          feature.meegoUrl,
        );

        // Persist or clear chat risk on the entry. raisedAtIso is the
        // baseline for the 7-day staleness expiry. Carry it forward
        // when the same prior is being confirmed; reset to now when a
        // stale prior was dropped above (priorExpired) so the clock
        // restarts. priorChat is undefined in both the "stale dropped"
        // case and the "no prior" case — the priorExpired flag
        // disambiguates.
        const entry = state.features[feature.workItemId] ?? { name: feature.name, lastSeenIso: nowIso };
        entry.name = feature.name;
        entry.lastSeenIso = nowIso;
        if (chatRisk.level === 'none') {
          delete entry.chatRisk;
        } else {
          entry.chatRisk = {
            level: chatRisk.level,
            summary: chatRisk.summary,
            raisedAtIso: (priorExpired ? nowIso : priorChat?.raisedAtIso) ?? nowIso,
          };
        }
        if (entry.chatRisk) {
          state.features[feature.workItemId] = entry;
        } else {
          delete state.features[feature.workItemId];
        }

        // chatRisk.level can be 'none' which isn't a RiskLevel — coerce
        // to 'green' for the level computation since they're equivalent
        // in this context (both mean "no qualitative risk detected").
        const chatLevelForCompare: RiskLevel = chatRisk.level === 'none' ? 'green' : chatRisk.level;
        finding.level = maxLevel([deadlineLevel, chatLevelForCompare]);
        // Use the Gemini summary as the displayed reason. If the level
        // came from the deadline rule alone (no chat/Meego signal),
        // reasons stays empty — the badge shows the level without a
        // misleading "QA not started…" tag.
        if (chatRisk.summary && finding.level !== 'green') {
          finding.reasons = [chatRisk.summary];
        }
      }

      // Note: Delayed-state detection has moved to Step 6b — it runs
      // alongside the feature-cache writeback so each feature's full
      // version-change history is materialised onto the cached Feature
      // (rather than persisted in DigestState with a TTL).

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

  if (notifiedSetChanged) {
    state.abOpenNotified = [...abOpenNotified];
    state.lineReviewNotified = [...lineReviewNotified];
    console.log(`[digests] notify sets updated — abOpen=${state.abOpenNotified.length}, lineReview=${state.lineReviewNotified.length}`);
  }
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
  // workItemId → finding so chat + PRD-comment results merge into a
  // single section per feature in the card.
  const unansweredByFeature = new Map<string, UnansweredFinding>();
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
        if (finding) {
          // Stamp chatId on the feature so the unanswered card can show
          // an Open Group button and the Let me Reply button payload
          // carries chatId through to Junior. MeegoFeature is built
          // from raw Meego data which doesnt know about Lark chats —
          // chatId only exists in the juniorChats list paired up here.
          finding.feature.chatId = chat.chatId;
          unansweredByFeature.set(feature.workItemId, finding);
        }
      } catch (e) {
        console.warn(`[digests] Q&A scan failed for ${feature.name}:`, e);
      }
    }
    console.log(
      `[digests] Q&A scan: ${scanned} chats scanned (${skippedEnded} ended, ${skippedNoBrief} no brief), ${unansweredByFeature.size} with unanswered questions`,
    );

    // Step 6b: PRD-comment scan. For every cached feature with a PRD
    // URL whose status isn't 'end', look up the doc comment threads
    // and surface any thread the owner hasn't replied to. Merges into
    // the same per-feature finding so the card has one section per
    // feature regardless of whether the questions came from chat or
    // doc comments.
    // Lark's doc-comment API returns open_id values in its (mis-named)
    // user_id field, so we pass the owner's open_id straight through.
    {
      const cache = await readFeatureCache();
      if (cache) {
        let prdScanned = 0;
        let prdWithUnanswered = 0;
        for (const cached of cache.features) {
          const fId = cached.meegoIssueId ?? cached.id;
          const meegoFeature = featureById.get(fId);
          // Skip ended features and ones we don't have a brief for
          // (we can still scan their PRD, but the finding needs a
          // MeegoFeature for the card link metadata).
          if (!meegoFeature) continue;
          if (meegoFeature.overallStatusKey === 'end') continue;
          if (!cached.prd) continue;
          prdScanned++;
          try {
            const commentQs = await collectUnansweredCommentsForFeature(
              meegoFeature, ownerOpenId, sinceMs,
            );
            if (commentQs.length === 0) continue;
            prdWithUnanswered++;
            const existing = unansweredByFeature.get(fId);
            if (existing) {
              existing.questions = [...existing.questions, ...commentQs]
                .sort((a, b) => b.timestamp - a.timestamp)
                .slice(0, MAX_QUESTIONS_PER_FEATURE);
            } else {
              unansweredByFeature.set(fId, { feature: meegoFeature, questions: commentQs });
            }
          } catch (e) {
            console.warn(`[digests] PRD-comment scan failed for "${meegoFeature.name}":`, e);
          }
        }
        console.log(
          `[digests] PRD-comment scan: ${prdScanned} PRDs scanned, ${prdWithUnanswered} with unanswered comments`,
        );
      }
    }
  }
  const unansweredFindings: UnansweredFinding[] = [...unansweredByFeature.values()];

  // Step 6c: AB-concluded scan — for each Junior feature chat, look
  // for a recent calendar invite whose title contains "AB Brief". When
  // we find one, queue the feature for the AB-concluded digest card
  // (Gemini-summarised AB report + Send-to-PM-Group button).
  // Dedup'd by Meego workItemId via `state.abConcludedNotified`.
  if (botToken) {
    const abConcluded = new Set<string>(state.abConcludedNotified ?? []);
    let abConcludedChanged = false;
    const abConcludedTransitions: Array<{ feature: MeegoFeature; abReportUrl: string; libraUrl: string }> = [];
    const briefScanWindowMs = 14 * 24 * 60 * 60 * 1000; // 14 days
    const briefSinceMs = Date.now() - briefScanWindowMs;
    let scanned = 0;
    let matched = 0;
    for (const chat of juniorChats) {
      if (!chat.meegoId || !chat.chatId) continue;
      const feature = featureById.get(chat.meegoId);
      if (!feature) continue;
      if (abConcluded.has(feature.workItemId)) continue;
      scanned++;
      try {
        const msgs = await readChatMessages(chat.chatId, briefSinceMs, botToken);
        const hasBrief = msgs.some(m => {
          const body = m.body?.content ?? '';
          return /ab\s*brief/i.test(body);
        });
        if (!hasBrief) continue;
        matched++;
        abConcluded.add(feature.workItemId);
        abConcludedChanged = true;
        // Prefer the AB Report + Libra URLs from the Hamlet feature
        // cache (the source of truth shown in the UI). Fall back to
        // the digest's link cache only when the Hamlet cache is
        // missing the field.
        const cachedFeature = (await readFeatureCache())?.features.find(c => (c.meegoIssueId ?? c.id) === feature.workItemId);
        const linksCache = state.featureLinks?.[feature.workItemId];
        const abReportUrl = cachedFeature?.abReportUrl || linksCache?.abReportUrl || '';
        const libraUrl = cachedFeature?.libraUrl ?? '';
        abConcludedTransitions.push({ feature, abReportUrl, libraUrl });
        console.log(`[digests] AB-concluded queue "${feature.name}" — AB Brief invite detected`);
      } catch (e) {
        console.warn(`[digests] AB-concluded scan failed for ${feature.name}:`, e);
      }
    }
    console.log(`[digests] AB-concluded scan: ${scanned} chats scanned, ${matched} matched`);
    if (abConcludedChanged) state.abConcludedNotified = [...abConcluded];
    if (abConcludedTransitions.length > 0 && shouldSendSection(state, opts, 'digest.ab_concluded')) {
      sendAbConcludedDigestCard(abConcludedTransitions)
        .catch(e => console.warn('[digests] AB-concluded digest card send failed:', e));
    } else if (abConcludedTransitions.length > 0) {
      console.log('[digests] AB-concluded digest skipped (paused or section-filtered)');
    }
  }

  // Step 6b: Compute risk + versionChanges deltas per cached feature and
  // apply them via an optimistic-concurrency patch. The cache is also
  // written by per-card sync calls (`updateFeatureInCache`); using a
  // patch + GCS generation preconditions prevents either side from
  // silently overwriting the other.
  try {
    const featureCache = await readFeatureCache();
    if (featureCache) {
      const riskByWorkItemId = new Map(riskFindings.map(r => [r.feature.workItemId, r]));
      const featureByWorkItemId = new Map(features.map(f => [f.workItemId, f]));
      const deltas = new Map<string, Partial<import('./types').Feature>>();
      const todayDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
      // When delta.riskLevel was explicitly set (one of the 3 patch
      // branches below), append a riskHistory entry if the level changed
      // from the cached previous value. The 4th branch (preserve previous
      // risk) intentionally doesn't call this — undefined means "keep".
      function trackRiskTransition(
        delta: Partial<import('./types').Feature>,
        cached: import('./types').Feature,
      ) {
        const prev = cached.riskLevel ?? 'none';
        const next = delta.riskLevel ?? 'none';
        if (prev === next) return;
        delta.riskHistory = appendCappedHistory(cached.riskHistory, {
          date: todayDate,
          iso:  new Date().toISOString(),
          from: prev as 'red' | 'yellow' | 'green' | 'none',
          to:   next as 'red' | 'yellow' | 'green' | 'none',
        });
      }
      let versionScanned = 0;
      let versionDelayed = 0;
      for (const cached of featureCache.features) {
        const fId = cached.meegoIssueId ?? cached.id;
        const finding = riskByWorkItemId.get(fId);
        const meegoFeature = featureByWorkItemId.get(fId);
        const statusName = meegoFeature?.overallStatusName ?? '';
        const statusKey = meegoFeature?.overallStatusKey;
        const meegoUrl = meegoFeature?.meegoUrl ?? cached.meegoUrl;

        // Skip terminal-state features BEFORE running any per-feature
        // Meego calls — these don't need risk evaluation OR delay
        // detection (the RiskBadge UI hides for Done features anyway).
        // Skipping them keeps Step 6b within the route's maxDuration
        // when the cache holds 100+ features.
        if (statusKey === 'end' || cached.status === 'Done' || cached.status === '已完成') {
          deltas.set(fId, { riskLevel: undefined, riskNotes: undefined });
          continue;
        }

        // Run all the version / launch-date delay scans for non-Done
        // features — including AB Testing, since AB Testing only
        // suppresses the riskLevel badge, not the Delayed badge.
        let nextVersionChanges = cached.versionChanges;
        let versionChangesChanged = false;
        if (meegoUrl) {
          // (i) Op-log scan: planned-version field changes over time.
          try {
            const existing = cached.versionChanges ?? [];
            const sinceMs = existing.length > 0
              ? Date.parse(existing[existing.length - 1].date + 'T00:00:00+08:00') || 0
              : 0;
            const fresh = await getAllVersionChanges(meegoUrl, sinceMs);
            if (fresh.length > 0) {
              const seen = new Set(existing.map(c => `${c.date}|${c.from}|${c.to}`));
              const merged = [...existing];
              for (const c of fresh) {
                const k = `${c.date}|${c.from}|${c.to}`;
                if (!seen.has(k)) { merged.push(c); seen.add(k); }
              }
              merged.sort((a, b) => a.date.localeCompare(b.date));
              nextVersionChanges = merged;
              versionChangesChanged = true;
            }
            versionScanned++;
          } catch (e) {
            console.warn(`[digests] version-change scan failed for ${cached.name}:`, e);
          }

          // (ii) Snapshot scan: actual launched > planned on either
          // platform — catches slips where the planned field never
          // moved in the op log. On first detection of a (planned →
          // actual) pair, look up the date the launched-version field
          // was last edited (the slip date) and cache the entry; on
          // subsequent runs we recognise the same pair and skip the
          // expensive date lookup.
          try {
            const mismatch = await detectVersionMismatch(meegoUrl);
            if (mismatch) {
              const list = nextVersionChanges ?? [];
              const matchesPair = (c: { from: string; to: string }) =>
                c.from === mismatch.planned && c.to === mismatch.actual;
              const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
              const matchingEntries = list.filter(matchesPair);
              // Treat the cache as already-resolved only when there's
              // exactly one matching entry AND its date isn't today
              // (today-stamped entries are probably leftovers from the
              // older synthesis path that didn't look up the op log).
              // Multiple matching entries means earlier runs duplicated
              // the pair across days — also a sign to refresh.
              const alreadyCached = matchingEntries.length === 1 && matchingEntries[0].date !== today;
              if (!alreadyCached) {
                const launchedFieldKey = mismatch.platform === 'ios'
                  ? 'ios_actual_online_version'
                  : 'android_actual_online_version';
                let date: string | null = null;
                try {
                  date = await findLatestFieldEditDate(meegoUrl, launchedFieldKey);
                } catch (e) {
                  console.warn(`[digests] launched-field date lookup failed for ${cached.name}:`, e);
                }
                if (!date) {
                  date = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
                }
                // Drop any older entry for the same pair that might have
                // a stale date (e.g. previously written as "today" before
                // the op-log lookup was wired in).
                const cleaned = list.filter(c => !matchesPair(c));
                nextVersionChanges = [...cleaned, { date, iso: new Date().toISOString(), from: mismatch.planned, to: mismatch.actual }]
                  .sort((a, b) => a.date.localeCompare(b.date));
                versionChangesChanged = true;
              }
            }
          } catch (e) {
            console.warn(`[digests] version-mismatch check failed for ${cached.name}:`, e);
          }

          // (iii) Server-launch slip: Server上线 node scheduled later
          // than the field_cde888 "Server 计划上线时间" planned date.
          // Like the version mismatch path, dedupe by (from, to) and
          // refresh today-stamped or duplicated entries with the
          // op-log date for the most recent edit to either side.
          try {
            const serverDelay = await detectServerLaunchDelay(meegoUrl);
            if (serverDelay) {
              const list = nextVersionChanges ?? [];
              const matchesPair = (c: { from: string; to: string }) =>
                c.from === serverDelay.planned && c.to === serverDelay.scheduled;
              const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
              const matchingEntries = list.filter(matchesPair);
              const alreadyCached = matchingEntries.length === 1 && matchingEntries[0].date !== today;
              if (!alreadyCached) {
                let date: string | null = null;
                try {
                  date = await findLatestFieldEditDate(meegoUrl, 'field_cde888');
                } catch (e) {
                  console.warn(`[digests] server-launch date lookup failed for ${cached.name}:`, e);
                }
                if (!date) date = today;
                const cleaned = list.filter(c => !matchesPair(c));
                nextVersionChanges = [...cleaned, { date, iso: new Date().toISOString(), from: serverDelay.planned, to: serverDelay.scheduled }]
                  .sort((a, b) => a.date.localeCompare(b.date));
                versionChangesChanged = true;
              }
            }
          } catch (e) {
            console.warn(`[digests] server-launch-delay check failed for ${cached.name}:`, e);
          }

          if (nextVersionChanges && nextVersionChanges.length > 0) versionDelayed++;
        }

        // (iv) Slip-reason inference. Runs in two cases:
        //   - A new slip was detected this run (versionChangesChanged).
        //   - A cached slip exists that has neither `reason` nor
        //     `reasonAttempted` — this catches entries written before
        //     reason inference shipped, giving them one retroactive pass.
        // The helper itself short-circuits when there's no chat AND no
        // meegoUrl, so this is safe to gate generously.
        if (!nextVersionChanges) nextVersionChanges = cached.versionChanges;
        const needsRetroactive = (nextVersionChanges ?? []).some(
          e => !e.reason && !e.reasonAttempted,
        );
        if ((versionChangesChanged || needsRetroactive) && nextVersionChanges && nextVersionChanges.length > 0 && (cached.chatId || cached.meegoUrl)) {
          const prior = cached.versionChanges ?? [];
          // Look up a cached entry by (date, from, to). Used to:
          //   1. Preserve a previously-inferred `reason` when paths (ii)/(iii)
          //      drop+recreate an entry on a same-day re-run (the recreated
          //      entry has no reason field, but the slip itself is the same).
          //   2. Skip Gemini for entries that already had a reason inferred,
          //      so we never re-infer (and risk a different answer) once a
          //      reason is locked in.
          const findCached = (e: { date: string; from: string; to: string }) =>
            prior.find(p => p.date === e.date && p.from === e.from && p.to === e.to);
          const updated = await Promise.all(nextVersionChanges.map(async e => {
            const cachedEntry = findCached(e);
            // 1. Cached entry already has a reason → carry it forward verbatim.
            //    Never re-infer (avoids the answer drifting between runs).
            if (cachedEntry?.reason) {
              return { ...e, reason: cachedEntry.reason, reasonAttempted: true };
            }
            // 2. Cached entry exists, no reason, but inference was already
            //    attempted (Gemini said "unknown"). Don't keep re-asking.
            if (cachedEntry?.reasonAttempted) {
              return { ...e, reasonAttempted: true };
            }
            // 3. Cached entry without reason AND without reasonAttempted —
            //    this is either a brand-new slip OR an entry that predates
            //    the reason field. Either way, run Gemini once. Mark
            //    reasonAttempted so we don't loop on "unknown" verdicts.
            try {
              const reason = await inferVersionSlipReason(cached.name, e.from, e.to, cached.chatId ?? '', botToken, cached.meegoUrl);
              return reason
                ? { ...e, reason, reasonAttempted: true }
                : { ...e, reasonAttempted: true };
            } catch (err) {
              console.warn(`[digests] slip-reason inference failed for "${cached.name}":`, err);
              // Don't mark attempted on transient errors — let the next
              // refresh retry. Gemini hiccups shouldn't permanently
              // disable inference for an entry.
              return e;
            }
          }));
          // If inference added a reason or attempted flag to any entry,
          // mark versionChangesChanged so the delta gets persisted even
          // when no new slip was detected this run (retroactive pass).
          const inferenceChanged = updated.some((u, i) => {
            const before = nextVersionChanges![i];
            return u.reason !== before.reason || u.reasonAttempted !== before.reasonAttempted;
          });
          if (inferenceChanged) versionChangesChanged = true;
          nextVersionChanges = updated;
        }

        const delta: Partial<import('./types').Feature> = {};
        if (versionChangesChanged) delta.versionChanges = nextVersionChanges;

        // Features in AB Testing don't get a riskLevel in the cache
        // (the UI Delayed badge keys off versionChanges directly), but
        // we still want the digest card's RiskFinding to flip to
        // red+Delayed so the daily message matches Hamlet.
        if (statusName === '实验中') {
          const hasDelayAb = (nextVersionChanges?.length ?? 0) > 0;
          if (hasDelayAb && finding) {
            const latest = nextVersionChanges![nextVersionChanges!.length - 1];
            finding.delay = { detail: `${latest.from} → ${latest.to}` };
            finding.level = 'red';
          }
          // AB Testing defaults to Low risk in the cache. The UI's
          // Delayed badge keys off versionChanges directly, so a
          // delayed AB feature still reads "Delayed" regardless of
          // riskLevel — and a non-delayed one now reads "Low" instead
          // of having no badge at all.
          delta.riskLevel = 'green';
          delta.riskNotes = undefined;
          trackRiskTransition(delta, cached);
          deltas.set(fId, delta);
          continue;
        }

        // If the feature has any planned-version / launch-date slips,
        // force red and surface a "Delayed" marker on the corresponding
        // RiskFinding so the digest card renders consistently with the
        // Hamlet UI. The from/to values are already self-describing
        // (versions like "44.9 → 45.0" or dates like "Apr 9 → Apr 13").
        const hasDelay = (nextVersionChanges?.length ?? 0) > 0;
        if (hasDelay && finding) {
          const latest = nextVersionChanges![nextVersionChanges!.length - 1];
          finding.delay = { detail: `${latest.from} → ${latest.to}` };
          finding.level = 'red';
        }

        if (finding) {
          delta.riskLevel = finding.level;
          const notes: string[] = [...finding.reasons];
          if (finding.delay) notes.unshift(finding.delay.detail);
          delta.riskNotes = notes.length > 0 ? notes : undefined;
          trackRiskTransition(delta, cached);
          deltas.set(fId, delta);
          continue;
        }

        // No risk finding but we detected delays — surface as red.
        if (hasDelay) {
          const latest = nextVersionChanges![nextVersionChanges!.length - 1];
          delta.riskLevel = 'red';
          delta.riskNotes = [`${latest.from} → ${latest.to}`];
          trackRiskTransition(delta, cached);
          deltas.set(fId, delta);
          continue;
        }

        // Anything from PRD Walkthrough onwards (PRD Walkthrough → Tech
        // Design → Development → QA Testing → Merged) defaults to Low
        // risk when no explicit finding or delay was detected. Earlier
        // statuses (PRD/Design Prep, Line Review, Compliance Review,
        // Dependency Check, RD Allocation) preserve their previous
        // risk data — they're not yet under active build.
        const DEFAULT_GREEN_STATUSES = new Set([
          '待需求详评',     // PRD Walkthrough
          '技术方案设计中',  // Tech Design
          '开发中',         // Development
          '测试中',         // QA Testing
          '已上车',         // Merged
        ]);
        if (DEFAULT_GREEN_STATUSES.has(statusName)) {
          delta.riskLevel = 'green';
          delta.riskNotes = undefined;
          trackRiskTransition(delta, cached);
          deltas.set(fId, delta);
          continue;
        }

        // Earlier statuses (PRD/Design Prep, Line Review, etc.) without
        // a risk finding keep their previous risk data — only persist
        // if versionChanges changed.
        if (Object.keys(delta).length > 0) deltas.set(fId, delta);
      }
      // Re-sort risk findings since some may have been bumped to red above.
      riskFindings.sort((a, b) => severityOrder[a.level] - severityOrder[b.level]);
      await patchFeaturesInCache(deltas);
      console.log(`[digests] risk data patched into feature cache for ${deltas.size} features (version-change scan: ${versionScanned} scanned, ${versionDelayed} delayed)`);
    }
  } catch (e) {
    console.warn('[digests] failed to write risk data to feature cache:', e);
  }

  // Step 7: Send risk digest (always) — interactive card with per-feature
  // buttons, posted to the PM group chat.
  let riskSent = false;
  if (rioToken && !shouldSendSection(state, opts, 'digest.risk')) {
    console.log('[digests] risk digest skipped (paused or section-filtered)');
  } else if (rioToken) {
    const card = await buildRiskDigestCard(riskFindings);
    const preview = [card.title, ...card.sections.map(s => s.content)].join('\n---\n');
    console.log('[digests] risk digest:\n' + preview);
    const id = await sendInteractiveCardToChat(
      targetChatId, card.title, card.template, card.sections, rioToken,
    );
    riskSent = id !== null;
  }

  // Step 8: Send unanswered Q&A digest (only if there are findings) —
  // interactive card to the same PM group chat. Sent under the
  // Hamlet/Junior bot identity so card-action button clicks
  // (Let me Reply) route to Hamlet's `/api/lark/card-action`.
  let unansweredSent = false;
  if (unansweredFindings.length > 0 && !shouldSendSection(state, opts, 'digest.unanswered')) {
    console.log('[digests] unanswered digest skipped (paused or section-filtered)');
  } else if (unansweredFindings.length > 0) {
    const sendToken = botToken || rioToken;
    if (!sendToken) {
      console.log('[digests] no token to send unanswered digest — skipping');
    } else {
      const card = buildUnansweredDigestCard(unansweredFindings);
      const preview = [card.title, ...card.sections.map(s => s.content)].join('\n---\n');
      console.log('[digests] unanswered digest:\n' + preview);
      const id = await sendInteractiveCardToChat(
        targetChatId, card.title, card.template, card.sections, sendToken,
      );
      unansweredSent = id !== null;
    }
  } else {
    console.log('[digests] no unanswered questions — skipping Q&A digest');
  }

  // Step 9: PRD Changes digest already sent at Step 2c.5 (before Q&A scan)
  // to avoid timeout issues. Re-used flag for the return type.
  const prdChangesSent = prdChangesSentEarly;

  return {
    featuresChecked: inDev.length,
    riskSent,
    unansweredSent,
    prdChangesSent,
    riskFindings,
    unansweredFindings,
  };
}

// Silence unused import warnings — kept for when chatId resolution is added.
export type { Feature };

// ─── Per-section digest entrypoints ───────────────────────────────────────
//
// The legacy daily digest pulls Meego + sends every card in one cron.
// We now split that into:
//   1. refresh-feature-cache cron → runDailyDigests({ mode: 'refresh' })
//      Pulls Meego, queues line_review/ab_open/prd_changes cards, writes
//      feature-snapshots.json. Sends NO cards.
//   2. Per-section crons → runDigestSection(<id>)
//      Each section is its own Cloud Scheduler job.
//      - Queue-based (line_review, ab_open, prd_changes): drain queue, send card.
//      - Scan-based (risk, unanswered, ab_concluded): delegate to
//        runDailyDigests({ mode: 'full', sectionFilter: id }) which still
//        pulls Meego (for now — Phase B+ will switch to snapshot reads).

export interface DigestSectionResult {
  sectionId: string;
  sent: boolean;
  count: number;
  note?: string;
}

export async function runDigestSection(sectionId: string): Promise<DigestSectionResult> {
  switch (sectionId) {
    case 'digest.line_review': return drainLineReviewQueue();
    case 'digest.ab_open': return drainAbOpenQueue();
    case 'digest.prd_changes': return drainPrdChangesQueue();
    case 'digest.unanswered': return runUnansweredFromSnapshots();
    case 'digest.risk':
    case 'digest.ab_concluded': {
      // Scan-based sections still on the legacy path: re-use
      // runDailyDigests with a sectionFilter so we get the same scan +
      // send logic, but only this card actually fires. (digest.unanswered
      // has its own snapshot-based fast path above.)
      const result = await runDailyDigests({ mode: 'full', sectionFilter: sectionId });
      const sent = sectionId === 'digest.risk' ? result.riskSent
        : false; // ab_concluded is fire-and-forget; can't tell from result
      return { sectionId, sent, count: 1, note: 'scan-based' };
    }
    default:
      throw new Error(`unknown digest section: ${sectionId}`);
  }
}

/**
 * Fast path for digest.unanswered: read inDev features + juniorChats from
 * the snapshot file written by `refresh-feature-cache`, run ONLY the Q&A
 * scan (chat + PRD comments), build + send the card. Skips Meego pull,
 * link extraction, PRD diff, risk eval, and AB-concluded scan — all
 * irrelevant to this section.
 *
 * Trade-off: depends on snapshots being fresh. If the file is missing or
 * stale (>24h), falls back to the legacy full-pipeline path so the card
 * still fires.
 */
async function runUnansweredFromSnapshots(): Promise<DigestSectionResult> {
  const t0 = Date.now();
  const { loadFeatureSnapshots } = await import('./feature-snapshots');
  const snapshots = await loadFeatureSnapshots();
  if (!snapshots) {
    console.warn('[digests:unanswered] no feature-snapshots.json — falling back to full pipeline');
    const result = await runDailyDigests({ mode: 'full', sectionFilter: 'digest.unanswered' });
    return { sectionId: 'digest.unanswered', sent: result.unansweredSent, count: 1, note: 'fallback: snapshots missing' };
  }
  const refreshAgeH = (Date.now() - new Date(snapshots.refreshedAtIso).getTime()) / (60 * 60 * 1000);
  if (refreshAgeH > 24) {
    console.warn(`[digests:unanswered] snapshots are ${refreshAgeH.toFixed(1)}h old — falling back to full pipeline`);
    const result = await runDailyDigests({ mode: 'full', sectionFilter: 'digest.unanswered' });
    return { sectionId: 'digest.unanswered', sent: result.unansweredSent, count: 1, note: 'fallback: snapshots stale' };
  }

  // Don't restrict to inDevIds — that's filtered by RISK_DIGEST_STATUSES
  // (Tech Design / Development / QA Testing) which excludes AB Testing,
  // Merged, and earlier statuses. The legacy Q&A scan iterated all
  // features minus those whose overallStatusKey === 'end'; do the same.
  const scannableById = new Map<string, MeegoFeature>();
  for (const [id, f] of Object.entries(snapshots.features)) {
    if (f.overallStatusKey === 'end') continue;
    scannableById.set(id, f);
  }
  const juniorChats = snapshots.juniorChats ?? [];
  console.log(`[digests:unanswered] using snapshots refreshed ${refreshAgeH.toFixed(1)}h ago — ${scannableById.size} scannable features (non-ended), ${juniorChats.length} junior chats`);

  // Resolve owner open_id (required for the @-mention filter).
  const botToken = await getLarkBotToken();
  if (!botToken) {
    console.warn('[digests:unanswered] no bot token — cannot scan or send');
    return { sectionId: 'digest.unanswered', sent: false, count: 0, note: 'no bot token' };
  }
  const ownerEmail = process.env.OWNER_EMAIL;
  let ownerOpenId = '';
  if (ownerEmail) {
    try {
      const map = await resolveOpenIds([ownerEmail], botToken);
      ownerOpenId = map[ownerEmail] ?? '';
    } catch (e) {
      console.warn('[digests:unanswered] failed to resolve owner open_id:', e);
    }
  }
  if (!ownerOpenId) {
    console.warn('[digests:unanswered] owner open_id not resolved — cannot scan');
    return { sectionId: 'digest.unanswered', sent: false, count: 0, note: 'no owner open_id' };
  }

  const sinceMs = Date.now() - UNANSWERED_WINDOW_MS;
  const unansweredByFeature = new Map<string, UnansweredFinding>();

  // Step A: chat scan — iterate juniorChats, look up the matching MeegoFeature
  // from snapshots, run collectUnansweredForFeature.
  let chatScanned = 0;
  for (const chat of juniorChats) {
    const feature = scannableById.get(chat.meegoId);
    if (!feature) continue;
    if (feature.overallStatusKey === 'end') continue;
    chatScanned++;
    try {
      const finding = await collectUnansweredForFeature(
        feature, chat.chatId, sinceMs, ownerOpenId, botToken,
      );
      if (finding) {
        finding.feature.chatId = chat.chatId;
        unansweredByFeature.set(feature.workItemId, finding);
      }
    } catch (e) {
      console.warn(`[digests:unanswered] chat scan failed for "${feature.name}":`, e);
    }
  }
  console.log(`[digests:unanswered] chat scan: ${chatScanned} chats, ${unansweredByFeature.size} with unanswered`);

  // Step B: PRD-comment scan. Pull cached features (for PRD URLs) and
  // iterate ones that have a snapshot match.
  try {
    const cache = await readFeatureCache();
    if (cache) {
      let prdScanned = 0;
      let prdWithUnanswered = 0;
      for (const cached of cache.features) {
        const fId = cached.meegoIssueId ?? cached.id;
        const meegoFeature = scannableById.get(fId);
        if (!meegoFeature) continue;
        if (meegoFeature.overallStatusKey === 'end') continue;
        if (!cached.prd) continue;
        prdScanned++;
        try {
          const commentQs = await collectUnansweredCommentsForFeature(
            meegoFeature, ownerOpenId, sinceMs,
          );
          if (commentQs.length === 0) continue;
          prdWithUnanswered++;
          const existing = unansweredByFeature.get(fId);
          if (existing) {
            existing.questions = [...existing.questions, ...commentQs]
              .sort((a, b) => b.timestamp - a.timestamp)
              .slice(0, MAX_QUESTIONS_PER_FEATURE);
          } else {
            unansweredByFeature.set(fId, { feature: meegoFeature, questions: commentQs });
          }
        } catch (e) {
          console.warn(`[digests:unanswered] PRD-comment scan failed for "${meegoFeature.name}":`, e);
        }
      }
      console.log(`[digests:unanswered] PRD-comment scan: ${prdScanned} scanned, ${prdWithUnanswered} with unanswered`);
    }
  } catch (e) {
    console.warn('[digests:unanswered] PRD-comment scan errored:', e);
  }

  const findings = [...unansweredByFeature.values()];
  if (findings.length === 0) {
    console.log(`[digests:unanswered] no findings (took ${((Date.now() - t0) / 1000).toFixed(1)}s) — skipping send`);
    return { sectionId: 'digest.unanswered', sent: false, count: 0, note: 'no findings' };
  }

  // Persist findings into the UI feature cache so the FeatureDrawer
  // can surface them in the OPEN QUESTIONS callout + activity feed.
  // Capped at the last 10 entries per feature, deduped by messageId so
  // re-running the digest doesn't multiply the same question.
  try {
    const cache = await readFeatureCache();
    if (cache) {
      const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Singapore' });
      const deltas = new Map<string, Partial<Feature>>();
      for (const finding of findings) {
        const fId = finding.feature.workItemId;
        const cached = cache.features.find(cf => cf.id === fId || cf.meegoIssueId === fId);
        if (!cached) continue;
        const existing = cached.unansweredQuestions ?? [];
        const seenIds = new Set(existing.map(e => e.messageId));
        const additions = finding.questions
          .filter(q => !seenIds.has(q.messageId))
          .map(q => ({
            date: today,
            // Prefer the original message create_time (q.timestamp is
            // ms-since-epoch). Fall back to "now" if absent so the
            // Activity row always has a time to render.
            iso: q.timestamp && Number.isFinite(q.timestamp)
              ? new Date(q.timestamp).toISOString()
              : new Date().toISOString(),
            sender: q.senderName || 'Unknown',
            text: q.text,
            source: (q.source ?? 'chat') as 'chat' | 'prd_comment',
            messageId: q.messageId,
          }));
        if (additions.length === 0) continue;
        const next = [...existing, ...additions].slice(-10);
        deltas.set(fId, { unansweredQuestions: next });
      }
      if (deltas.size > 0) {
        await patchFeaturesInCache(deltas);
        console.log(`[digests:unanswered] persisted to UI cache: ${deltas.size} features patched with new questions`);
      }
    }
  } catch (e) {
    console.warn('[digests:unanswered] feature-cache persist failed:', e);
  }

  // Send to PM group, same as the legacy path.
  const card = buildUnansweredDigestCard(findings);
  const preview = [card.title, ...card.sections.map(s => s.content)].join('\n---\n');
  console.log('[digests:unanswered] card preview:\n' + preview);
  try {
    const id = await sendInteractiveCardToChat(
      PM_GROUP_CHAT_ID, card.title, card.template, card.sections, botToken,
    );
    const sent = id !== null;
    const totalQs = findings.reduce((sum, f) => sum + f.questions.length, 0);
    console.log(`[digests:unanswered] ${sent ? 'sent' : 'send returned no id'} — ${findings.length} features, ${totalQs} questions, took ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    return { sectionId: 'digest.unanswered', sent, count: totalQs };
  } catch (e) {
    console.warn('[digests:unanswered] send failed:', e);
    return { sectionId: 'digest.unanswered', sent: false, count: 0, note: 'send failed' };
  }
}

async function drainLineReviewQueue(): Promise<DigestSectionResult> {
  const state = await loadDigestState();
  const queue = state.pendingLineReviewCards ?? [];
  if (queue.length === 0) {
    console.log('[digests:line_review] queue empty');
    return { sectionId: 'digest.line_review', sent: false, count: 0, note: 'empty queue' };
  }
  let sent = 0;
  for (const item of queue) {
    try {
      await sendFeatureCard({
        name: item.name,
        meegoUrl: item.meegoUrl,
        prdUrl: item.prdUrl,
        priority: item.priority,
        headerTitle: 'PRD Ready ✅',
        headerTemplate: 'green',
      });
      sent++;
    } catch (e) {
      console.warn(`[digests:line_review] send failed for "${item.name}":`, e);
    }
  }
  state.pendingLineReviewCards = [];
  await saveDigestState(state);
  console.log(`[digests:line_review] sent ${sent}/${queue.length}, queue cleared`);
  return { sectionId: 'digest.line_review', sent: sent > 0, count: sent };
}

async function drainAbOpenQueue(): Promise<DigestSectionResult> {
  const state = await loadDigestState();
  const queue = state.pendingAbOpenCards ?? [];
  if (queue.length === 0) {
    console.log('[digests:ab_open] queue empty');
    return { sectionId: 'digest.ab_open', sent: false, count: 0, note: 'empty queue' };
  }
  // Hydrate full MeegoFeatures from the snapshots file.
  const { loadFeatureSnapshots } = await import('./feature-snapshots');
  const snapshots = await loadFeatureSnapshots();
  if (!snapshots) {
    console.warn('[digests:ab_open] no feature-snapshots.json — cannot hydrate; leaving queue intact for next refresh');
    return { sectionId: 'digest.ab_open', sent: false, count: 0, note: 'snapshots missing' };
  }
  const transitions: Array<{ feature: MeegoFeature; libraUrl: string }> = [];
  const missing: string[] = [];
  for (const item of queue) {
    const feature = snapshots.features[item.workItemId];
    if (!feature) { missing.push(item.workItemId); continue; }
    transitions.push({ feature, libraUrl: item.libraUrl });
  }
  if (missing.length > 0) {
    console.warn(`[digests:ab_open] ${missing.length} queued items missing from snapshots: ${missing.join(',')}`);
  }
  if (transitions.length === 0) {
    console.log('[digests:ab_open] no hydratable transitions');
    return { sectionId: 'digest.ab_open', sent: false, count: 0, note: 'all missing' };
  }
  try {
    await sendAbOpenDigestCard(transitions);
    state.pendingAbOpenCards = [];
    await saveDigestState(state);
    console.log(`[digests:ab_open] sent ${transitions.length}, queue cleared`);
    return { sectionId: 'digest.ab_open', sent: true, count: transitions.length };
  } catch (e) {
    console.warn('[digests:ab_open] send failed; queue left intact:', e);
    return { sectionId: 'digest.ab_open', sent: false, count: 0, note: 'send failed' };
  }
}

async function drainPrdChangesQueue(): Promise<DigestSectionResult> {
  const state = await loadDigestState();
  const queue = state.pendingPrdChanges ?? [];
  if (queue.length === 0) {
    console.log('[digests:prd_changes] queue empty');
    return { sectionId: 'digest.prd_changes', sent: false, count: 0, note: 'empty queue' };
  }
  const card = buildPrdChangesDigestCard(queue);
  try {
    const juniorToken = await getLarkBotToken();
    const id = await sendInteractiveCardToChat(
      PM_GROUP_CHAT_ID, card.title, card.template, card.sections, juniorToken,
    );
    if (id) {
      state.pendingPrdChanges = [];
      await saveDigestState(state);
      console.log(`[digests:prd_changes] sent ${queue.length}, queue cleared`);
      return { sectionId: 'digest.prd_changes', sent: true, count: queue.length };
    }
    console.warn('[digests:prd_changes] send returned no id; queue left intact');
    return { sectionId: 'digest.prd_changes', sent: false, count: 0, note: 'send returned null' };
  } catch (e) {
    console.warn('[digests:prd_changes] send failed; queue left intact:', e);
    return { sectionId: 'digest.prd_changes', sent: false, count: 0, note: 'send failed' };
  }
}
