'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { Feature } from '@/lib/types';
import { PriorityBadge } from './PriorityBadge';
import { LinkIcons } from './LinkIcons';
import { UserAvatar } from './AvatarSelect';

interface VibeProject {
  id: string;
  feature: string;
  version: string;
  priority: string;
  prd?: string;
  figmaUrl?: string;
  complianceUrl?: string;
  libraUrl?: string;
  abReportUrl?: string;
  meegoUrl?: string;
  team: string;
  createdAt: string;
}

const PRIORITIES = ['P0', 'P1', 'P2', 'P3'] as const;
// LinkIcons reports edits by link key; map those to VibeProject fields.
const LINK_KEY_TO_FIELD: Record<string, keyof VibeProject> = {
  meego: 'meegoUrl', prd: 'prd', compliance: 'complianceUrl',
  figma: 'figmaUrl', libra: 'libraUrl', ab: 'abReportUrl',
};

// Mirror the Ongoing Features grid: one grid per header/row, same tracks.
const GRID = 'minmax(150px,1.6fr) 90px 84px minmax(150px,1.3fr) 130px 34px';

// ─── Inline editable text cell (click to edit, Enter/blur saves, Esc cancels) ──
function EditableCell({ value, placeholder, onSave }: {
  value: string; placeholder?: string; onSave: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing && ref.current) { ref.current.focus(); ref.current.select(); } }, [editing]);

  function begin() { setDraft(value); setEditing(true); }
  function commit() {
    setEditing(false);
    const t = draft.trim();
    if (t !== value) onSave(t);
  }
  if (editing) {
    return (
      <input
        ref={ref}
        className="editable-cell w-full min-w-0 bg-transparent border-none outline-none text-[12.5px]"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          if (e.key === 'Escape') { setDraft(value); setEditing(false); }
        }}
        placeholder={placeholder}
      />
    );
  }
  return (
    <div className="editable-cell w-full min-w-0 text-[12.5px] truncate" onClick={begin}>
      <span className={value ? 'text-[var(--text)]' : 'text-[var(--text-dim)]'}>{value || placeholder}</span>
    </div>
  );
}

