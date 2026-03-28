import { Priority, Feature } from './types';

const MEEGO_MCP_URL = 'https://meego.larkoffice.com/mcp_server/v1';

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

export function translateNode(node: string): string {
  return NODE_TRANSLATIONS[node] ?? node;
}

function pickNode(nodes: string[]): string {
  if (nodes.length === 0) return '';
  return nodes.slice().sort((a, b) => {
    const ia = NODE_PRIORITY.indexOf(a);
    const ib = NODE_PRIORITY.indexOf(b);
    return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib);
  })[0];
}

function mapMeegoPriority(priority?: string): Priority {
  if (!priority) return 'Medium';
  const p = priority.toLowerCase();
  if (p.includes('critical') || p.includes('p0')) return 'Critical';
  if (p.includes('high') || p.includes('p1')) return 'High';
  if (p.includes('low') || p.includes('p3')) return 'Low';
  return 'Medium';
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
  // Paginate through all pages (50 items per page)
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
      priority: 'Medium',
      owner: 'Thomas',
      tasks: [],
      lastUpdated: new Date().toISOString().split('T')[0],
      meegoProjectKey: item.project_key,
      meegoIssueId: String(item.work_item_info.work_item_id),
      meegoUrl: `https://meego.larkoffice.com/${item.project_key}/story/detail/${item.work_item_info.work_item_id}`,
    }));
}

export async function syncFeatureStatus(meegoUrl: string): Promise<{ status: string; name: string; owner: string }> {
  const raw = await callMeegoMcp('get_workitem_brief', { url: meegoUrl });

  // Parse markdown table from the response
  const lines = raw.split('\n');
  let workItemName = '';
  let currentNode = '';
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

  // Extract all active node names and pick the highest-priority one
  const nodeSection = raw.split('# 进行中的节点')[1] ?? '';
  const nodeLines = nodeSection.split('\n').filter((l: string) => l.startsWith('|') && !l.includes('---') && !l.includes('节点 ID'));
  const activeNodes: string[] = [];
  for (const line of nodeLines) {
    const match = line.match(/\|\s*\S+\s*\|\s*(.+?)\s*\|/);
    if (match) activeNodes.push(match[1].trim());
  }
  currentNode = pickNode(activeNodes);

  return { status: translateNode(currentNode) || 'Unknown', name: workItemName, owner };
}

const PRIORITY_TO_MEEGO: Record<string, string> = {
  Critical: '0', // P0
  High:     '1', // P1
  Medium:   '2', // P2
  Low:      '3', // P3
};

export async function updateFeatureFields(
  projectKey: string,
  workItemId: string,
  fields: { name?: string; description?: string; priority?: string },
): Promise<void> {
  const updates: { field_key: string; field_value: string }[] = [];

  if (fields.name !== undefined)
    updates.push({ field_key: 'name', field_value: fields.name });

  if (fields.description !== undefined)
    updates.push({ field_key: 'description', field_value: fields.description });

  if (fields.priority !== undefined && PRIORITY_TO_MEEGO[fields.priority])
    updates.push({ field_key: 'priority', field_value: PRIORITY_TO_MEEGO[fields.priority] });

  if (updates.length === 0) return;

  await callMeegoMcp('update_field', {
    project_key: projectKey,
    work_item_id: workItemId,
    fields: updates,
  });
}

export { mapMeegoPriority };
