import { NextRequest, NextResponse } from 'next/server';
import { syncFeatureStatus } from '@/lib/meego';
import { batchFetchAvatars, getLarkUserToken, searchLibraInChat, getLarkBotToken } from '@/lib/lark';
import { loadDigestState } from '@/lib/digest-state';
import { updateFeatureInCache, markFeatureDeleted, readFeatureCache } from '@/lib/feature-cache';

/**
 * Thomas's Lark user token, via the one shared refresher. This route used to
 * keep its own chain (in-memory + session cookie + GCS) and replay stale refresh
 * tokens, which Lark rejects and can revoke the whole login for.
 */
async function getFreshUserToken(): Promise<string | undefined> {
  const token = await getLarkUserToken();
  if (!token) console.warn('[sync] no usable Lark user token — skipping user-token features (re-login needed)');
  return token;
}

export async function POST(req: NextRequest) {
  const { meegoUrl, chatId } = await req.json() as { meegoUrl?: string; chatId?: string };

  if (!meegoUrl) {
    return NextResponse.json({ error: 'meegoUrl is required' }, { status: 400 });
  }

  try {
    const userToken = await getFreshUserToken();
    const result = await syncFeatureStatus(meegoUrl, userToken, chatId);

    // Use Meego avatars first, then try Lark as fallback
    let pocAvatars: Record<string, string> = { ...result.meegoAvatars };
    const missingEmails: Record<string, string> = {};
    for (const [name, email] of Object.entries(result.pocEmails)) {
      if (!pocAvatars[name]) missingEmails[name] = email;
    }
    if (Object.keys(missingEmails).length > 0) {
      try {
        const larkAvatars = await batchFetchAvatars(missingEmails, userToken);
        Object.assign(pocAvatars, larkAvatars);
      } catch { /* ignore */ }
    }

    // Fallback: if syncFeatureStatus didn't find a chat (Lark search miss),
    // look it up from the digest pipeline's Junior chat cache (GCS). The
    // cache matches by Meego ID in the chat description, which is more
    // reliable than name-based search.
    if (!result.chatId || !result.libraUrl) {
      try {
        const meegoId = meegoUrl.match(/\/detail\/(\d+)/)?.[1] ?? '';
        if (meegoId) {
          const state = await loadDigestState();
          const cached = (state.juniorChatsCache?.chats ?? []).find(c => c.meegoId === meegoId);
          if (cached) {
            if (!result.chatId) result.chatId = cached.chatId;
            if (!result.libraUrl) {
              const botToken = await getLarkBotToken();
              result.libraUrl = await searchLibraInChat(cached.chatId) || '';
              if (result.libraUrl) {
                console.warn(`[sync] "${result.name}": libra found via GCS chat cache fallback: ${result.libraUrl.slice(0, 80)}`);
              }
            }
          }
        }
      } catch (e) {
        console.warn('[sync] GCS chat cache fallback failed:', e);
      }
    }

    console.warn(`[sync] result for "${result.name}": status=${result.status}, libra=${result.libraUrl || '(empty)'}, abReport=${result.abReportUrl ? 'found' : 'empty'}, chatId=${result.chatId || '(none)'}`);

    // Write the synced feature back to the GCS cache (best-effort, don't block response).
    const meegoId = meegoUrl.match(/\/detail\/(\d+)/)?.[1] ?? '';
    if (meegoId) {
      // Read existing cache entry to preserve versionHistory and respect
      // manualEdits (so synced values don't overwrite manually edited ones).
      let existing: Awaited<ReturnType<typeof readFeatureCache>> extends (infer T | null) ? T extends { features: (infer F)[] } ? F | undefined : undefined : undefined;
      try {
        const cache = await readFeatureCache();
        existing = cache?.features.find(f => f.id === meegoId || f.meegoIssueId === meegoId);
      } catch { /* fall through */ }

      const manualEdits = new Set(existing?.manualEdits ?? []);
      // pick: use synced value unless the field was manually edited
      const keep = <T>(key: string, synced: T, fallback: T | undefined): T | undefined =>
        manualEdits.has(key) ? fallback : (synced || fallback);

      // Version history: append new version if different from last entry
      let versionHistory: string[] | undefined;
      if (result.iosVersion) {
        const history = existing?.versionHistory ?? [];
        if (history.length === 0 || history[history.length - 1] !== result.iosVersion) {
          versionHistory = [...history, result.iosVersion];
        } else {
          versionHistory = history;
        }
      }

      updateFeatureInCache(meegoId, {
        status: result.status,
        name: keep('name', result.name, existing?.name),
        lastUpdated: result.lastUpdated || existing?.lastUpdated,
        owner: result.owner,
        prd: keep('prd', result.prd, existing?.prd),
        figmaUrl: keep('figmaUrl', result.figmaUrl, existing?.figmaUrl),
        complianceUrl: keep('complianceUrl', result.complianceUrl, existing?.complianceUrl),
        priority: result.priority ?? undefined,
        canCompleteNode: result.canCompleteNode,
        meegoNodeKey: result.meegoNodeKey,
        iosVersion: result.iosVersion,
        ...(versionHistory ? { versionHistory } : {}),
        abReportUrl: keep('abReportUrl', result.abReportUrl, existing?.abReportUrl),
        libraUrl: keep('libraUrl', result.libraUrl, existing?.libraUrl),
        chatId: result.chatId,
        // Project Details fields — populated by syncFeatureStatus from
        // the Meego brief's work_item_fields. Were previously returned
        // in the sync response (so the client's local state showed
        // them) but never persisted, so they vanished on page reload.
        quarterlyCycle: result.quarterlyCycle,
        businessLine: result.businessLine,
        socialComponent: result.socialComponent,
        // POC role owners.
        pmOwner: result.pmOwner,
        tpmOwner: result.tpmOwner,
        techOwner: result.techOwner,
        iosOwner: result.iosOwner,
        androidOwner: result.androidOwner,
        serverOwner: result.serverOwner,
        qaOwner: result.qaOwner,
        daOwner: result.daOwner,
        uiuxOwner: result.uiuxOwner,
        contentDesigner: result.contentDesigner,
        // Package QR codes (fetched as part of the chat join flow).
        packageQrUrl: result.packageQrUrl,
        packageDownloadUrl: result.packageDownloadUrl,
        iosPackageQrUrl: result.iosPackageQrUrl,
        iosPackageDownloadUrl: result.iosPackageDownloadUrl,
        avatars: pocAvatars,
        pocEmails: result.pocEmails,
        meegoComments: result.meegoComments,
      }).catch(e => console.warn('[sync] cache update failed:', e));
    }

    // Fire-and-forget: ask Junior to send a "PRD Ready" card to the
    // compliance chat if this feature has just moved past Requirements
    // Prep (Junior dedupes via GCS so calling repeatedly is safe).
    const juniorUrl = process.env.JUNIOR_URL;
    const cronSecret = process.env.JUNIOR_CRON_SECRET;
    const projectKey = meegoUrl.match(/meego\.larkoffice\.com\/([^/]+)\/story/)?.[1];
    if (juniorUrl && cronSecret && projectKey && meegoId) {
      fetch(`${juniorUrl}/api/check-prd-ready`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cronSecret}` },
        body: JSON.stringify({ project: projectKey, id: meegoId }),
      }).catch(e => console.warn('[sync] check-prd-ready call failed:', e));
    }

    return NextResponse.json({ ...result, pocAvatars });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Sync failed';
    // Detect deleted/not-found work items so the frontend can remove them
    if (msg.includes('not found') || msg.includes('not exist') || msg.includes('deleted')) {
      const meegoId = meegoUrl.match(/\/detail\/(\d+)/)?.[1];
      console.warn(`[sync] work item appears deleted: ${meegoUrl}`);
      if (meegoId) markFeatureDeleted(meegoId).catch(() => {});
      return NextResponse.json({ deleted: true });
    }
    console.error('Meego sync error:', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
