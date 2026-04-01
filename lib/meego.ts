import { Priority, Feature } from './types';
import { extractFigmaUrlFromPrd, searchAbReport, joinFeatureChat, getPackageQrUrl } from './lark';

const MEEGO_MCP_URL = 'https://meego.larkoffice.com/mcp_server/v1';
const MY_EMAIL = process.env.OWNER_EMAIL!;
const TIKTOK_PROJECT_KEY = '5f105019a8b9a853da64767f';

// Ordered priority list — when multiple nodes are active, pick the highest one
const NODE_PRIORITY = [
  '产品需求准备',
  '产品线内初评',
  '技术评估&排优',
  '需求详评',
  '技术方案设计',
  'iOS 开发',
  'UI&UX验收',
  'Server上线',
  'AB实验',
  '结束',
];

const NODE_TRANSLATIONS: Record<string, string> = {
  '产品需求准备':  'Requirements Prep',
  '产品线内初评':  'Initial Review',
  '技术评估&排优': 'Tech Assessment',
  '需求详评':     'Detailed Review',
  '需求评审':     'Requirements Review',
  '技术方案设计':  'Technical Design',
  'iOS 开发':     'iOS Development',
  'UI&UX验收':    'UI/UX Acceptance',
  'Server上线':   'Server Launch',
  'AB实验':       'AB Testing',
  '结束':         'Done',
  'PM验收':       'PM Acceptance',
  'PM走查':       'PM Walkthrough',
  '依赖判断':     'Dependency Check',
  '合规评估':     'Compliance Review',
};

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

function pickNode(nodes: Array<{ key: string; name: string }>): { key: string; name: string } | null {
  if (nodes.length === 0) return null;
  return nodes.slice().sort((a, b) => {
    const ia = NODE_PRIORITY.indexOf(a.name);
    const ib = NODE_PRIORITY.indexOf(b.name);
    return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib);
  })[0];
}

