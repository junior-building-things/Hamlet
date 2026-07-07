'use client';
import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, Link as LinkIcon, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { PriorityBadge } from './PriorityBadge';
import { VersionBadge } from './VersionBadge';

interface VibeProject {
  id: string;
  feature: string;
  version: string;
  priority: string;
  links: string[];
  team: string;
  createdAt: string;
}

const PRIORITIES = ['P0', 'P1', 'P2', 'P3'] as const;

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

export function VibeCodingView({ user }: { user?: { name: string } }) {
  const [projects, setProjects] = useState<VibeProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Add-form fields
  const [feature, setFeature] = useState('');
  const [version, setVersion] = useState('');
  const [priority, setPriority] = useState<string>('P2');
  const [links, setLinks] = useState('');

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

  async function addProject() {
    if (!feature.trim()) { toast.error('Feature is required'); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/vibe-projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feature, version, priority, links }),
      });
      const data = await res.json() as { projects?: VibeProject[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Failed to add');
      setProjects(data.projects ?? []);
      setFeature(''); setVersion(''); setPriority('P2'); setLinks('');
      toast.success('Project added');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to add');
    } finally {
      setBusy(false);
    }
  }

  async function removeProject(id: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/vibe-projects?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      const data = await res.json() as { projects?: VibeProject[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Failed to delete');
      setProjects(data.projects ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete');
    } finally {
      setBusy(false);
    }
  }

  const inputCls = 'bg-[var(--bg-elev-2)] border border-[var(--hairline)] rounded-[var(--r-sm)] px-2.5 py-1.5 text-[12.5px] text-[var(--text)] placeholder:text-[var(--text-dim)] focus:outline-none focus:border-[var(--hairline-strong)]';

  return (
    <div className="h-full overflow-y-auto px-6 py-5">
      <div className="max-w-[860px] mx-auto">
        {/* Header */}
        <div className="mb-1">
          <h1 className="text-[15px] font-semibold tracking-[-0.02em] text-[var(--text)]">Vibe-Coding Projects</h1>
          <p className="text-[12px] text-[var(--text-muted)] mt-0.5 leading-[1.5]">
            Side projects you&apos;re building without a Meego item — tracked here so they don&apos;t get lost.
          </p>
        </div>

        {/* Add form */}
        <div className="meta-card mt-4 !p-3.5">
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px_110px] gap-2.5">
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-[var(--text-dim)]">Feature</span>
              <input className={inputCls} value={feature} onChange={e => setFeature(e.target.value)}
                placeholder="What are you building?" onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void addProject(); }} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-[var(--text-dim)]">Version</span>
              <input className={inputCls} value={version} onChange={e => setVersion(e.target.value)} placeholder="e.g. 45.8" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-[var(--text-dim)]">Priority</span>
              <select className={inputCls} value={priority} onChange={e => setPriority(e.target.value)}>
                {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2.5 mt-2.5 items-end">
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-[var(--text-dim)]">Links</span>
              <input className={inputCls} value={links} onChange={e => setLinks(e.target.value)}
                placeholder="Paste URLs, separated by space or comma" />
            </label>
            <div className="flex items-center gap-2.5 pb-px">
              <span className="flex flex-col gap-1">
                <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-[var(--text-dim)]">Team</span>
                <span className="meta-tag" title="Only you — vibe projects are private">{user?.name ?? 'Me'}</span>
              </span>
              <button onClick={() => void addProject()} disabled={busy} className="hm-btn hm-btn-primary ml-auto">
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                Add
              </button>
            </div>
          </div>
        </div>

        {/* List */}
        <div className="mt-5 flex flex-col gap-2">
          {loading ? (
            <div className="flex items-center gap-2 text-[12px] text-[var(--text-muted)] py-6 justify-center">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
            </div>
          ) : projects.length === 0 ? (
            <div className="text-[12px] text-[var(--text-dim)] py-8 text-center border border-dashed border-[var(--hairline)] rounded-[var(--r-md)]">
              No vibe-coding projects yet. Add one above.
            </div>
          ) : projects.map(p => (
            <div key={p.id} className="meta-card !p-3 flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[13px] font-medium text-[var(--text)]">{p.feature}</span>
                  {p.priority && <PriorityBadge priority={p.priority as 'P0' | 'P1' | 'P2' | 'P3'} />}
                  {p.version && <VersionBadge version={p.version} />}
                  <span className="meta-tag">{p.team}</span>
                </div>
                {p.links.length > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap mt-2">
                    {p.links.map((url, i) => (
                      <a key={i} href={url} target="_blank" rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-[var(--hairline)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors max-w-[220px]">
                        <LinkIcon className="w-2.5 h-2.5 shrink-0" />
                        <span className="truncate">{hostOf(url)}</span>
                        <ExternalLink className="w-2.5 h-2.5 shrink-0 opacity-60" />
                      </a>
                    ))}
                  </div>
                )}
              </div>
              <button onClick={() => void removeProject(p.id)} disabled={busy}
                title="Delete" className="hm-btn !px-1.5 shrink-0 text-[var(--text-dim)] hover:text-[var(--text)]">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
