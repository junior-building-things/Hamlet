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

// Fixed/capped column tracks (only the trailing spacer flexes) so columns
// pack tight on the left like the Product Features table — no growing gaps.
// Feature, Version, Priority, Links, Team, spacer(flex), Delete.
const GRID = 'minmax(220px,400px) 70px 60px 150px 60px minmax(40px,1fr) 36px';

// ─── Inline editable text cell (click to edit, Enter/blur saves, Esc cancels) ──
function EditableCell({ value, placeholder, onSave }: {
  value: string; placeholder?: string; onSave: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);
  useEffect(() => { if (editing && ref.current) { ref.current.focus(); ref.current.select(); } }, [editing]);

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
    <div className="editable-cell w-full min-w-0 text-[12.5px] truncate" onClick={() => setEditing(true)}>
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

  const priorityOf = (p: VibeProject) =>
    (PRIORITIES.includes(p.priority as typeof PRIORITIES[number]) ? p.priority : 'P2') as 'P0' | 'P1' | 'P2' | 'P3';

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Page header — matches Product Features. */}
      <div className="shrink-0 px-5 py-4 border-b border-[var(--hairline)]">
        <div className="text-[18px] font-semibold text-[var(--text)] tracking-[-0.02em]">Vibe Projects</div>
        <div className="text-[12px] text-[var(--text-muted)] mt-0.5">Projects without a dedicated Meego</div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-16">
        {/* Column header */}
        <div className="hidden sm:grid py-2.5 sticky top-0 bg-[var(--bg-elev-1)] border-b border-[var(--hairline)] z-10"
          style={{ gridTemplateColumns: GRID, columnGap: '0.75rem' }}>
          {['Feature', 'Version', 'Priority', 'Links', 'Team', '', ''].map((l, i) => (
            <span key={i} className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-dim)] pl-1">{l}</span>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-[12px] text-[var(--text-muted)] py-8 justify-center">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
          </div>
        ) : (
          <>
            {projects.length === 0 && (
              <div className="text-[12px] text-[var(--text-dim)] py-6 pl-1">No projects yet — add your first row below.</div>
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
                    <PriorityBadge priority={priorityOf(p)} />
                    <select
                      className="absolute inset-0 opacity-0 cursor-pointer"
                      value={priorityOf(p)}
                      onChange={e => updateField(p.id, 'priority', e.target.value)}
                      title="Change priority"
                    >
                      {PRIORITIES.map(pr => <option key={pr} value={pr}>{pr}</option>)}
                    </select>
                  </div>
                </div>
                {/* Links — reuse the Product Features LinkIcons (icons + add affordance) */}
                <div className="pl-1 min-w-0">
                  <LinkIcons
                    feature={p as unknown as Feature}
                    onLinkUpdate={(key, url) => {
                      const field = LINK_KEY_TO_FIELD[key];
                      if (field) void updateField(p.id, field, url);
                    }}
                  />
                </div>
                {/* Team — single avatar (only you) */}
                <div className="pl-1">
                  <UserAvatar name={p.team || user?.name || 'Me'} url={user?.avatarUrl} size={5} />
                </div>
                {/* Spacer */}
                <div />
                {/* Delete */}
                <button onClick={() => void removeRow(p.id)} title="Delete row"
                  className="grid place-items-center w-6 h-6 rounded text-[var(--text-dim)] hover:text-[var(--text)] hover:bg-[var(--hairline)] transition-colors">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}

            {/* Add row */}
            <button onClick={() => void addRow()} disabled={adding}
              className="flex items-center gap-2 mt-3 px-2 py-2 text-[12.5px] text-[var(--text-muted)] hover:text-[var(--text)] w-fit rounded-[var(--r-sm)] hover:bg-[var(--hairline)] transition-colors disabled:opacity-50">
              {adding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              Add row
            </button>
          </>
        )}
      </div>
    </div>
  );
}
