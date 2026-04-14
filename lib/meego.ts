import { Priority, Feature } from './types';
import { extractFigmaUrlFromPrd, searchAbReport, joinFeatureChat, getPackageQrUrl, searchLibraInChat } from './lark';

const MEEGO_MCP_URL = 'https://meego.larkoffice.com/mcp_server/v1';
const MY_EMAIL = process.env.OWNER_EMAIL!;
const TIKTOK_PROJECT_KEY = '5f105019a8b9a853da64767f';

// Status display groups — maps Meego node names to consolidated display
// labels. When multiple nodes are active, the LATEST (most advanced) stage
// wins. Higher index = more advanced.
const STATUS_GROUPS: Array<{ label: string; nodes: string[] }> = [
  { label: 'PRD/Design Prep', nodes: ['产品需求准备'] },
  { label: 'Line Review',   nodes: ['产品线内初评'] },
  { label: 'RD Allocation', nodes: ['技术评估&排优'] },
  { label: 'PRD Walkthrough', nodes: ['需求详评', '需求评审'] },
  { label: 'Tech Design',   nodes: ['技术方案设计'] },
  { label: 'Development',   nodes: ['iOS 开发', 'Android 开发', 'Server 开发', 'Server上线'] },
  { label: 'QA',            nodes: ['QA测试准备', 'QA测试', 'QA功能测试'] },
  { label: 'UAT',           nodes: ['PM验收', 'PM走查', 'UI&UX验收'] },
  { label: 'AB Testing',    nodes: ['AB实验'] },
  { label: 'Done',          nodes: ['结束'] },
];

// Build a lookup: Chinese node name → { label, priority }
const NODE_TO_STATUS = new Map<string, { label: string; priority: number }>();
for (let i = 0; i < STATUS_GROUPS.length; i++) {
  for (const node of STATUS_GROUPS[i].nodes) {
    NODE_TO_STATUS.set(node, { label: STATUS_GROUPS[i].label, priority: i });
  }
}

// Legacy translation map kept for any code that calls translateNode() directly.
const NODE_TRANSLATIONS: Record<string, string> = {};
for (const group of STATUS_GROUPS) {
  for (const node of group.nodes) {
    NODE_TRANSLATIONS[node] = group.label;
  }
}
// Extra translations for nodes not in STATUS_GROUPS.
NODE_TRANSLATIONS['依赖判断'] = 'Dependency Check';
NODE_TRANSLATIONS['合规评估'] = 'Compliance Review';

// P0–P3 option IDs in Meego
const PRIORITY_TO_MEEGO: Record<Priority, string> = {
  P0: '0',
  P1: '1',
  P2: '2',
  P3: '3',
};

export function translateNode(node: string): string {
  return NODE_TRANSLATIONS[node] ?? node;
}

/** Chinese overall status name → English display label. */
const OVERALL_STATUS_MAP: Record<string, string> = {
  '开始':         'PRD/Design Prep',
  '待线内评审':    'Line Review',
  '线内评审完成':  'Dependency Check',
  '待评估&排优':   'RD Allocation',
  '待需求详评':    'PRD Walkthrough',
  '技术方案设计中': 'Tech Design',
  '开发中':        'Development',
  '测试中':        'QA Testing',
  '实验中':        'AB Testing',
  '已上车':        'Merged',
  '已完成':        'Done',
};

function resolveDisplayStatus(overallStatusName: string): string {
  return OVERALL_STATUS_MAP[overallStatusName] ?? (overallStatusName || 'Unknown');
}

function pickNode(nodes: Array<{ key: string; name: string }>): { key: string; name: string } | null {
  if (nodes.length === 0) return null;
  // Pick the most advanced (highest priority index) active node.
  // Nodes not in STATUS_GROUPS sort to -1 so any known stage wins.
  return nodes.slice().sort((a, b) => {
    const ia = NODE_TO_STATUS.get(a.name)?.priority ?? -1;
    const ib = NODE_TO_STATUS.get(b.name)?.priority ?? -1;
    return ib - ia; // descending — highest priority first
  })[0];
}

