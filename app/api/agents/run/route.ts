import { NextRequest, NextResponse } from 'next/server';
import { syncFeatureStatus } from '@/lib/meego';
import { runAgentsForFeature } from '@/lib/agents';

const AGENT_RUN_SECRET = process.env.AGENT_RUN_SECRET;

interface FeatureInput {
  id: string;
  name: string;
  meegoUrl: string;
  chatId?: string;
  agents: string[];
  agentLastRun?: string;
  iosVersion?: string;
  status?: string;
}

export async function POST(req: NextRequest) {
  // Simple auth check (optional, for Cloud Scheduler)
  if (AGENT_RUN_SECRET) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${AGENT_RUN_SECRET}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  try {
    const body = await req.json() as { features?: FeatureInput[] };
    const features = body.features ?? [];

    // Filter to features with agents and a chat
    const withAgents = features.filter(f =>
      f.agents && f.agents.length > 0 && f.chatId && f.meegoUrl
    );

    if (withAgents.length === 0) {
      return NextResponse.json({ message: 'No features with agents assigned', actions: [] });
    }

    const allActions: string[] = [];

    // Process features sequentially to avoid rate limits
    for (const input of withAgents) {
      try {
        // Sync feature to get latest data + pocEmails
        const syncResult = await syncFeatureStatus(input.meegoUrl, undefined, input.chatId);

        // Build enriched feature
        const feature = {
          id: input.id,
          name: syncResult.name || input.name,
          description: '',
          status: syncResult.status || input.status || '',
          priority: syncResult.priority ?? ('P2' as const),
          owner: '',
          tasks: [] as Array<{ id: string; text: string; completed: boolean }>,
          lastUpdated: syncResult.lastUpdated || '',
          meegoUrl: input.meegoUrl,
          chatId: syncResult.chatId || input.chatId,
          agents: input.agents,
          agentLastRun: input.agentLastRun,
          techOwner: syncResult.techOwner,
          pmOwner: syncResult.pmOwner,
          iosOwner: syncResult.iosOwner,
          androidOwner: syncResult.androidOwner,
          serverOwner: syncResult.serverOwner,
          qaOwner: syncResult.qaOwner,
          uiuxOwner: syncResult.uiuxOwner,
          iosVersion: syncResult.iosVersion || input.iosVersion,
        };

        const actions = await runAgentsForFeature(feature, syncResult.pocEmails);
        allActions.push(...actions);

        // Delay between features to avoid rate limits
        await new Promise(r => setTimeout(r, 1000));
      } catch (e) {
        console.warn(`[agents/run] failed for ${input.name}:`, e);
      }
    }

    return NextResponse.json({
      message: `Processed ${withAgents.length} features`,
      actions: allActions,
    });
  } catch (err) {
    console.error('[agents/run] error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Agent run failed' },
      { status: 500 },
    );
  }
}
