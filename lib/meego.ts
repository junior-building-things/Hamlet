import { Priority, Feature } from './types';

const MEEGO_MCP_URL = 'https://meego.larkoffice.com/mcp_server/v1';
const MY_EMAIL = 'thomas.oefverstroem@bytedance.com';

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
  const nodeLines = nodeSection
    .split('\n')
    .filter(l => l.startsWith('|') && !l.includes('---') && !l.includes('节点 ID'));

  return nodeLines.flatMap(line => {
    const parts = line.split('|').map(p => p.trim()).filter(Boolean);
    if (parts.length >= 3) return [{ key: parts[0], name: parts[1], owners: parts[2] }];
    return [];
  });
}

interface MeegoTodoItem {
  work_item_info: { work_item_id: number; work_item_type_key: string; work_item_name: string };
  project_key: string;
  project_name: string;
  schedule: { start_time: string; end_time: string };
  node_info: { node_name: string; node_state_key: string };
}

interface MeegoTodoResponse {
  total: number;
  list: MeegoTodoItem[];
}

export async function fetchUserStories(projectKey: string): Promise<Feature[]> {
  const allItems: MeegoTodoItem[] = [];
  let page = 1;
  while (true) {
    let data: MeegoTodoResponse;
    try {
      const raw = await callMeegoMcp('list_todo', { action: 'todo', page_num: page });
      data = JSON.parse(raw) as MeegoTodoResponse;
    } catch {
      throw new Error(`Failed to parse Meego list_todo response (page ${page})`);
    }
    allItems.push(...(data.list ?? []));
    if (allItems.length >= data.total) break;
    page++;
  }

  return allItems
    .filter(item =>
      item.project_key === projectKey &&
      item.work_item_info.work_item_type_key === 'story'
    )
    .map((item): Feature => ({
      id: String(item.work_item_info.work_item_id),
      name: item.work_item_info.work_item_name,
      description: '',
      status: translateNode(item.node_info?.node_name ?? 'Unknown'),
      priority: 'P2',
      owner: 'Thomas',
      tasks: [],
      lastUpdated: new Date().toISOString().split('T')[0],
      meegoProjectKey: item.project_key,
      meegoIssueId: String(item.work_item_info.work_item_id),
      meegoNodeKey: item.node_info?.node_state_key ?? '',
      meegoUrl: `https://meego.larkoffice.com/${item.project_key}/story/detail/${item.work_item_info.work_item_id}`,
    }));
}

export async function syncFeatureStatus(meegoUrl: string): Promise<{ status: string; name: string; owner: string; meegoNodeKey: string }> {
  const raw = await callMeegoMcp('get_workitem_brief', { url: meegoUrl });

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

  const activeNodes = parseActiveNodes(raw);
  const best = pickNode(activeNodes.map(n => ({ key: n.key, name: n.name })));

  return {
    status: best ? translateNode(best.name) : 'Unknown',
    name: workItemName,
    owner,
    meegoNodeKey: best?.key ?? '',
  };
}

export async function getNodeInfo(meegoUrl: string): Promise<{
  nodeKey: string;
  nodeName: string;
  canComplete: boolean;
  prd: string;
}> {
  const raw = await callMeegoMcp('get_workitem_brief', { url: meegoUrl });

  // Extract PRD link from fields section
  let prd = '';
  for (const line of raw.split('\n')) {
    const match = line.match(/\|\s*PRD\s*\|\s*(https?:\/\/[^\s|]+)/);
    if (match) { prd = match[1].trim(); break; }
  }

  const activeNodes = parseActiveNodes(raw);
  const best = pickNode(activeNodes.map(n => ({ key: n.key, name: n.name })));
  if (!best) return { nodeKey: '', nodeName: '', canComplete: false, prd };

  const bestWithOwners = activeNodes.find(n => n.key === best.key);
  const canComplete = bestWithOwners?.owners.includes(MY_EMAIL) ?? false;

  return {
    nodeKey: best.key,
    nodeName: translateNode(best.name),
    canComplete,
    prd,
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