export async function callMeegoMcp(toolName: string, args: Record<string, unknown>) {
  const token = process.env.MEEGO_USER_TOKEN;
  if (!token) throw new Error('MEEGO_USER_TOKEN not configured');

  const res = await fetch(MEEGO_MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Mcp-Token': token,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: { name: toolName, arguments: args },
    }),
  });

  if (!res.ok) throw new Error(`Meego MCP HTTP error: ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(`Meego MCP error: ${data.error.message}`);
  return data.result?.content?.[0]?.text ?? '';
}

// Parse active nodes from get_workitem_brief markdown response
function parseActiveNodes(raw: string): Array<{ key: string; name: string; owners: string }> {
  const nodeSection = raw.split('# 进行中的节点')[1] ?? '';
  return nodeSection
    .split('\n')
    .filter(l => l.startsWith('|') && !l.includes('---') && !l.includes('节点 ID'))
    .flatMap(line => {
      const parts = line.split('|').map(p => p.trim()).filter(Boolean);
      if (parts.length >= 3) return [{ key: parts[0], name: parts[1], owners: parts[2] }];
      return [];
    });
}

// Parse a named field from the # 工作项字段 table
function parseWorkItemField(raw: string, fieldName: string): string {
  const regex = new RegExp(`\\|\\s*${fieldName}\\s*\\|\\s*([^|\\n]+?)\\s*\\|`);
  const match = raw.match(regex);
  return match ? match[1].trim() : '';
}

// Extract display names from role member value "Name1(email1),Name2(email2)"
// Handles names with commas ("Han, Dongwoo") and parentheses ("Xuan Sheng (盛煊)")
function extractNames(value: string): string {
  if (!value || value === '未填写') return '';
  const names: string[] = [];
  // Match: name (may contain parens/commas) followed by (email@domain)
  const regex = /(.*?)\([^()]*@[^()]+\)/g;
  let m;
  while ((m = regex.exec(value)) !== null) {
    const name = m[1].replace(/^,\s*/, '').trim();
    if (name) names.push(name);
  }
  return names.length > 0 ? names.join(', ') : value;
}

// Extract name→email pairs from role member value "Name1(email1),Name2(email2)"
function extractNameEmailPairs(value: string): Array<{ name: string; email: string }> {
  if (!value || value === '未填写') return [];
  const pairs: Array<{ name: string; email: string }> = [];
  const regex = /(.*?)\(([^()]*@[^()]+)\)/g;
  let m;
  while ((m = regex.exec(value)) !== null) {
    const name = m[1].replace(/^,\s*/, '').trim();
    const email = m[2].trim();
    if (name && email.includes('@')) pairs.push({ name, email });
  }
  return pairs;
}

// Collect all name→email pairs from all roles in the raw brief
function collectAllPocEmails(raw: string): Map<string, string> {
  const map = new Map<string, string>();
  const roles = ['PM', 'TPM', 'Tech owner', 'iOS', 'Android', 'Server', 'QA', 'DA', 'UI&UX', 'Content Designer'];
  for (const role of roles) {
    const escapedRole = role.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`"${escapedRole}":"([^"]+)"`);
    const match = raw.match(regex);
    if (match) {
      for (const { name, email } of extractNameEmailPairs(match[1])) {
        if (!map.has(name)) map.set(name, email);
      }
    }
  }
  return map;
}



