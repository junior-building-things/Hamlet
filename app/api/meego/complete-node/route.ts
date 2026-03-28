import { NextRequest, NextResponse } from 'next/server';
import { completeNode } from '@/lib/meego';

export async function POST(req: NextRequest) {
  const { projectKey, workItemId, nodeKey } = await req.json() as {
    projectKey?: string;
    workItemId?: string;
    nodeKey?: string;
  };

  if (!projectKey || !workItemId || !nodeKey) {
    return NextResponse.json({ error: 'projectKey, workItemId and nodeKey are required' }, { status: 400 });
  }

  try {
    await completeNode(projectKey, workItemId, nodeKey);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Meego complete-node error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to complete node' },
      { status: 500 }
    );
  }
}
