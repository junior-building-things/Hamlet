import { NextRequest, NextResponse } from 'next/server';
import { loadDigestState, updateDigestState } from '@/lib/digest-state';

export const dynamic = 'force-dynamic';

/** GET ?id=<meego work item id> — whether Proactive updates are on for that feature. */
export async function GET(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  const state = await loadDigestState();
  return NextResponse.json({ enabled: !!state.proactiveWatch?.[id] });
}

/** POST { id, enabled, name, meegoUrl } — switch Proactive updates on or off. */
export async function POST(req: NextRequest) {
  const body = await req.json() as { id?: string; enabled?: boolean; name?: string; meegoUrl?: string };
  if (!body.id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  if (body.enabled && (!body.name || !body.meegoUrl)) {
    return NextResponse.json({ error: 'name and meegoUrl are required to enable' }, { status: 400 });
  }
  const id = body.id;
  await updateDigestState(s => {
    const next = { ...(s.proactiveWatch ?? {}) };
    if (body.enabled) {
      next[id] = next[id] ?? { name: body.name!, meegoUrl: body.meegoUrl! };
    } else {
      delete next[id];
    }
    s.proactiveWatch = next;
  });
  return NextResponse.json({ ok: true, enabled: !!body.enabled });
}
