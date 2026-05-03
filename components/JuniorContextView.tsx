'use client';
import { useState, useEffect, useCallback } from 'react';
import { Loader2, Save, Trash2, Plus, FileText, History, Activity } from 'lucide-react';
import { toast } from 'sonner';

interface HistoryStats { fileCount: number; totalMessages: number }
interface SystemContextStats { chat?: HistoryStats; user?: HistoryStats }

interface ContextFile {
  name: string;
  content: string;
  updatedAt?: string;
}

const FILE_DESCRIPTIONS: Record<string, string> = {
  'system.md': "Junior's core agent persona — base behavior, voice, defaults",
  'glossary.md': 'Org-specific vocabulary, team names, doc locations',
  'preferences.md': 'User preferences (Junior auto-appends from "from now on..." statements)',
};

function describe(name: string): string {
  if (FILE_DESCRIPTIONS[name]) return FILE_DESCRIPTIONS[name];
  if (name.startsWith('skill_')) return `Skill: ${name.slice(6, -3).replace(/_/g, ' ')}`;
  return '';
}

export function JuniorContextView() {
  const [files, setFiles] = useState<ContextFile[]>([]);
  const [stats, setStats] = useState<SystemContextStats>({});
  const [loading, setLoading] = useState(true);
  const [expandedName, setExpandedName] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [filesRes, statsRes] = await Promise.all([
        fetch('/api/junior-context'),
        fetch('/api/junior-history'),
      ]);
      const filesData = await filesRes.json() as { files?: ContextFile[]; error?: string };
      if (!filesRes.ok) throw new Error(filesData.error ?? 'Failed to load files');
      setFiles(filesData.files ?? []);
      if (statsRes.ok) {
        const s = await statsRes.json() as SystemContextStats;
        setStats(s);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load context');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-5 py-4 border-b border-[var(--hairline)]">
        <div className="text-[18px] font-semibold text-[var(--text)] tracking-[-0.02em]">Junior Context</div>
        <div className="text-[12px] text-[var(--text-muted)] mt-0.5">
          Context included each time Junior replies. Edits propagate within 1 min.
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-5 py-4 pb-16">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3 text-[var(--text-muted)]">
            <Loader2 className="w-8 h-8 animate-spin text-[var(--ai)]" />
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {/* System context cells: live (recent chat) + stored history */}
            <SystemCell
              kind="live"
              icon={<Activity className="w-3.5 h-3.5" />}
              name="Recent chat snapshot"
              description="Last 15 messages of the current chat, fetched live from Lark on every Junior turn."
            />
            <SystemCell
              kind="history"
              icon={<History className="w-3.5 h-3.5" />}
              name="Conversation history (chat-level)"
              description="Per-chat back-and-forth Junior remembers, keyed by chatId. Replayed as user/model turns to Gemini."
              right={stats.chat ? `${stats.chat.fileCount} chats · ${stats.chat.totalMessages} msgs` : '—'}
              clearScope="chat"
              onCleared={refresh}
            />
            <SystemCell
              kind="history"
              icon={<History className="w-3.5 h-3.5" />}
              name="Conversation history (user-level)"
              description="Per-user cross-chat history Junior remembers, keyed by openId. Merged with chat-level on each turn."
              right={stats.user ? `${stats.user.fileCount} users · ${stats.user.totalMessages} msgs` : '—'}
              clearScope="user"
              onCleared={refresh}
            />
            {/* Markdown context files */}
            {files.length === 0 ? (
              <div className="text-center text-sm text-gray-500 py-8">
                No context files yet.
              </div>
            ) : (
              files.map(f => (
                <ContextCard
                  key={f.name}
                  file={f}
                  expanded={expandedName === f.name}
                  onToggle={() => setExpandedName(expandedName === f.name ? null : f.name)}
                  onSaved={refresh}
                />
              ))
            )}
          </div>
        )}
      </div>

      {showCreate && (
        <CreateFileModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); refresh(); }} />
      )}
    </div>
  );
}

