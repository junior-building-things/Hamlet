import { generateText } from './llm';
import { getPrompt, getPromptModel } from './prompts';
import { getPromptDef, renderPrompt } from './prompt-registry';
import type { PrdScaffold } from './lark';

/** Propose Requirement detail scenarios (with logic aspect labels) + an A/B setup from the feature description. */
export async function generatePrdScaffold(featureName: string, description: string): Promise<PrdScaffold | null> {
  const def = getPromptDef('hamlet.prd_scaffold');
  const tmpl = await getPrompt('hamlet.prd_scaffold', def?.default ?? '');
  const model = await getPromptModel('hamlet.prd_scaffold', def?.model ?? 'claude-sonnet-5');
  try {
    const raw = await generateText(renderPrompt(tmpl, { featureName, description }), { model, label: 'prd-scaffold' });
    const json = JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')) as Partial<PrdScaffold>;
    const requirements = (json.requirements ?? [])
      .filter(r => r && typeof r.scenario === 'string' && r.scenario.trim())
      .map(r => ({ scenario: r.scenario, logic: (Array.isArray(r.logic) ? r.logic : []).filter((l): l is string => typeof l === 'string' && !!l.trim()).slice(0, 8) }))
      .slice(0, 6);
    const abGroups = (json.abGroups ?? [])
      .filter(g => g && typeof g.group === 'string')
      .map(g => ({ group: g.group, treatment: String(g.treatment ?? ''), traffic: String(g.traffic ?? '') }))
      .slice(0, 4);
    return requirements.length || abGroups.length ? { requirements, abGroups } : null;
  } catch (e) {
    console.warn('[prd-scaffold] generation failed:', e);
    return null;
  }
}
