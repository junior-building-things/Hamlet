'use client';
import { useState, useEffect, useCallback } from 'react';
import { Loader2, RotateCcw, Save, Check } from 'lucide-react';
import { toast } from 'sonner';

type ThinkingBudget = 'dynamic' | 'off' | 'minimal' | 'low' | 'medium' | 'high';

const THINKING_BUDGET_OPTIONS: ThinkingBudget[] = ['dynamic', 'off', 'minimal', 'low', 'medium', 'high'];
const MODEL_OPTIONS = ['gemini-3.1-flash-lite-preview', 'gemini-2.5-flash-lite'] as const;
type ModelName = typeof MODEL_OPTIONS[number];

interface PromptItem {
  id: string;
  name: string;
  service: 'hamlet' | 'junior' | 'rio' | 'mia';
  fileRef: string;
  model: string;
  description: string;
  variables: string[];
  default: string;
  current: string;
  defaultThinkingBudget: ThinkingBudget;
  currentThinkingBudget: ThinkingBudget;
  defaultModel: string;
  currentModel: string;
  isOverridden: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

const SERVICE_COLORS: Record<string, string> = {
  hamlet: 'bg-blue-500/15 text-blue-700 border border-blue-500/30',
  junior: 'bg-purple-500/15 text-purple-700 border border-purple-500/30',
  rio:    'bg-amber-500/15 text-amber-700 border border-amber-500/30',
  mia:    'bg-emerald-500/15 text-emerald-700 border border-emerald-500/30',
};

export function PromptsView() {
  const [prompts, setPrompts] = useState<PromptItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'hamlet' | 'junior' | 'rio' | 'mia'>('all');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/prompts');
      const data = await res.json() as { prompts?: PromptItem[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Failed to load');
      setPrompts(data.prompts ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load prompts');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const filtered = prompts.filter(p => {
    if (filter !== 'all' && p.service !== filter) return false;
    if (search && !p.name.toLowerCase().includes(search.toLowerCase()) && !p.id.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-6 pt-7 pb-2 flex items-center justify-between">
        <div>
          <h1 className="text-2xl text-[var(--foreground)]" style={{ fontFamily: 'var(--font-newsreader)' }}>
            Prompts
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Manage AI prompts used across Hamlet, Junior, Rio, and Mia. Edits take effect within 30 seconds.
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="shrink-0 px-6 pt-3 pb-2 flex items-center gap-3">
        <input
          type="text"
          placeholder="Search prompts..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="px-3 py-2 bg-[var(--card)] border border-[var(--border)] rounded-lg text-sm text-[var(--foreground)] placeholder:text-gray-500 focus:outline-none focus:border-blue-500 w-64"
        />
        <div className="flex items-center gap-1 bg-[var(--card)] border border-[var(--border)] rounded-lg p-1">
          {(['all', 'hamlet', 'junior', 'rio', 'mia'] as const).map(s => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                filter === s
                  ? 'bg-blue-700 text-white'
                  : 'text-[var(--muted)] hover:text-[var(--foreground)]'
              }`}
            >
              {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
        <span className="text-xs text-gray-500 ml-auto">{filtered.length} prompt{filtered.length === 1 ? '' : 's'}</span>
      </div>

      {/* Prompts list */}
      <div className="flex-1 overflow-y-auto px-6 pb-16 mt-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3 text-gray-500">
            <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center text-sm text-gray-500 py-12">No prompts match.</div>
        ) : (
          <div className="flex flex-col gap-2">
            {filtered.map(p => (
              <PromptCard
                key={p.id}
                prompt={p}
                expanded={expandedId === p.id}
                onToggle={() => setExpandedId(expandedId === p.id ? null : p.id)}
                onSave={refresh}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PromptCard({ prompt, expanded, onToggle, onSave }: {
  prompt: PromptItem;
  expanded: boolean;
  onToggle: () => void;
  onSave: () => void;
}) {
  const [draft, setDraft] = useState(prompt.current);
  const [budgetDraft, setBudgetDraft] = useState<ThinkingBudget>(prompt.currentThinkingBudget);
  const [modelDraft, setModelDraft] = useState<string>(prompt.currentModel);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(prompt.current);
    setBudgetDraft(prompt.currentThinkingBudget);
    setModelDraft(prompt.currentModel);
  }, [prompt.current, prompt.currentThinkingBudget, prompt.currentModel, expanded]);

  const isDirty = draft !== prompt.current || budgetDraft !== prompt.currentThinkingBudget || modelDraft !== prompt.currentModel;
  const serviceCls = SERVICE_COLORS[prompt.service] ?? '';

  async function handleSave() {
    setSaving(true);
    try {
      const body: { content?: string; thinkingBudget?: ThinkingBudget; model?: string } = {};
      if (draft !== prompt.current) body.content = draft;
      if (budgetDraft !== prompt.currentThinkingBudget) body.thinkingBudget = budgetDraft;
      if (modelDraft !== prompt.currentModel) body.model = modelDraft;
      const res = await fetch(`/api/prompts/${prompt.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('Save failed');
      toast.success('Prompt saved');
      onSave();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    if (!confirm('Revert to the default prompt?')) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/prompts/${prompt.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Reset failed');
      toast.success('Reverted to default');
      onSave();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Reset failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-[var(--card-hover)] rounded-xl transition-colors"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${serviceCls}`}>
              {prompt.service}
            </span>
            <span className="text-sm font-medium text-[var(--foreground)]">{prompt.name}</span>
            {prompt.isOverridden && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-500/15 text-amber-700 border border-amber-500/30">
                <Check className="w-2.5 h-2.5" /> Overridden
              </span>
            )}
          </div>
          <div className="text-xs text-[var(--muted)] truncate">{prompt.description}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[11px] text-gray-500">{prompt.model}</div>
          <div className="text-[10px] text-gray-500 mt-0.5 font-mono">{prompt.fileRef}</div>
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t border-[var(--border)]">
          <div className="mt-3 mb-2 flex items-center justify-between gap-3">
            <div className="text-xs text-[var(--muted)] flex items-center gap-3 flex-wrap">
              <label className="inline-flex items-center gap-1.5">
                <span className="text-[11px]">Model:</span>
                <select
                  value={modelDraft}
                  onChange={e => setModelDraft(e.target.value as ModelName)}
                  className="bg-[var(--card-hover)] border border-[var(--border)] rounded px-2 py-0.5 text-[11px] text-[var(--foreground)] focus:outline-none focus:border-blue-500"
                >
                  {MODEL_OPTIONS.map(m => (
                    <option key={m} value={m}>
                      {m}{m === prompt.defaultModel ? ' (default)' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label className="inline-flex items-center gap-1.5">
                <span className="text-[11px]">Thinking budget:</span>
                <select
                  value={budgetDraft}
                  onChange={e => setBudgetDraft(e.target.value as ThinkingBudget)}
                  className="bg-[var(--card-hover)] border border-[var(--border)] rounded px-2 py-0.5 text-[11px] text-[var(--foreground)] focus:outline-none focus:border-blue-500"
                >
                  {THINKING_BUDGET_OPTIONS.map(b => (
                    <option key={b} value={b}>
                      {b}{b === prompt.defaultThinkingBudget ? ' (default)' : ''}
                    </option>
                  ))}
                </select>
              </label>
              {prompt.variables.length > 0 && (
                <span>Variables: {prompt.variables.map(v => <code key={v} className="bg-[var(--card-hover)] px-1.5 py-0.5 rounded mr-1 text-[11px]">${`{${v}}`}</code>)}</span>
              )}
              {prompt.updatedAt && (
                <span className="text-[11px]">
                  Last edited {new Date(prompt.updatedAt).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' })}
                  {prompt.updatedBy && ` by ${prompt.updatedBy}`}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {prompt.isOverridden && (
                <button
                  onClick={handleReset}
                  disabled={saving}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-[var(--muted)] hover:text-[var(--foreground)] border border-[var(--border)] rounded-lg disabled:opacity-50"
                >
                  <RotateCcw className="w-3 h-3" />
                  Revert to default
                </button>
              )}
              <button
                onClick={handleSave}
                disabled={!isDirty || saving}
                className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium bg-blue-700 hover:bg-blue-600 text-white rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                Save
              </button>
            </div>
          </div>
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            className="w-full min-h-[300px] px-3 py-2 bg-[var(--card-hover)] border border-[var(--border)] rounded-lg text-xs font-mono text-[var(--foreground)] focus:outline-none focus:border-blue-500 resize-y"
            spellCheck={false}
          />
        </div>
      )}
    </div>
  );
}