// Parse last-modified date from get_workitem_brief raw text
function parseUpdateTime(raw: string): string {
  const val = parseWorkItemField(raw, '更新时间') || parseWorkItemField(raw, 'updated_at');
  if (val) {
    const ts = Number(val);
    if (!isNaN(ts) && ts > 1_000_000_000_000) return new Date(ts).toISOString().split('T')[0];
    const m = val.match(/(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
  }
  return '';
}

// Parse a role member from the 角色成员 JSON in the workitem attributes table
function parseRoleMember(raw: string, roleName: string): string {
  const escapedRole = roleName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`"${escapedRole}":"([^"]+)"`);
  const match = raw.match(regex);
  return match ? extractNames(match[1]) : '';
}

// ─── MQL types ────────────────────────────────────────────────────────────────

interface MqlFieldValue {
  long_value?: number;
  varchar_value?: string;
  string_value?: string;
  key_label_value?: { key: string; label: string };
}

interface MqlItem {
  moql_field_list: Array<{ key: string; value: MqlFieldValue }>;
}

interface MqlResponse {
  session_id: string;
  list: Array<{ count: number }>;
  data: Record<string, MqlItem[]>;
}

interface ExtendedFields { priority: Priority; prd: string; complianceUrl: string; lastUpdated: string; name: string; status: string; nodeKey: string; commentSummary: string }

// Fetch all PM-owned TikTok stories via MQL — returns every story regardless of todo status
async function fetchAllOwnedStories(): Promise<Map<string, ExtendedFields>> {
  const map = new Map<string, ExtendedFields>();
  const MQL = "SELECT `work_item_id`, `name`, `priority`, `wiki`, `field_due3fb`, `updated_at` FROM `TikTok`.`需求` WHERE `__PM` = current_login_user()";
  const GROUP_ID = '1';
  let sessionId: string | undefined;
  let page = 1;

  while (true) {
    const args: Record<string, unknown> = sessionId
      ? { project_key: 'TikTok', session_id: sessionId, group_pagination_list: [{ group_id: GROUP_ID, page_num: page }] }
      : { project_key: 'TikTok', mql: MQL };

    const raw = await callMeegoMcp('search_by_mql', args);
    let data: MqlResponse;
    try {
      data = JSON.parse(raw) as MqlResponse;
    } catch {
      throw new Error(`search_by_mql returned non-JSON: ${raw}`);
    }
    if (!sessionId) {
      sessionId = data.session_id;
      const total = data.list?.[0]?.count ?? 0;
      console.log('[meego] MQL returned total:', total, 'stories owned by current user');
    }

    const total = data.list?.[0]?.count ?? 0;
    const items = data.data?.[GROUP_ID] ?? [];

    for (const item of items) {
      let id = '';
      let name = '';
      let priority: Priority = 'P2';
      let prd = '';
      let complianceUrl = '';
      let lastUpdated = '';
      let commentSummary = '';
      for (const f of item.moql_field_list ?? []) {
        if (f.key === 'work_item_id') {
          id = String(f.value.long_value ?? '');
        } else if (f.key === 'name') {
          name = f.value.varchar_value ?? f.value.string_value ?? '';
        } else if (f.key === 'priority') {
          const label = f.value.key_label_value?.label ?? '';
          if (/^P[0-3]$/.test(label)) priority = label as Priority;
        } else if (f.key === 'wiki') {
          prd = f.value.varchar_value ?? '';
        } else if (f.key === 'field_due3fb') {
          complianceUrl = f.value.varchar_value ?? '';
        } else if (f.key === 'updated_at') {
          const sv = f.value.string_value ?? f.value.varchar_value;
          if (sv) {
            const m = sv.match(/(\d{4}-\d{2}-\d{2})/);
            if (m) lastUpdated = m[1];
          } else {
            const ts = f.value.long_value;
            if (ts) {
              // Detect seconds vs milliseconds
              const ms = ts > 1e12 ? ts : ts * 1000;
              lastUpdated = new Date(ms).toISOString().split('T')[0];
            }
          }
        }
      }

      if (id) map.set(id, { priority, prd, complianceUrl, lastUpdated, name, status: '', nodeKey: '', commentSummary });
    }

    if (map.size >= total || items.length === 0) break;
    page++;
  }

  return map;
}

// ─── list_todo types ──────────────────────────────────────────────────────────

interface MeegoTodoItem {
  work_item_info: { work_item_id: number; work_item_type_key: string; work_item_name: string };
  project_key: string;
  node_info: { node_name: string; node_state_key: string };
}

interface MeegoTodoResponse {
  total: number;
  list: MeegoTodoItem[];
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function fetchUserStories(projectKey: string): Promise<Feature[]> {
  // Fetch todo items and all PM-owned stories in parallel.
  // MQL returns ALL stories where user is PM (regardless of todo status).
  // list_todo provides accurate active node info for items with pending actions.
  const [todoItems, allOwned] = await Promise.all([
    (async () => {
      const items: MeegoTodoItem[] = [];
      let page = 1;
      while (true) {
        let data: MeegoTodoResponse;
        try {
          const raw = await callMeegoMcp('list_todo', { action: 'todo', page_num: page });
          data = JSON.parse(raw) as MeegoTodoResponse;
        } catch {
          throw new Error(`Failed to parse Meego list_todo response (page ${page})`);
        }
        items.push(...(data.list ?? []));
        if (items.length >= data.total) break;
        page++;
      }
      return items;
    })(),
    fetchAllOwnedStories().catch((err) => {
      console.error('[meego] fetchAllOwnedStories failed:', err);
      return new Map<string, ExtendedFields>();
    }),
  ]);

  // Build features from todo items (these have accurate node info)
  const todoIds = new Set<string>();
  const features: Feature[] = [];

  for (const item of todoItems) {
    if (item.project_key !== projectKey || item.work_item_info.work_item_type_key !== 'story') continue;
    const id = String(item.work_item_info.work_item_id);
    if (todoIds.has(id)) continue; // skip duplicates from list_todo
    todoIds.add(id);
    const ext = allOwned.get(id);
    features.push({
      id,
      name: item.work_item_info.work_item_name,
      description: '',
      status: translateNode(item.node_info?.node_name ?? 'Unknown'),
      priority: ext?.priority ?? 'P2',
      owner: 'Thomas',
      tasks: [],
      lastUpdated: ext?.lastUpdated || '',
      prd: ext?.prd || undefined,
      complianceUrl: ext?.complianceUrl || undefined,
      commentSummary: ext?.commentSummary || undefined,
      meegoProjectKey: item.project_key,
      meegoIssueId: id,
      meegoNodeKey: item.node_info?.node_state_key ?? '',
      meegoUrl: `https://meego.larkoffice.com/${item.project_key}/story/detail/${item.work_item_info.work_item_id}`,
    });
  }

  // Add stories from MQL that weren't in the todo list (skip deleted/completed with no active node)
  for (const [id, ext] of allOwned) {
    if (todoIds.has(id)) continue;
    // Status will be resolved by per-feature syncFeatureStatus; "Unknown" filtered on frontend
    features.push({
      id,
      name: ext.name,
      description: '',
      status: ext.status || 'Syncing…',
      priority: ext.priority,
      owner: 'Thomas',
      tasks: [],
      lastUpdated: ext.lastUpdated || new Date().toISOString().split('T')[0],
      prd: ext.prd || undefined,
      complianceUrl: ext.complianceUrl || undefined,
      commentSummary: ext.commentSummary || undefined,
      meegoProjectKey: projectKey,
      meegoIssueId: id,
      meegoNodeKey: ext.nodeKey,
      meegoUrl: `https://meego.larkoffice.com/${projectKey}/story/detail/${id}`,
    });
  }

  return features;
}

export async function syncFeatureStatus(meegoUrl: string, userAccessToken?: string, cachedChatId?: string): Promise<{
  status: string;
  name: string;
  owner: string;
  meegoNodeKey: string;
  prd: string;
  figmaUrl: string;
  complianceUrl: string;
  priority: Priority | null;
  canCompleteNode: boolean;
  quarterlyCycle: string;
  businessLine: string;
  socialComponent: string;
  lastUpdated: string;
  pmOwner: string;
  tpmOwner: string;
  techOwner: string;
  iosOwner: string;
  androidOwner: string;
  serverOwner: string;
  qaOwner: string;
  daOwner: string;
  uiuxOwner: string;
  contentDesigner: string;
  iosVersion: string;
  abReportUrl: string;
  libraUrl: string;
  packageQrUrl: string;
  packageDownloadUrl: string;
  iosPackageQrUrl: string;
  iosPackageDownloadUrl: string;
  chatId: string;
  pocEmails: Record<string, string>;
  meegoAvatars: Record<string, string>;
}> {
  const raw = await callMeegoMcp('get_workitem_brief', {
    url: meegoUrl,
    fields: ['wiki', 'priority', 'field_due3fb', 'field_532e61', 'field_a4c558', 'field_2e7909', 'created_at', 'field_0cec98', 'field_6909f6', 'effect_analyze_link_t'],
  });

  // Try parsing the brief as JSON first (current MCP format), then fall back
  // to markdown parsing (legacy format). The digest pipeline uses JSON
  // exclusively; this function needs to support both during the transition.
  let workItemName = '';
  let owner = '';
  let prd = '';
  let complianceUrl = '';
  let priorityRaw = '';
  let libraUrl = '';
  // JSON-extracted role owners (used when MCP returns JSON instead of markdown)
  let jsonPmOwner = '';
  let jsonTpmOwner = '';
  let jsonTechOwner = '';
  let jsonIosOwner = '';
  let jsonAndroidOwner = '';
  let jsonServerOwner = '';
  let jsonQaOwner = '';
  let jsonDaOwner = '';
  let jsonUiuxOwner = '';
  let jsonContentDesigner = '';
  const jsonPocEmails: Record<string, string> = {};

  try {
    const briefJson = JSON.parse(raw) as {
      work_item_attribute?: {
        work_item_name?: string;
        work_item_status?: { key?: string; name?: string };
        role_members?: Array<{ key?: string; name?: string; members?: Array<{ name?: string; email?: string }> }>;
      };
      work_item_fields?: Array<{ key?: string; name?: string; value?: unknown }>;
    };
    workItemName = briefJson.work_item_attribute?.work_item_name ?? '';
    // Extract all role members from JSON for owner fields + pocEmails + avatars
    const roleMembers = briefJson.work_item_attribute?.role_members ?? [];
    const getRoleOwner = (roleKey: string, roleName?: string): string => {
      const role = roleMembers.find(r => r.key === roleKey || (roleName && r.name === roleName));
      return role?.members?.map(m => m.name).filter(Boolean).join(', ') ?? '';
    };
    jsonPmOwner = getRoleOwner('PM');
    jsonTpmOwner = getRoleOwner('TPM');
    jsonTechOwner = getRoleOwner('Tech_Owner', 'Tech owner');
    jsonIosOwner = getRoleOwner('iOS');
    jsonAndroidOwner = getRoleOwner('Android');
    jsonServerOwner = getRoleOwner('Server');
    jsonQaOwner = getRoleOwner('QA');
    jsonDaOwner = getRoleOwner('DA');
    jsonUiuxOwner = getRoleOwner('UI_UX', 'UI&UX');
    jsonContentDesigner = getRoleOwner('Content_Designer', 'Content Designer');
    owner = jsonPmOwner.split(',')[0]?.trim() ?? '';
    // Build pocEmails from all role members
    for (const role of roleMembers) {
      for (const m of role.members ?? []) {
        if (m.name && m.email) jsonPocEmails[m.name] = m.email;
      }
    }
    // Extract fields from work_item_fields
    const getField = (key: string): string => {
      const f = briefJson.work_item_fields?.find(fi => fi.key === key);
      if (!f || f.value === undefined || f.value === null) return '';
      if (typeof f.value === 'string') return f.value;
      if (typeof f.value === 'object' && 'value' in (f.value as Record<string, unknown>)) {
        return String((f.value as Record<string, unknown>).value ?? '');
      }
      return String(f.value);
    };
    prd = getField('wiki');
    complianceUrl = getField('field_due3fb');
    priorityRaw = getField('priority');
    // Try to get Libra URL from effect_analyze_link_t
    const effectLink = getField('effect_analyze_link_t');
    if (effectLink) libraUrl = effectLink;
  } catch {
    // Legacy markdown parsing
    const lines = raw.split('\n');
    for (const line of lines) {
      if (line.includes('工作项名称')) {
        const match = line.match(/\|\s*工作项名称\s*\|\s*(.+?)\s*\|/);
        if (match) workItemName = match[1].trim();
      }
      if (line.includes('角色成员') && line.includes('PM')) {
        const pmMatch = line.match(/"PM":"([^"]+)"/);
        if (pmMatch) owner = pmMatch[1].split('(')[0].trim();
      }
    }
    prd = parseWorkItemField(raw, 'PRD');
    complianceUrl = parseWorkItemField(raw, '合规评估工单链接');
    priorityRaw = parseWorkItemField(raw, '优先级');
  }

  // Parse priority option name (P0–P3) — works for both JSON ('0') and markdown ('P0')
  if (/^[0-3]$/.test(priorityRaw)) priorityRaw = `P${priorityRaw}`;
  const priorityRawOriginal = priorityRaw;
  const priority: Priority | null = /^P[0-3]$/.test(priorityRawOriginal) ? priorityRawOriginal as Priority : null;

  // Check the overall work item status first. If the feature is completed
  // at the work-item level, show "Done" regardless of which nodes are still
  // technically active (Meego doesn't always close all nodes when a feature
  // is marked completed).
  let overallStatusKey = '';
  let overallStatusName = '';
  try {
    const briefJson = JSON.parse(raw) as { work_item_attribute?: { work_item_status?: { key?: string; name?: string } } };
    overallStatusKey = briefJson.work_item_attribute?.work_item_status?.key ?? '';
    overallStatusName = briefJson.work_item_attribute?.work_item_status?.name ?? '';
  } catch {
    // Brief might be markdown, not JSON — fall through to node-based status.
  }

  // Parse active nodes — try JSON first, fall back to markdown.
  let activeNodes: Array<{ key: string; name: string; owners: string }> = [];
  try {
    const briefJson = JSON.parse(raw) as {
      work_item_current_node?: Array<{
        id?: string;
        name?: string;
        owners?: Array<{ email?: string; name?: string }>;
      }>;
    };
    activeNodes = (briefJson.work_item_current_node ?? [])
      .filter(n => n.name)
      .map(n => ({
        key: n.id ?? '',
        name: n.name ?? '',
        owners: (n.owners ?? []).map(o => o.email ?? '').filter(Boolean).join(','),
      }));
  } catch {
    activeNodes = parseActiveNodes(raw);
  }
  const best = pickNode(activeNodes.map(n => ({ key: n.key, name: n.name })));
  const bestWithOwners = activeNodes.find(n => n.key === best?.key);
  const canCompleteNode = bestWithOwners?.owners.includes(MY_EMAIL) ?? false;

  const commitStatusRaw = parseWorkItemField(raw, 'Commit Status');
  let quarterlyCycle = commitStatusRaw;
  try {
    const parsed = JSON.parse(commitStatusRaw);
    if (Array.isArray(parsed) && parsed.length > 0) quarterlyCycle = parsed[parsed.length - 1];
  } catch { /* keep raw value */ }
  const businessLine   = parseWorkItemField(raw, 'DM Business Line');
  const socialComponent = parseWorkItemField(raw, 'Social模块');

  // Use JSON-extracted role owners if available, fall back to markdown parsing.
  const pmOwner        = jsonPmOwner || parseRoleMember(raw, 'PM');
  const tpmOwner       = jsonTpmOwner || parseRoleMember(raw, 'TPM');
  const techOwner      = jsonTechOwner || parseRoleMember(raw, 'Tech owner');
  const iosOwner       = jsonIosOwner || parseRoleMember(raw, 'iOS');
  const androidOwner   = jsonAndroidOwner || parseRoleMember(raw, 'Android');
  const serverOwner    = jsonServerOwner || parseRoleMember(raw, 'Server');
  const qaOwner        = jsonQaOwner || parseRoleMember(raw, 'QA');
  const daOwner        = jsonDaOwner || parseRoleMember(raw, 'DA');
  const uiuxOwner      = jsonUiuxOwner || parseRoleMember(raw, 'UI&UX');
  const contentDesigner = jsonContentDesigner || parseRoleMember(raw, 'Content Designer');

  // Collect name→email pairs — JSON-extracted takes priority.
  const pocEmails = Object.keys(jsonPocEmails).length > 0
    ? jsonPocEmails
    : Object.fromEntries(collectAllPocEmails(raw));

  // Resolve avatars from node detail form items (role fields contain JSON with avatar URLs)
  let meegoAvatars: Record<string, string> = {};
  try {
    const nodeRaw = await callMeegoMcp('get_node_detail', { url: meegoUrl });
    let nodeData: { list?: Array<{ form_items?: Array<{ value?: string }> }> };
    try { nodeData = JSON.parse(nodeRaw); } catch { nodeData = {}; }
    const emailToAvatar = new Map<string, string>();
    for (const node of nodeData.list ?? []) {
      for (const fi of node.form_items ?? []) {
        const v = fi.value ?? '';
        if (!v.includes('avatar')) continue;
        const re1 = /"email"\s*:\s*"([^"]+@[^"]+)"[^}]*"avatar"\s*:\s*"([^"]+)"/g;
        let m;
        while ((m = re1.exec(v)) !== null) emailToAvatar.set(m[1], m[2]);
        const re2 = /"avatar"\s*:\s*"([^"]+)"[^}]*"email"\s*:\s*"([^"]+@[^"]+)"/g;
        while ((m = re2.exec(v)) !== null) { if (!emailToAvatar.has(m[2])) emailToAvatar.set(m[2], m[1]); }
      }
    }
    for (const [name, email] of Object.entries(pocEmails)) {
      const avatar = emailToAvatar.get(email);
      if (avatar) meegoAvatars[name] = avatar;
    }
    // Fallback: search_user_info for remaining names
    const missingKeys = Object.entries(pocEmails)
      .filter(([name]) => !meegoAvatars[name])
      .map(([, email]) => email.split('@')[0]);
    if (missingKeys.length > 0) {
      try {
        const avatarRaw = await callMeegoMcp('search_user_info', {
          project_key: TIKTOK_PROJECT_KEY,
          user_keys: missingKeys,
        });
        let avatarList: Array<{ user_key: string; avatar_url?: string }>;
        try { avatarList = JSON.parse(avatarRaw); } catch { avatarList = []; }
        for (const u of avatarList) {
          if (!u.avatar_url) continue;
          for (const [name, email] of Object.entries(pocEmails)) {
            if (email.split('@')[0] === u.user_key && !meegoAvatars[name]) {
              meegoAvatars[name] = u.avatar_url;
            }
          }
        }
      } catch { /* ignore */ }
    }
  } catch (e) {
    console.warn('[meego] avatar fetch failed:', e);
  }

  // Skip expensive lookups (version, Figma, AB report, chat, Libra) for
  // completed features — their links won't change and they don't need
  // package QR codes or chat searches.
  const isDone = overallStatusKey === 'end';

  // Fetch version from work item brief. Priority: launched > planned, lowest wins.
  // The MCP returns JSON now — extract version names from the work_item_fields array.
  let iosVersion = '';
  if (isDone) { /* skip version fetch for done features */ } else try {
    const versionFields = ['ios_actual_online_version', 'android_actual_online_version', 'field_08a9ca', 'field_c88970'];
    const versionRaw = await callMeegoMcp('get_workitem_brief', {
      url: meegoUrl,
      fields: versionFields,
    });

    function extractShortVersion(val: unknown): string[] {
      if (!val) return [];
      const items: Array<{ name?: string; id?: number }> = Array.isArray(val) ? val : [val];
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

    function pickLowest(a: string, b: string): string {
      if (!a) return b;
      if (!b) return a;
      const [aMaj, aMin] = a.split('.').map(Number);
      const [bMaj, bMin] = b.split('.').map(Number);
      return (aMaj - bMaj) || ((aMin ?? 0) - (bMin ?? 0)) <= 0 ? a : b;
    }

    // Try JSON parsing first (current MCP format)
    let launched = '';
    let planned = '';
    try {
      const vJson = JSON.parse(versionRaw) as { work_item_fields?: Array<{ key?: string; value?: unknown }> };
      const vFields = vJson.work_item_fields ?? [];
      const getVer = (key: string) => extractShortVersion(vFields.find(f => f.key === key)?.value);
      const iosL = getVer('ios_actual_online_version')[0] ?? '';
      const andL = getVer('android_actual_online_version')[0] ?? '';
      launched = pickLowest(iosL, andL);
      if (!launched) {
        const iosP = getVer('field_08a9ca')[0] ?? '';
        const andP = getVer('field_c88970')[0] ?? '';
        planned = pickLowest(iosP, andP);
      }
    } catch {
      // Legacy markdown fallback — extract version names via regex
      const nameRegex = /(\d+\.\d+)(?:\.\d+)?/g;
      const allVersions: string[] = [];
      let m: RegExpExecArray | null;
      while ((m = nameRegex.exec(versionRaw)) !== null) allVersions.push(m[1]);
      if (allVersions.length > 0) {
        allVersions.sort((a, b) => {
          const [aMaj, aMin] = a.split('.').map(Number);
          const [bMaj, bMin] = b.split('.').map(Number);
          return (aMaj - bMaj) || ((aMin ?? 0) - (bMin ?? 0));
        });
        planned = allVersions[0];
      }
    }
    iosVersion = launched || planned;
  } catch (e) {
    console.log('[meego] version fetch failed:', e);
  }

  // Extract Figma URL from the PRD (best-effort)
  let figmaUrl = '';
  if (!isDone && prd) {
    try {
      figmaUrl = await extractFigmaUrlFromPrd(prd);
    } catch { /* ignore — Figma link is optional */ }
  }

  // Libra URL may already be set from the JSON brief parsing above
  // (effect_analyze_link_t). If not, try the legacy markdown parse.
  if (!isDone && !libraUrl) {
    libraUrl = parseWorkItemField(raw, 'TikTok-T 实验链接');
  }

  // Search for AB report on Lark Drive (best-effort) — also extracts Libra URL as fallback
  let abReportUrl = '';
  if (!isDone && workItemName) {
    try {
      const abResult = await searchAbReport(workItemName, userAccessToken, prd);
      abReportUrl = abResult.abReportUrl;
      if (!libraUrl) libraUrl = abResult.libraUrl;
    } catch (e) {
      console.warn('[sync] AB report search error:', e);
    }
  }

  // Add bot to the feature's group chat and find package QR code.
  // Skip for done features — no need for chat/package/Libra lookups.
  // Only join groups for stories created in 2026+

  const createdAtRaw = parseWorkItemField(raw, '创建时间') || parseWorkItemField(raw, 'created_at');
  let createdYear = 0;
  if (createdAtRaw) {
    const ts = Number(createdAtRaw);
    if (!isNaN(ts) && ts > 0) {
      const ms = ts > 1e12 ? ts : ts * 1000;
      createdYear = new Date(ms).getFullYear();
    } else {
      const m = createdAtRaw.match(/(\d{4})/);
      if (m) createdYear = Number(m[1]);
    }
  }

  let packageQrUrl = '';
  let packageDownloadUrl = '';
  let iosPackageQrUrl = '';
  let iosPackageDownloadUrl = '';
  let chatId = cachedChatId ?? '';
  if (!isDone && workItemName) {
    try {
      if (!chatId) {
        chatId = (await joinFeatureChat(workItemName, userAccessToken, meegoUrl, createdYear < 2026)) ?? '';
      }
      if (chatId) {
        const pkg = await getPackageQrUrl(chatId);
        if (pkg?.android) {
          packageQrUrl = pkg.android.qrUrl;
          packageDownloadUrl = pkg.android.downloadUrl;
        }
        if (pkg?.ios) {
          iosPackageQrUrl = pkg.ios.qrUrl;
          iosPackageDownloadUrl = pkg.ios.downloadUrl;
        }
      }
      // Fallback: search chat for Libra link if not found in AB report
      if (!libraUrl && chatId) {
        try {
          libraUrl = await searchLibraInChat(chatId);
          console.warn(`[sync] "${workItemName}": libraFromChat=${libraUrl ? libraUrl.slice(0, 80) : 'empty'}, chatId=${chatId}`);
        } catch (e) {
          console.warn('[sync] Libra chat search error:', e);
        }
      } else if (libraUrl) {
        console.warn(`[sync] "${workItemName}": libra already resolved, skipping chat search`);
      } else {
        console.warn(`[sync] "${workItemName}": no chatId, skipping Libra chat search`);
      }
    } catch (e) {
      console.warn('[sync] join feature chat / package QR error:', e);
    }
  }

  return {
    status:      resolveDisplayStatus(overallStatusName),
    name:        workItemName,
    lastUpdated: parseUpdateTime(raw),
    owner,
    meegoNodeKey: best?.key ?? '',
    prd,
    figmaUrl,
    complianceUrl,
    priority,
    canCompleteNode,
    quarterlyCycle,
    businessLine,
    socialComponent,
    pmOwner,
    tpmOwner,
    techOwner,
    iosOwner,
    androidOwner,
    serverOwner,
    qaOwner,
    daOwner,
    uiuxOwner,
    contentDesigner,
    iosVersion,
    abReportUrl,
    libraUrl,
    packageQrUrl,
    packageDownloadUrl,
    iosPackageQrUrl,
    iosPackageDownloadUrl,
    chatId,
    pocEmails,
    meegoAvatars,
  };
}

