import { Priority, Feature } from './types';

const MEEGO_MCP_URL = 'https://meego.larkoffice.com/mcp_server/v1';

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
  const raw = await callMeegoMcp('list_todo', {
    work_item_type_key: 'story',
    action_type: 'created',
  });

  let data: MeegoTodoResponse;
  try {
    data = JSON.parse(raw) as MeegoTodoResponse;
  } catch {
    throw new Error('Failed to parse Meego list_todo response');
  }

  return (data.list ?? [])
    .filter(item =>
      item.project_key === projectKey &&
      item.work_item_info.work_item_type_key === 'story'
    )
    .map((item): Feature => ({
      id: String(item.work_item_info.work_item_id),
      name: item.work_item_info.work_item_name,
      description: '',
      status: item.node_info?.node_name ?? 'Unknown',
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

  // Extract the current active node name
  const nodeSection = raw.split('# 进行中的节点')[1] ?? '';
  const nodeLines = nodeSection.split('\n').filter((l: string) => l.startsWith('|') && !l.includes('---') && !l.includes('节点 ID'));
  if (nodeLines.length > 0) {
    const firstNodeMatch = nodeLines[0].match(/\|\s*\S+\s*\|\s*(.+?)\s*\|/);
    if (firstNodeMatch) currentNode = firstNodeMatch[1].trim();
  }

  return { status: currentNode || 'Unknown', name: workItemName, owner };
}

export { mapMeegoPriority };