function SystemCell({
  kind, icon, name, description, right, clearScope, onCleared,
}: {
  kind: 'live' | 'history' | 'plain';
  icon: React.ReactNode;
  name: string;
  description: string;
  right?: string;
  clearScope?: 'chat' | 'user';
  onCleared?: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function handleClear() {
    if (!clearScope) return;
    if (!confirm(`Clear all ${clearScope}-level conversation history? This cannot be undone.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/junior-history/${clearScope}`, { method: 'DELETE' });
      const data = await res.json() as { ok?: boolean; deleted?: number; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Clear failed');
      toast.success(`Cleared ${data.deleted ?? 0} file(s)`);
      onCleared?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Clear failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="context-card">
      <div className={`icon-wrap ${kind === 'live' ? 'live' : kind === 'history' ? 'history' : ''}`}>
        {icon}
      </div>
      <div className="body">
        <div className="ctx-name">{name}</div>
        <div className="ctx-desc">{description}</div>
      </div>
      <div className="ctx-meta flex flex-col items-end gap-1.5">
        {right && <div>{right}</div>}
        {clearScope && (
          <button
            onClick={handleClear}
            disabled={busy}
            className="hm-btn"
            style={{
              height: 26,
              color: 'var(--rose)',
              borderColor: 'oklch(0.62 0.20 22 / 0.3)',
              background: 'oklch(0.62 0.20 22 / 0.08)',
            }}
            title={`Clear all ${clearScope}-level history`}
          >
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
            Clear context
          </button>
        )}
      </div>
    </div>
  );
}

function ContextCard({ file, expanded, onToggle, onSaved }: {
  file: ContextFile;
  expanded: boolean;
  onToggle: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState(file.content);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setDraft(file.content); }, [file.content, expanded]);

  const isDirty = draft !== file.content;

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/junior-context/${encodeURIComponent(file.name)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: draft }),
      });
      if (!res.ok) throw new Error('Save failed');
      toast.success(`Saved ${file.name}`);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete ${file.name}? This will remove it from Junior's context.`)) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/junior-context/${encodeURIComponent(file.name)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      toast.success(`Deleted ${file.name}`);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setSaving(false);
    }
  }

  const desc = describe(file.name);

  return (
    <div>
      <button onClick={onToggle} className="context-card w-full text-left">
        <div className="icon-wrap">
          <FileText className="w-3.5 h-3.5" />
        </div>
        <div className="body">
          <div className="ctx-name font-mono">{file.name}</div>
          {desc && <div className="ctx-desc">{desc}</div>}
        </div>
        <div className="ctx-meta">
          <div>{file.content.length.toLocaleString()} chars</div>
          {file.updatedAt && (
            <div className="mt-0.5">
              {new Date(file.updatedAt).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' })}
            </div>
          )}
        </div>
      </button>

      {expanded && (
        <div className="bg-[var(--bg-elev-1)] border border-[var(--hairline)] border-t-0 rounded-b-[var(--r-md)] -mt-px px-4 pb-4">
          <div className="mt-3 mb-2 flex items-center justify-end gap-1.5">
            <button onClick={handleDelete} disabled={saving} className="hm-btn"
              style={{ height: 26, color: 'var(--rose)', borderColor: 'oklch(0.62 0.20 22 / 0.3)', background: 'oklch(0.62 0.20 22 / 0.08)' }}>
              <Trash2 className="w-3 h-3" />
              Delete
            </button>
            <button onClick={handleSave} disabled={!isDirty || saving} className="hm-btn hm-btn-ai" style={{ height: 26 }}>
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
              Save
            </button>
          </div>
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder="# Heading&#10;&#10;Markdown content..."
            className="w-full min-h-[300px] px-3 py-2 bg-[var(--card-hover)] border border-[var(--border)] rounded-lg text-xs font-mono text-[var(--foreground)] focus:outline-none focus:border-blue-500 resize-y"
            spellCheck={false}
          />
        </div>
      )}
    </div>
  );
}

function CreateFileModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      const res = await fetch('/api/junior-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed.endsWith('.md') ? trimmed : `${trimmed}.md`, content }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Create failed');
      toast.success(`Created ${trimmed}`);
      onCreated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Create failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-6 w-[480px] max-w-full"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-lg text-[var(--foreground)] mb-3" style={{ fontFamily: 'var(--font-newsreader)' }}>
          New context file
        </h2>
        <div className="flex flex-col gap-3">
          <label className="text-xs text-[var(--muted)]">
            Filename (e.g. <code>skill_prd_review.md</code>)
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="filename.md"
              className="w-full mt-1 px-3 py-2 bg-[var(--card-hover)] border border-[var(--border)] rounded-lg text-sm text-[var(--foreground)] focus:outline-none focus:border-blue-500"
              autoFocus
            />
          </label>
          <label className="text-xs text-[var(--muted)]">
            Content (Markdown)
            <textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder="# Heading..."
              className="w-full mt-1 min-h-[200px] px-3 py-2 bg-[var(--card-hover)] border border-[var(--border)] rounded-lg text-xs font-mono text-[var(--foreground)] focus:outline-none focus:border-blue-500 resize-y"
              spellCheck={false}
            />
          </label>
          <div className="flex justify-end gap-2 mt-1">
            <button onClick={onClose} className="px-4 py-1.5 text-xs text-[var(--muted)] hover:text-[var(--foreground)] rounded-lg">
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={!name.trim() || saving}
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium bg-blue-700 hover:bg-blue-600 text-white rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
              Create
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