export async function completeNode(
  projectKey: string,
  workItemId: string,
  nodeKey: string,
): Promise<void> {
  const response = await callMeegoMcp('transition_node', {
    project_key: projectKey,
    work_item_type: 'story',
    work_item_id: workItemId,
    node_id: nodeKey,
    action: 'confirm',
  });
  console.log('[meego] transition_node response:', response);
  // Check if the response text indicates an error
  const lower = response.toLowerCase();
  if (lower.includes('error') || lower.includes('fail') || lower.includes('不能') || lower.includes('无法')) {
    throw new Error(response.slice(0, 300));
  }
}

export interface CreateFeatureParams {
  name: string;
  priority: Priority;
  quarterlyCycleOptionId?: string;
  businessLineOptionId?: string;
  socialComponentOptionId?: string;
  roles: Array<{ role: string; owners: string[] }>;
}

export async function createFeature(params: CreateFeatureParams): Promise<{ id: string; meegoUrl: string }> {
  const fields: Array<{ field_key: string; field_value: string }> = [
    { field_key: 'template',  field_value: '207989' },
    { field_key: 'name',      field_value: params.name },
    { field_key: 'priority',  field_value: PRIORITY_TO_MEEGO[params.priority] },
  ];

  if (params.quarterlyCycleOptionId)
    fields.push({ field_key: 'field_675419', field_value: JSON.stringify([{ option_id: params.quarterlyCycleOptionId }]) });
  if (params.businessLineOptionId)
    fields.push({ field_key: 'field_a4c558', field_value: params.businessLineOptionId });
  if (params.socialComponentOptionId)
    fields.push({ field_key: 'field_2e7909', field_value: params.socialComponentOptionId });
  if (params.roles.length > 0)
    fields.push({ field_key: 'role_owners', field_value: JSON.stringify(params.roles) });

  // Fixed defaults
  fields.push({ field_key: 'field_40694f', field_value: JSON.stringify([{ option_id: 'mn088uae2' }]) }); // User Experience Type = Functional Iteration
  fields.push({ field_key: 'field_2177d5', field_value: 'true' }); // Need Event Tracking
  fields.push({ field_key: 'field_894cbf', field_value: 'true' }); // Need Content Design
  fields.push({ field_key: 'need_ab',      field_value: 'true' }); // Need AB Experiment
  fields.push({ field_key: 'field_391771', field_value: 'true' }); // Need UI/UX

  const raw = await callMeegoMcp('create_workitem', {
    project_key: TIKTOK_PROJECT_KEY,
    work_item_type: 'story',
    fields,
  });

  // Parse work_item_id from response (may be JSON or markdown text)
  let workItemId = '';
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    const nested = data.data as Record<string, unknown> | undefined;
    workItemId = String(data.work_item_id ?? nested?.work_item_id ?? '');
  } catch { /* fall through to regex */ }
  if (!workItemId) {
    const m = raw.match(/"?work_item_id"?\s*[:\s]+(\d+)/);
    if (m) workItemId = m[1];
  }
  if (!workItemId) throw new Error(`Could not parse work_item_id from response: ${raw}`);

  return {
    id: workItemId,
    meegoUrl: `https://meego.larkoffice.com/${TIKTOK_PROJECT_KEY}/story/detail/${workItemId}`,
  };
}

export async function updateFeatureFields(
  projectKey: string,
  workItemId: string,
  fields: { name?: string; prd?: string; priority?: Priority; figmaUrl?: string },
): Promise<void> {
  const updates: { field_key: string; field_value: string }[] = [];

  if (fields.name !== undefined)
    updates.push({ field_key: 'name', field_value: fields.name });

  if (fields.prd !== undefined)
    updates.push({ field_key: 'wiki', field_value: fields.prd });

  if (fields.priority !== undefined)
    updates.push({ field_key: 'priority', field_value: PRIORITY_TO_MEEGO[fields.priority] });

  if (fields.figmaUrl !== undefined)
    updates.push({ field_key: 'ui_design_zeplin_link', field_value: fields.figmaUrl });

  if (updates.length === 0) return;

  await callMeegoMcp('update_field', {
    project_key: projectKey,
    work_item_id: workItemId,
    fields: updates,
  });
}
