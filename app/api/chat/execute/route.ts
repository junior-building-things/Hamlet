import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createFeature, fetchUserStories, completeNode, updateFeatureFields } from '@/lib/meego';
import { copyPrdTemplate, readDocContent, editDocSection, addDocComment, listDocComments, replyToComment, duplicateDoc } from '@/lib/lark';
import type { Feature } from '@/lib/types';

const PROJECT_KEY   = '5f105019a8b9a853da64767f';
const MEEGO_MCP_URL = 'https://meego.larkoffice.com/mcp_server/v1';

async function callMeego(tool: string, args: Record<string, unknown>): Promise<string> {
  const token = process.env.MEEGO_USER_TOKEN;
  if (!token) throw new Error('MEEGO_USER_TOKEN not configured');
  const res  = await fetch(MEEGO_MCP_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'X-Mcp-Token': token },
    body:    JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name: tool, arguments: args } }),
  });
  if (!res.ok) throw new Error(`Meego HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(`Meego error: ${data.error.message}`);
  return data.result?.content?.[0]?.text ?? '';
}

function parseNodes(raw: string): Array<{ key: string; name: string }> {
  const section = raw.split('# 进行中的节点')[1] ?? '';
  return section.split('\n')
    .filter(l => l.startsWith('|') && !l.includes('---') && !l.includes('节点 ID'))
    .flatMap(line => {
      const parts = line.split('|').map(p => p.trim()).filter(Boolean);
      return parts.length >= 2 ? [{ key: parts[0], name: parts[1] }] : [];
    });
}

const NODE_TRANSLATIONS: Record<string, string> = {
  '产品需求准备': 'Requirements Prep', '产品线内初评': 'Initial Review',
  '技术评估&排优': 'Tech Assessment',  '需求详评':    'Detailed Review',
  '需求评审':    'Requirements Review', '技术方案设计': 'Technical Design',
  'iOS 开发':    'iOS Development',     'UI&UX验收':   'UI/UX Acceptance',
  'Server上线':  'Server Launch',       'AB实验':      'AB Testing',
  '结束':        'Done',               'PM验收':      'PM Acceptance',
  'PM走查':      'PM Walkthrough',     '依赖判断':    'Dependency Check',
  '合规评估':    'Compliance Review',
};

export async function POST(req: NextRequest) {
  const { action, params } = await req.json() as {
    action: string;
    params: Record<string, string>;
  };

  try {
    // ── Create Feature ────────────────────────────────────────────────────────
    if (action === 'create_feature' && params.featureName) {
      const created = await createFeature({ name: params.featureName, priority: 'P2', roles: [] });

      let prd: string | undefined;
      try {
        prd = await copyPrdTemplate(params.featureName);
        await updateFeatureFields(PROJECT_KEY, created.id, { prd });
      } catch { /* best-effort */ }

      const feature: Feature = {
        id:          created.id,
        name:        params.featureName,
        description: '',
        status:      'Backlog',
        priority:    'P2',
        owner:       '',
        tasks:       [],
        lastUpdated: new Date().toISOString().slice(0, 10),
        meegoUrl:    created.meegoUrl,
        prd,
      };

      const links = [
        prd              && { label: '📄 PRD',   url: prd },
        created.meegoUrl && { label: '🎯 Meego', url: created.meegoUrl },
      ].filter(Boolean) as { label: string; url: string }[];

      return NextResponse.json({
        reply:  `"${params.featureName}" has been created!`,
        action: 'create_feature',
        feature,
        links,
      });
    }

    // ── Create PRD ────────────────────────────────────────────────────────────
    if (action === 'create_prd' && (params.featureName || params.featureId)) {
      const name = params.featureName ?? `Feature ${params.featureId}`;
      const isHalfDay = String(params.useHalfDayPrd) === 'true';
      const prd  = await copyPrdTemplate(name, undefined, { useHalfDayPrd: isHalfDay });
      if (params.featureId) await updateFeatureFields(PROJECT_KEY, params.featureId, { prd });
      const prdType = isHalfDay ? 'Half-Day PRD' : 'PRD';
      return NextResponse.json({
        reply: `The ${prdType} for "${name}" is ready!`,
        links: [{ label: `📄 ${prdType}`, url: prd }],
      });
    }

    // ── Query Meego ───────────────────────────────────────────────────────────
    if (action === 'query_meego' && (params.featureName || params.featureId) && params.query) {
      let workItemId = params.featureId;
      if (!workItemId && params.featureName) {
        const features = await fetchUserStories(PROJECT_KEY);
        const term     = params.featureName.toLowerCase();
        const match    = features.find(f =>
          f.name.toLowerCase().includes(term) || term.includes(f.name.toLowerCase())
        );
        if (!match) {
          // fallback: try MQL search
          try {
            const mqlResult = await callMeego('search_by_mql', {
              project_key: PROJECT_KEY,
              mql: `name contains "${params.featureName}"`,
              page_size: 5,
            });
            // parse first workitem id from result
            const idMatch = mqlResult.match(/work_item_id[^\d]*(\d+)/i) ?? mqlResult.match(/\b(\d{6,})\b/);
            if (idMatch) {
              workItemId = idMatch[1];
            }
          } catch { /* ignore */ }
        } else {
          workItemId = match.id;
        }
      }
      if (!workItemId) {
        return NextResponse.json({ reply: `I couldn't find a feature matching "${params.featureName}" in Meego. Could you double-check the name or share the Meego ID?` });
      }

      const brief = await callMeego('get_workitem_brief', { project_key: PROJECT_KEY, work_item_id: workItemId });

      // Use Gemini to answer the user's question from the raw brief
      const apiKey = process.env.GOOGLE_AI_API_KEY;
      if (!apiKey) throw new Error('GOOGLE_AI_API_KEY not set');
      const genAI  = new GoogleGenerativeAI(apiKey);
      const model  = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite-preview' });
      const prompt = `You are Hamlet, a helpful PM assistant. Below is the raw Meego work item brief for a feature. Answer the user's question concisely and naturally based only on the information in the brief. If the answer is not present in the brief, say so honestly.

User's question: ${params.query}

Meego brief:
${brief}`;
      const result  = await model.generateContent(prompt);
      const answer  = result.response.text().trim();
      return NextResponse.json({ reply: answer });
    }

    // ── Complete Node ─────────────────────────────────────────────────────────
    if (action === 'complete_node' && (params.featureName || params.featureId)) {
      let workItemId = params.featureId;
      if (!workItemId && params.featureName) {
        const features = await fetchUserStories(PROJECT_KEY);
        const term     = params.featureName.toLowerCase();
        const match    = features.find(f =>
          f.name.toLowerCase().includes(term) || term.includes(f.name.toLowerCase())
        );
        if (!match) return NextResponse.json({ reply: `I couldn't find a feature matching "${params.featureName}". Could you share the Meego ID?` });
        workItemId = match.id;
      }
      const brief = await callMeego('get_workitem_brief', { project_key: PROJECT_KEY, work_item_id: workItemId });
      const nodes = parseNodes(brief);
      if (nodes.length === 0) return NextResponse.json({ reply: `There are no active nodes on that feature right now.` });

      const targetName = params.nodeName?.toLowerCase();
      const node = targetName
        ? (nodes.find(n => {
            const en = NODE_TRANSLATIONS[n.name]?.toLowerCase() ?? '';
            return n.name.toLowerCase().includes(targetName) || en.includes(targetName);
          }) ?? nodes[0])
        : nodes[0];

      await completeNode(PROJECT_KEY, workItemId!, node.key);
      const displayName = NODE_TRANSLATIONS[node.name] ?? node.name;
      return NextResponse.json({ reply: `"${displayName}" has been marked as complete! ✅`, action: 'complete_node' });
    }

    // ── Read Doc ──────────────────────────────────────────────────────────────
    if (action === 'read_doc' && params.docUrl) {
      const content = await readDocContent(params.docUrl);

      const apiKey = process.env.GOOGLE_AI_API_KEY;
      if (!apiKey) return NextResponse.json({ reply: content, links: [{ label: '📄 Doc', url: params.docUrl }] });

      const genAI  = new GoogleGenerativeAI(apiKey);
      const model  = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite-preview' });
      const prompt = `You are Hamlet, a helpful PM assistant. Below is the content of a Lark document. Provide a clear, concise summary highlighting the key points, structure, and any action items.\n\nDocument content:\n${content.slice(0, 8000)}`;
      const result = await model.generateContent(prompt);
      const summary = result.response.text().trim();
      return NextResponse.json({ reply: summary, links: [{ label: '📄 Doc', url: params.docUrl }] });
    }

    // ── Edit Doc ─────────────────────────────────────────────────────────────
    if (action === 'edit_doc' && params.docUrl && params.section && params.content) {
      await editDocSection(params.docUrl, params.section, params.content);
      return NextResponse.json({
        reply: `Updated the "${params.section}" section!`,
        links: [{ label: '📄 Doc', url: params.docUrl }],
      });
    }

    // ── Comment Doc ──────────────────────────────────────────────────────────
    if (action === 'comment_doc' && params.docUrl && params.commentText) {
      await addDocComment(params.docUrl, params.commentText, params.section);
      const where = params.section ? ` on the "${params.section}" section` : '';
      return NextResponse.json({
        reply: `Comment added${where}!`,
        links: [{ label: '📄 Doc', url: params.docUrl }],
      });
    }

    // ── Reply to Comment ──────────────────────────────────────────────────────
    if (action === 'reply_comment' && params.docUrl && params.replyText && params.commentSearch) {
      const comments = await listDocComments(params.docUrl, params.commentSearch);
      if (comments.length === 0) {
        return NextResponse.json({
          reply: `I couldn't find a comment matching "${params.commentSearch}" on that doc.`,
          links: [{ label: '📄 Doc', url: params.docUrl }],
        });
      }
      const target = comments[0];
      await replyToComment(params.docUrl, target.commentId, params.replyText);
      const preview = target.content.slice(0, 80);
      return NextResponse.json({
        reply: `Replied to the comment "${preview}${target.content.length > 80 ? '…' : ''}"!`,
        links: [{ label: '📄 Doc', url: params.docUrl }],
      });
    }

    // ── Duplicate Doc ────────────────────────────────────────────────────────
    if (action === 'duplicate_doc' && params.docUrl) {
      const newUrl = await duplicateDoc(params.docUrl, params.featureName);
      return NextResponse.json({
        reply: `Doc duplicated!`,
        links: [{ label: '📄 Copy', url: newUrl }],
      });
    }

  } catch (err) {
    return NextResponse.json({ reply: `Something went wrong: ${err instanceof Error ? err.message : 'Unknown error'}` });
  }

  return NextResponse.json({ reply: 'Done!' });
}
