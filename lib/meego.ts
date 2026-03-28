import { Priority, Feature } from './types';

const MEEGO_MCP_URL = 'https://meego.larkoffice.com/mcp_server/v1';
const MY_EMAIL = 'thomas.oefverstroem@bytedance.com';
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

// Fetch priority, PRD and compliance URL for all of Thomas's TikTok stories in one MQL sweep
async function fetchExtendedFields(): Promise<Map<string, { priority: Priority; prd: string; complianceUrl: string }>> {
  const map = new Map<string, { priority: Priority; prd: string; complianceUrl: string }>();
  const MQL = 'SELECT `work_item_id`, `priority`, `wiki`, `field_due3fb` FROM `TikTok`.`需求` WHERE `__PM` = current_login_user()';
  const GROUP_ID = '1';
  let sessionId: string | undefined;
  let page = 1;

  while (true) {
    const args: Record<string, unknown> = sessionId
      ? { session_id: sessionId, group_pagination_list: [{ group_id: GROUP_ID, page_num: page }] }
      : { project_key: TIKTOK_PROJECT_KEY, mql: MQL };

    const raw = await callMeegoMcp('search_by_mql', args);
    let data: MqlResponse;
    try {
      data = JSON.parse(raw) as MqlResponse;
    } catch {
      throw new Error(`search_by_mql returned non-JSON: ${raw}`);
    }
    if (!sessionId) sessionId = data.session_id;

    const total = data.list?.[0]?.count ?? 0;
    const items = data.data?.[GROUP_ID] ?? [];

    for (const item of items) {
      let id = '';
      let priority: Priority = 'P2';
      let prd = '';
      let complianceUrl = '';

      for (const f of item.moql_field_list ?? []) {
        if (f.key === 'work_item_id') {
          id = String(f.value.long_value ?? '');
        } else if (f.key === 'priority') {
          const label = f.value.key_label_value?.label ?? '';
          if (/^P[0-3]$/.test(label)) priority = label as Priority;
        } else if (f.key === 'wiki') {
          prd = f.value.varchar_value ?? '';
        } else if (f.key === 'field_due3fb') {
          complianceUrl = f.value.varchar_value ?? '';
        }
      }

      if (id) map.set(id, { priority, prd, complianceUrl });
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
  // Fetch todo items and extended fields (priority, PRD, compliance) in parallel.
  // fetchExtendedFields uses search_by_mql which may not be available on all
  // MCP server versions — fall back to an empty map if it fails.
  const [allItems, extendedFields] = await Promise.all([
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
    fetchExtendedFields().catch(() =>
      new Map<string, { priority: Priority; prd: string; complianceUrl: string }>()
    ),
  ]);

  return allItems
    .filter(item =>
      item.project_key === projectKey &&
      item.work_item_info.work_item_type_key === 'story'
    )
    .map((item): Feature => {
      const ext = extendedFields.get(String(item.work_item_info.work_item_id));
      return {
        id: String(item.work_item_info.work_item_id),
        name: item.work_item_info.work_item_name,
        description: '',
        status: translateNode(item.node_info?.node_name ?? 'Unknown'),
        priority: ext?.priority ?? 'P2',
        owner: 'Thomas',
        tasks: [],
        lastUpdated: new Date().toISOString().split('T')[0],
        prd: ext?.prd || undefined,
        complianceUrl: ext?.complianceUrl || undefined,
        meegoProjectKey: item.project_key,
        meegoIssueId: String(item.work_item_info.work_item_id),
        meegoNodeKey: item.node_info?.node_state_key ?? '',
        meegoUrl: `https://meego.larkoffice.com/${item.project_key}/story/detail/${item.work_item_info.work_item_id}`,
      };
    });
}

export async function syncFeatureStatus(meegoUrl: string): Promise<{
  status: string;
  name: string;
  owner: string;
  meegoNodeKey: string;
  prd: string;
  complianceUrl: string;
  priority: Priority | null;
  canCompleteNode: boolean;
  quarterlyCycle: string;
  businessLine: string;
  socialComponent: string;
  techOwner: string;
  iosOwner: string;
  androidOwner: string;
  serverOwner: string;
  qaOwner: string;
  daOwner: string;
  uiuxOwner: string;
  contentDesigner: string;
}> {
  const raw = await callMeegoMcp('get_workitem_brief', {
    url: meegoUrl,
    fields: ['wiki', 'priority', 'field_due3fb', 'field_675419', 'field_a4c558', 'field_2e7909'],
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

  const quarterlyCycleRaw = parseWorkItemField(raw, '季度规划');
  let quarterlyCycle = quarterlyCycleRaw;
  try {
    const parsed = JSON.parse(quarterlyCycleRaw);
    if (Array.isArray(parsed)) quarterlyCycle = parsed.join(', ');
  } catch { /* keep raw value */ }
  const businessLine   = parseWorkItemField(raw, 'DM Business Line');
  const socialComponent = parseWorkItemField(raw, 'Social模块');

  const techOwner      = parseRoleMember(raw, 'Tech owner');
  const iosOwner       = parseRoleMember(raw, 'iOS');
  const androidOwner   = parseRoleMember(raw, 'Android');
  const serverOwner    = parseRoleMember(raw, 'Server');
  const qaOwner        = parseRoleMember(raw, 'QA');
  const daOwner        = parseRoleMember(raw, 'DA');
  const uiuxOwner      = parseRoleMember(raw, 'UI&UX');
  const contentDesigner = parseRoleMember(raw, 'Content Designer');

  return {
    status: best ? translateNode(best.name) : 'Unknown',
    name: workItemName,
    owner,
    meegoNodeKey: best?.key ?? '',
    prd,
    complianceUrl,
    priority,
    canCompleteNode,
    quarterlyCycle,
    businessLine,
    socialComponent,
    techOwner,
    iosOwner,
    androidOwner,
    serverOwner,
    qaOwner,
    daOwner,
    uiuxOwner,
    contentDesigner,
  };
}

export async function completeNode(
  projectKey: string,
  workItemId: string,
  nodeKey: string,
): Promise<void> {
  await callMeegoMcp('transition_node', {
    project_key: projectKey,
    work_item_id: workItemId,
    node_id: nodeKey,
    action: 'confirm',
  });
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
