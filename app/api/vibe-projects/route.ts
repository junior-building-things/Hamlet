import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { readJsonStateWithGen, writeJsonState, GcsPreconditionFailedError } from '@/lib/gcs-state';

export const dynamic = 'force-dynamic';

// Personal, Meego-less "vibe coding" projects the PM tracks by hand.
// Stored as a single JSON array in GCS. Session-gated (middleware also
// protects the route), so only the logged-in PM ("me") sees/edits them.
// Link fields mirror the Feature shape so the Links cell can reuse the
// same LinkIcons component the Ongoing Features table uses.
const STATE_PATH = 'hamlet/vibe-projects.json';

export interface VibeProject {
  id: string;
  feature: string;
  version: string;
  priority: string;   // P0 | P1 | P2 | P3
  // Link fields — same keys as lib/types.ts Feature.
  prd?: string;
  figmaUrl?: string;
  complianceUrl?: string;
  libraUrl?: string;
  abReportUrl?: string;
  meegoUrl?: string;
  team: string;        // always the owner ("me")
  createdAt: string;
}

// Fields a PATCH may set (everything except id/team/createdAt).
const EDITABLE_FIELDS = [
  'feature', 'version', 'priority',
  'prd', 'figmaUrl', 'complianceUrl', 'libraUrl', 'abReportUrl', 'meegoUrl',
] as const;

/** Read-modify-write with a generation precondition + retry, so concurrent
 *  edits don't clobber each other. */
async function mutate(fn: (list: VibeProject[]) => VibeProject[]): Promise<VibeProject[]> {
  for (let attempt = 0; attempt < 5; attempt++) {
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
    const { data } = await readJsonStateWithGen<VibeProject[]>(STATE_PATH);
    return NextResponse.json({ projects: Array.isArray(data) ? data : [] });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'load failed' }, { status: 500 });
  }
}

/** POST — append a new (blank) row. The client fills it in via PATCH. */
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    const project: VibeProject = {
      id: `vibe_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      feature: '',
      version: '',
      priority: 'P2',
      team: session.name,          // "only me" — always the logged-in PM
      createdAt: new Date().toISOString(),
    };
    const next = await mutate(list => [...list, project]);
    return NextResponse.json({ ok: true, project, projects: next });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'create failed' }, { status: 500 });
  }
}

/** PATCH — update one project's editable fields. Body: { id, ...fields }. */
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    const body = await req.json() as Record<string, unknown> & { id?: string };
    const id = String(body.id ?? '');
    if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 });
    const patch: Partial<VibeProject> = {};
    for (const key of EDITABLE_FIELDS) {
      if (key in body) patch[key] = String(body[key] ?? '').trim();
    }
    let found = false;
    const next = await mutate(list => list.map(p => {
      if (p.id !== id) return p;
      found = true;
      return { ...p, ...patch };
    }));
    if (!found) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json({ ok: true, projects: next });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'update failed' }, { status: 500 });
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
