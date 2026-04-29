'use client';
import { useState, useEffect, useCallback } from 'react';
import { Loader2, Save, Trash2, Plus, FileText } from 'lucide-react';
import { toast } from 'sonner';

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
  const [loading, setLoading] = useState(true);
  const [expandedName, setExpandedName] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/junior-context');
      const data = await res.json() as { files?: ContextFile[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Failed to load');
      setFiles(data.files ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load context files');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-6 pt-7 pb-2 flex items-center justify-between">
        <div>
          <h1 className="text-2xl text-[var(--foreground)]" style={{ fontFamily: 'var(--font-newsreader)' }}>
            Junior Context
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Markdown files appended to Junior&apos;s system prompt at chat time. Edits propagate within ~60 seconds.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-700 hover:bg-blue-600 text-white rounded-lg transition-colors"
        >
          <Plus className="w-3 h-3" />
          New file
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-6 pb-16 mt-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3 text-gray-500">
            <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
          </div>
        ) : files.length === 0 ? (
          <div className="text-center text-sm text-gray-500 py-12">
            No context files yet. Click <strong>New file</strong> to create the first one (e.g. <code>system.md</code>).
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {files.map(f => (
              <ContextCard
                key={f.name}
                file={f}
                expanded={expandedName === f.name}
                onToggle={() => setExpandedName(expandedName === f.name ? null : f.name)}
                onSaved={refresh}
              />
            ))}
          </div>
        )}
      </div>

      {showCreate && (
        <CreateFileModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); refresh(); }} />
      )}
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
    <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-[var(--card-hover)] rounded-xl transition-colors"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <FileText className="w-3.5 h-3.5 text-blue-500 shrink-0" />
            <span className="text-sm font-medium text-[var(--foreground)] font-mono">{file.name}</span>
          </div>
          {desc && <div className="text-xs text-[var(--muted)] truncate">{desc}</div>}
        </div>
        <div className="text-right shrink-0">
          <div className="text-[10px] text-gray-500">{file.content.length.toLocaleString()} chars</div>
          {file.updatedAt && (
            <div className="text-[10px] text-gray-500 mt-0.5">
              {new Date(file.updatedAt).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' })}
            </div>
          )}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t border-[var(--border)]">
          <div className="mt-3 mb-2 flex items-center justify-end gap-2">
            <button
              onClick={handleDelete}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-red-400 hover:text-red-300 border border-[var(--border)] rounded-lg disabled:opacity-50"
            >
              <Trash2 className="w-3 h-3" />
              Delete
            </button>
            <button
              onClick={handleSave}
              disabled={!isDirty || saving}
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium bg-blue-700 hover:bg-blue-600 text-white rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
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