async function callMeegoMcp(toolName: string, args: Record<string, unknown>) {
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
function extractNames(value: string): string {
  if (!value || value === '未填写') return '';
  const names: string[] = [];
  const regex = /([^,(]+)\([^)]*\)/g;
  let m;
  while ((m = regex.exec(value)) !== null) {
    const name = m[1].trim();
    if (name) names.push(name);
  }
  return names.length > 0 ? names.join(', ') : value;
}

// Extract name→email pairs from role member value "Name1(email1),Name2(email2)"
function extractNameEmailPairs(value: string): Array<{ name: string; email: string }> {
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

interface ExtendedFields { priority: Priority; prd: string; complianceUrl: string; lastUpdated: string; name: string; status: string; nodeKey: string }

// Fetch all PM-owned TikTok stories via MQL — returns every story regardless of todo status
async function fetchAllOwnedStories(): Promise<Map<string, ExtendedFields>> {
  const map = new Map<string, ExtendedFields>();
  const MQL = 'SELECT `work_item_id`, `name`, `priority`, `wiki`, `field_due3fb`, `updated_at` FROM `TikTok`.`需求` WHERE `__PM` = current_login_user()';
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

      if (id) map.set(id, { priority, prd, complianceUrl, lastUpdated, name, status: 'Unknown', nodeKey: '' });
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
      meegoProjectKey: item.project_key,
      meegoIssueId: id,
      meegoNodeKey: item.node_info?.node_state_key ?? '',
      meegoUrl: `https://meego.larkoffice.com/${item.project_key}/story/detail/${item.work_item_info.work_item_id}`,
    });
  }

  // Add stories from MQL that weren't in the todo list
  for (const [id, ext] of allOwned) {
    if (todoIds.has(id)) continue;
    features.push({
      id,
      name: ext.name,
      description: '',
      status: ext.status,
      priority: ext.priority,
      owner: 'Thomas',
      tasks: [],
      lastUpdated: ext.lastUpdated || new Date().toISOString().split('T')[0],
      prd: ext.prd || undefined,
      complianceUrl: ext.complianceUrl || undefined,
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
  packageQrUrl: string;
  packageDownloadUrl: string;
  chatId: string;
  pocEmails: Record<string, string>;
}> {
  const raw = await callMeegoMcp('get_workitem_brief', {
    url: meegoUrl,
    fields: ['wiki', 'priority', 'field_due3fb', 'field_532e61', 'field_a4c558', 'field_2e7909', 'created_at'],
  });

  const lines = raw.split('\n');
  let workItemName = '';
  let owner = '';

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

  const prd = parseWorkItemField(raw, 'PRD');
  const complianceUrl = parseWorkItemField(raw, '合规评估工单链接');

  // Parse priority option name (P0–P3)
  const priorityRaw = parseWorkItemField(raw, '优先级');
  const priority: Priority | null = /^P[0-3]$/.test(priorityRaw) ? priorityRaw as Priority : null;

  const activeNodes = parseActiveNodes(raw);
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

  const pmOwner        = parseRoleMember(raw, 'PM');
  const tpmOwner       = parseRoleMember(raw, 'TPM');
  const techOwner      = parseRoleMember(raw, 'Tech owner');
  const iosOwner       = parseRoleMember(raw, 'iOS');
  const androidOwner   = parseRoleMember(raw, 'Android');
  const serverOwner    = parseRoleMember(raw, 'Server');
  const qaOwner        = parseRoleMember(raw, 'QA');
  const daOwner        = parseRoleMember(raw, 'DA');
  const uiuxOwner      = parseRoleMember(raw, 'UI&UX');
  const contentDesigner = parseRoleMember(raw, 'Content Designer');

  // Collect name→email pairs for avatar resolution
  const pocEmails = Object.fromEntries(collectAllPocEmails(raw));

  // Fetch planned version from node detail JSON
  // Try iOS (field_08a9ca) first, fall back to Android (field_c88970)
  let iosVersion = '';
  try {
    const nodeRaw = await callMeegoMcp('get_node_detail', { url: meegoUrl });
    interface NodeFormItem { field_key?: string; field_name?: string; value?: string; value_label?: string }
    interface NodeEntry { basic?: { node_key?: string; name?: string }; form_items?: NodeFormItem[] }
    const nodeData = JSON.parse(nodeRaw) as { list?: NodeEntry[] };

    // Collect work item IDs for a given field key across all nodes
    function collectVersionIds(fieldKey: string): number[] {
      const ids: number[] = [];
      for (const node of nodeData.list ?? []) {
        for (const fi of node.form_items ?? []) {
          if (fi.field_key === fieldKey) {
            if (fi.value_label) return []; // handled separately
            try {
              const parsed = JSON.parse(fi.value ?? '[]') as number[];
              for (const id of parsed) { if (!ids.includes(id)) ids.push(id); }
            } catch { /* skip */ }
          }
        }
      }
      return ids;
    }

    function getValueLabel(fieldKey: string): string {
      for (const node of nodeData.list ?? []) {
        for (const fi of node.form_items ?? []) {
          if (fi.field_key === fieldKey && fi.value_label) return fi.value_label;
        }
      }
      return '';
    }

    // Resolve work item IDs to the lowest short version name
    async function resolveVersion(fieldKey: string): Promise<string> {
      const label = getValueLabel(fieldKey);
      if (label) return label;
      const ids = collectVersionIds(fieldKey);
      if (ids.length === 0) return '';
      const names: string[] = [];
      for (const id of ids) {
        try {
          const briefRaw = await callMeegoMcp('get_workitem_brief', {
            url: `https://meego.larkoffice.com/${TIKTOK_PROJECT_KEY}/version/detail/${id}`,
          });
          const nameMatch = briefRaw.match(/工作项名称\s*\|\s*([^|\n]+)/);
          if (nameMatch) names.push(nameMatch[1].trim());
        } catch { /* skip */ }
      }
      const shortNames = names.map(n => {
        const m = n.match(/(\d+\.\d+)(?:\.\d+)?$/);
        return m ? m[1] : n;
      });
      if (shortNames.length === 0) return '';
      shortNames.sort((a, b) => {
        const [aMaj, aMin] = a.split('.').map(Number);
        const [bMaj, bMin] = b.split('.').map(Number);
        return (aMaj - bMaj) || ((aMin ?? 0) - (bMin ?? 0));
      });
      return shortNames[0];
    }

    iosVersion = await resolveVersion('field_08a9ca');
    if (!iosVersion) iosVersion = await resolveVersion('field_c88970');

  } catch (e) {
    console.log('[meego] version fetch failed:', e);
  }

  // Extract Figma URL from the PRD (best-effort)
  let figmaUrl = '';
  if (prd) {
    try {
      figmaUrl = await extractFigmaUrlFromPrd(prd);
    } catch { /* ignore — Figma link is optional */ }
  }

  // Search for AB report on Lark Drive (best-effort)
  let abReportUrl = '';
  if (workItemName) {
    try {
      abReportUrl = await searchAbReport(workItemName, userAccessToken);
    } catch (e) {
      console.warn('[sync] AB report search error:', e);
    }
  }

  // Add bot to the feature's group chat and find package QR code
  // Only join groups for stories created in 2026+
  // Debug: search for MR/Bits references in brief
  const mrRefs = raw.match(/.{0,30}(mr_iid|mr_id|merge_request|MR|bits\.bytedance|code\.byted|iid|devops).{0,80}/gi);
  if (mrRefs?.length) console.log('[meego] MR refs in brief:', mrRefs.slice(0, 10));

  // Also search node detail for MR references
  try {
    const nodeRaw = await callMeegoMcp('get_node_detail', { url: meegoUrl });
    const nodeRefs = nodeRaw.match(/.{0,30}(mr_iid|mr_id|merge_request|MR|bits\.bytedance|code\.byted|iid|devops).{0,80}/gi);
    if (nodeRefs?.length) console.log('[meego] MR refs in nodes:', nodeRefs.slice(0, 10));

    // Search sub_tasks specifically
    const subTaskRefs = nodeRaw.match(/.{0,30}(sub_task|subtask).{0,200}/gi);
    if (subTaskRefs?.length) console.log('[meego] sub_tasks:', subTaskRefs.slice(0, 3));
  } catch { /* ignore */ }

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
  let chatId = cachedChatId ?? '';
  if (workItemName) {
    try {
      // Search for chat (and join if 2026+), skip join for older stories
      if (!chatId) {
        chatId = (await joinFeatureChat(workItemName, userAccessToken, meegoUrl, createdYear < 2026)) ?? '';
      }
      // Fetch package QR if we have a chatId (regardless of creation year)
      if (chatId) {
        const pkg = await getPackageQrUrl(chatId);
        if (pkg) {
          packageQrUrl = pkg.qrUrl;
          packageDownloadUrl = pkg.downloadUrl;
        }
      }
    } catch (e) {
      console.warn('[sync] join feature chat / package QR error:', e);
    }
  }

  return {
    status:      best ? translateNode(best.name) : 'Unknown',
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
    packageQrUrl,
    packageDownloadUrl,
    chatId,
    pocEmails,
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
  fields: { name?: string; prd?: string; priority?: Priority },
): Promise<void> {
  const updates: { field_key: string; field_value: string }[] = [];

  if (fields.name !== undefined)
    updates.push({ field_key: 'name', field_value: fields.name });

  if (fields.prd !== undefined)
    updates.push({ field_key: 'wiki', field_value: fields.prd });

  if (fields.priority !== undefined)
    updates.push({ field_key: 'priority', field_value: PRIORITY_TO_MEEGO[fields.priority] });

  if (updates.length === 0) return;

  await callMeegoMcp('update_field', {
    project_key: projectKey,
    work_item_id: workItemId,
    fields: updates,
  });
}