export function VibeCodingView({ user }: { user?: { name: string; avatarUrl?: string } }) {
  const [projects, setProjects] = useState<VibeProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/vibe-projects');
      const data = await res.json() as { projects?: VibeProject[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Failed to load');
      setProjects(data.projects ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  // Optimistic field update + PATCH.
  const updateField = useCallback(async (id: string, field: keyof VibeProject, value: string) => {
    setProjects(prev => prev.map(p => p.id === id ? { ...p, [field]: value } : p));
    try {
      const res = await fetch('/api/vibe-projects', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, [field]: value }),
      });
      if (!res.ok) throw new Error((await res.json())?.error ?? 'Save failed');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
      void refresh(); // reconcile on failure
    }
  }, [refresh]);

  async function addRow() {
    setAdding(true);
    try {
      const res = await fetch('/api/vibe-projects', { method: 'POST' });
      const data = await res.json() as { project?: VibeProject; error?: string };
      if (!res.ok || !data.project) throw new Error(data.error ?? 'Failed to add');
      setProjects(prev => [...prev, data.project!]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to add');
    } finally {
      setAdding(false);
    }
  }

  async function removeRow(id: string) {
    const snapshot = projects;
    setProjects(prev => prev.filter(p => p.id !== id));
    try {
      const res = await fetch(`/api/vibe-projects?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json())?.error ?? 'Delete failed');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed');
      setProjects(snapshot); // roll back
    }
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header bar (matches the Ongoing Features header) */}
      <div className="shrink-0 px-5 py-4 border-b border-[var(--hairline)]">
        <h1 className="text-[15px] font-semibold tracking-[-0.02em] text-[var(--text)]">Vibe-Coding Projects</h1>
        <p className="text-[12px] text-[var(--text-muted)] mt-0.5 leading-[1.5]">
          Side projects you&apos;re building without a Meego item — add rows and fill them in inline.
        </p>
      </div>

      {/* Scrollable table */}
      <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-16">
        {/* Column header (matches the Ongoing Features table) */}
        <div className="hidden sm:grid py-2.5 sticky top-0 bg-[var(--bg-elev-1)] border-b border-[var(--hairline)] z-10"
          style={{ gridTemplateColumns: GRID, columnGap: '0.75rem' }}>
          {['Feature', 'Version', 'Priority', 'Links', 'Team', ''].map((l, i) => (
            <span key={i} className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-dim)] pl-1">{l}</span>
          ))}
        </div>

        {/* Rows */}
        {loading ? (
          <div className="flex items-center gap-2 text-[12px] text-[var(--text-muted)] py-8">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
          </div>
        ) : (
          <div className="flex flex-col">
            {projects.length === 0 && (
              <div className="text-[12px] text-[var(--text-dim)] py-6">No projects yet — add your first row below.</div>
            )}
            {projects.map(p => (
              <div key={p.id}
                className="grid items-center py-2 border-b border-[var(--hairline)] hover:bg-[var(--hairline)]/40 transition-colors"
                style={{ gridTemplateColumns: GRID, columnGap: '0.75rem' }}>
                {/* Feature */}
                <div className="pl-1 min-w-0">
                  <EditableCell value={p.feature} placeholder="Untitled project" onSave={v => updateField(p.id, 'feature', v)} />
                </div>
                {/* Version */}
                <div className="pl-1 min-w-0">
                  <EditableCell value={p.version} placeholder="—" onSave={v => updateField(p.id, 'version', v)} />
                </div>
                {/* Priority */}
                <div className="pl-1">
                  <div className="relative inline-flex">
                    <PriorityBadge priority={(PRIORITIES.includes(p.priority as typeof PRIORITIES[number]) ? p.priority : 'P2') as 'P0' | 'P1' | 'P2' | 'P3'} />
                    <select
                      className="absolute inset-0 opacity-0 cursor-pointer"
                      value={PRIORITIES.includes(p.priority as typeof PRIORITIES[number]) ? p.priority : 'P2'}
                      onChange={e => updateField(p.id, 'priority', e.target.value)}
                      title="Change priority"
                    >
                      {PRIORITIES.map(pr => <option key={pr} value={pr}>{pr}</option>)}
                    </select>
                  </div>
                </div>
                {/* Links — reuse the Ongoing Features LinkIcons (icons + add affordance) */}
                <div className="pl-1 min-w-0">
                  <LinkIcons
                    feature={p as unknown as Feature}
                    onLinkUpdate={(key, url) => {
                      const field = LINK_KEY_TO_FIELD[key];
                      if (field) void updateField(p.id, field, url);
                    }}
                  />
                </div>
                {/* Team (fixed to you) — same avatar design as Ongoing Features */}
                <div className="pl-1 min-w-0 flex items-center">
                  <div className="rounded-full inline-block" title="Only you — vibe projects are private"
                    style={{ outline: '2px solid var(--card)', outlineOffset: '-1px' }}>
                    <UserAvatar name={p.team || user?.name || 'Me'} url={user?.avatarUrl} size={6} />
                  </div>
                </div>
                {/* Delete */}
                <button onClick={() => void removeRow(p.id)} title="Delete row"
                  className="grid place-items-center w-6 h-6 rounded text-[var(--text-dim)] hover:text-[var(--text)] hover:bg-[var(--hairline)] transition-colors">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}

            {/* Add row */}
            <button onClick={() => void addRow()} disabled={adding}
              className="flex items-center gap-2 mt-2.5 px-2 py-2 text-[12.5px] text-[var(--text-muted)] hover:text-[var(--text)] w-fit rounded-[var(--r-sm)] hover:bg-[var(--hairline)] transition-colors disabled:opacity-50">
              {adding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              Add row
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
