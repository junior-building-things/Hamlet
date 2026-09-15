import { generateText } from './llm';
import { getPrompt, getPromptModel } from './prompts';
import { getPromptDef, renderPrompt } from './prompt-registry';
import { getLarkUserToken, readDocContentWithToken, searchLarkDocs } from './lark';
import type { PrdScaffold } from './lark';

const MAX_RELATED_DOCS = 5;
const MAX_DOC_CHARS = 6000;

async function renderRegistered(id: string, vars: Record<string, string>): Promise<{ prompt: string; model: string }> {
  const def = getPromptDef(id);
  const tmpl = await getPrompt(id, def?.default ?? '');
  const model = await getPromptModel(id, def?.model ?? 'claude-sonnet-5');
  return { prompt: renderPrompt(tmpl, vars), model };
}

function parseJson<T>(raw: string): T {
  return JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')) as T;
}

/** Search Lark for existing PRDs / tech designs / AB reports in the same area and return their text. */
async function findRelatedDocs(featureName: string, description: string): Promise<string> {
  const token = await getLarkUserToken();
  if (!token) return '';
  const { prompt, model } = await renderRegistered('hamlet.prd_research_queries', { featureName, description });
  const queries = parseJson<unknown[]>(await generateText(prompt, { model, label: 'prd-research-queries' }))
    .filter((q): q is string => typeof q === 'string' && !!q.trim())
    .slice(0, 4);

  const seen = new Set<string>();
  const docs: Array<{ title: string; url: string }> = [];
  for (const q of queries) {
    for (const d of (await searchLarkDocs(q, token)).slice(0, 3)) {
      if (seen.has(d.url) || /template/i.test(d.title)) continue;
      seen.add(d.url);
      docs.push(d);
    }
  }
  console.log(`[prd-scaffold] "${featureName}": queries=${JSON.stringify(queries)} docs=${JSON.stringify(docs.slice(0, MAX_RELATED_DOCS).map(d => d.title))}`);

  const bodies = await Promise.all(docs.slice(0, MAX_RELATED_DOCS).map(async d => {
    try {
      return `### ${d.title}\n${(await readDocContentWithToken(d.url, token)).slice(0, MAX_DOC_CHARS)}`;
    } catch {
      return '';
    }
  }));
  return bodies.filter(Boolean).join('\n\n');
}

/**
 * Research related docs, then propose a concise description, Requirement detail
 * scenarios (with Interactions/logic aspects) and an A/B setup.
 */
export async function generatePrdScaffold(featureName: string, description: string): Promise<PrdScaffold | null> {
  const relatedDocs = await findRelatedDocs(featureName, description).catch(e => {
    console.warn('[prd-scaffold] related-doc research failed:', e);
    return '';
  });
  try {
    const { prompt, model } = await renderRegistered('hamlet.prd_scaffold', {
      featureName, description, relatedDocs: relatedDocs || '(none found)',
    });
    const json = parseJson<Partial<PrdScaffold>>(await generateText(prompt, { model, label: 'prd-scaffold' }));
    const requirements = (json.requirements ?? [])
      .filter(r => r && typeof r.scenario === 'string' && r.scenario.trim())
      .map(r => ({ scenario: r.scenario, logic: (Array.isArray(r.logic) ? r.logic : []).filter((l): l is string => typeof l === 'string' && !!l.trim()).slice(0, 8) }))
      .slice(0, 6);
    const abGroups = (json.abGroups ?? [])
      .filter(g => g && typeof g.group === 'string')
      .map(g => ({ group: g.group, treatment: String(g.treatment ?? ''), traffic: String(g.traffic ?? '') }))
      .slice(0, 4);
    const concise = typeof json.description === 'string' && json.description.trim() ? json.description.trim() : undefined;
    return requirements.length || abGroups.length || concise ? { description: concise, requirements, abGroups } : null;
  } catch (e) {
    console.warn('[prd-scaffold] generation failed:', e);
    return null;
  }
}
