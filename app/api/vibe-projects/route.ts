import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { readJsonStateWithGen, writeJsonState, GcsPreconditionFailedError } from '@/lib/gcs-state';

export const dynamic = 'force-dynamic';

// Personal, Meego-less "vibe coding" projects the PM tracks by hand.
// Stored as a single JSON array in GCS. Session-gated (middleware also
// protects the route), so only the logged-in PM ("me") sees/edits them.
const STATE_PATH = 'hamlet/vibe-projects.json';

export interface VibeProject {
  id: string;
  feature: string;
  version: string;
  priority: string;   // P0 | P1 | P2 | P3
  links: string[];
  team: string;        // always the owner ("me")
  createdAt: string;
}

async function load(): Promise<VibeProject[]> {
  const { data } = await readJsonStateWithGen<VibeProject[]>(STATE_PATH);
  return Array.isArray(data) ? data : [];
}

/** Read-modify-write with a generation precondition + retry, so concurrent
 *  edits don't clobber each other. */
async function mutate(fn: (list: VibeProject[]) => VibeProject[]): Promise<VibeProject[]> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data, generation } = await readJsonStateWithGen<VibeProject[]>(STATE_PATH);
    const list = Array.isArray(data) ? data : [];
    const next = fn(list);
    try {
      await writeJsonState(STATE_PATH, next, { ifGenerationMatch: generation ?? '0' });
      return next;
    } catch (e) {
      if (e instanceof GcsPreconditionFailedError) continue; // lost the race — re-read + retry
      throw e;
    }
  }
  throw new Error('vibe-projects write conflict — retries exhausted');
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    return NextResponse.json({ projects: await load() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'load failed' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    const body = await req.json() as { feature?: string; version?: string; priority?: string; links?: unknown };
    const feature = (body.feature ?? '').trim();
    if (!feature) return NextResponse.json({ error: 'Feature is required' }, { status: 400 });

    // Links accept either an array or a comma/space/newline-separated string.
    const links = (Array.isArray(body.links) ? body.links.map(String) : String(body.links ?? '').split(/[\s,]+/))
      .map(s => s.trim())
      .filter(Boolean);

    const project: VibeProject = {
      id: `vibe_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      feature,
      version: (body.version ?? '').trim(),
      priority: (body.priority ?? '').trim() || 'P2',
      links,
      team: session.name,          // "only me" — always the logged-in PM
      createdAt: new Date().toISOString(),
    };
    const next = await mutate(list => [project, ...list]);
    return NextResponse.json({ ok: true, project, projects: next });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'create failed' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 });
  try {
    const next = await mutate(list => list.filter(p => p.id !== id));
    return NextResponse.json({ ok: true, projects: next });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'delete failed' }, { status: 500 });
  }
}
