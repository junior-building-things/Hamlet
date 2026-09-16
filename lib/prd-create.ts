import { updateFeatureFields, getComplianceUrl, getStoryPrdUrl, ensureQuarterlyCycle } from './meego';
import { copyPrdTemplate, updatePrdBasicInfo, getLarkBotToken, resolveDocIdFromUrl } from './lark';
import { generatePrdScaffold } from './prd-scaffold';
import { updateDigestState, type PendingPrd } from './digest-state';

const TIKTOK_PROJECT_KEY = '5f105019a8b9a853da64767f';
// The Meego automation that resets 季度规划 fires ~8s after a story is created.
const QUARTER_AUTOMATION_SETTLE_MS = 20_000;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Meego creates the legal ticket a few seconds after the story; wait up to a minute for it. */
async function waitForComplianceUrl(workItemId: string): Promise<string> {
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      const url = await getComplianceUrl(workItemId);
      if (url) return url;
    } catch (e) {
      console.warn('[prd-create] legal ticket lookup failed:', e);
    }
    await sleep(5000);
  }
  return '';
}

/**
 * Finish a Hamlet-created story: create its PRD (research, scaffold, Meego and
 * legal-ticket links, org sharing), put back the Quarterly Cycle the PM picked,
 * and clear its pendingPrds entry. Idempotent — an existing PRD is returned
 * rather than duplicated. Used by /api/meego/create-prd and the digest Job.
 */
export async function createPrdForStory(id: string, request: PendingPrd): Promise<string> {
  let prd = await getStoryPrdUrl(id).catch(() => '');
  if (prd) {
    console.log(`[prd-create] ${id} already has a PRD`);
  } else {
    const legalTicket = waitForComplianceUrl(id);
    const description = request.featureDescription?.trim();
    const scaffold = description ? generatePrdScaffold(request.name, description) : undefined;
    prd = await copyPrdTemplate(request.name, description, {
      useHalfDayPrd: request.useHalfDayPrd,
      meegoUrl: request.meegoUrl,
      scaffold,
    });

    try {
      await updateFeatureFields(TIKTOK_PROJECT_KEY, id, { prd });
    } catch (e) {
      console.warn('[prd-create] PRD link-back to Meego failed:', e);
    }

    const complianceUrl = await legalTicket;
    if (complianceUrl) {
      try {
        await updatePrdBasicInfo(await resolveDocIdFromUrl(prd), { complianceUrl }, await getLarkBotToken());
      } catch (e) {
        console.warn('[prd-create] PRD legal ticket link failed:', e);
      }
    } else {
      console.warn(`[prd-create] no legal ticket on ${id} after 60s — PRD left without it`);
    }
  }

  if (request.quarterlyCycleOptionId) {
    const settle = Date.parse(request.createdAt) + QUARTER_AUTOMATION_SETTLE_MS - Date.now();
    if (settle > 0) await sleep(settle);
    try {
      if (await ensureQuarterlyCycle(id, request.quarterlyCycleOptionId)) {
        console.log(`[prd-create] ${id}: restored Quarterly Cycle after Meego's automation reset it`);
      }
    } catch (e) {
      console.warn('[prd-create] Quarterly Cycle restore failed:', e);
    }
  }

  await updateDigestState(s => {
    if (s.pendingPrds?.[id]) {
      const next = { ...s.pendingPrds };
      delete next[id];
      s.pendingPrds = next;
    }
  });
  return prd;
}
