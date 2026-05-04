'use client';
import { useState, useEffect, useCallback } from 'react';
import { Loader2, RotateCcw, Save, Check, Search } from 'lucide-react';
import { toast } from 'sonner';
import { MetaSelect, MetaTag, MetaTagTone } from '@/components/MetaCard';

type ThinkingBudget = 'dynamic' | 'off' | 'minimal' | 'low' | 'medium' | 'high';

const THINKING_BUDGET_OPTIONS: ThinkingBudget[] = ['dynamic', 'off', 'minimal', 'low', 'medium', 'high'];
const MODEL_OPTIONS = ['gemini-3.1-flash-lite-preview', 'gemini-2.5-flash-lite'] as const;

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

const SERVICE_TONE: Record<string, MetaTagTone> = {
  hamlet: 'hamlet',
  junior: 'junior',
  rio:    'rio',
  mia:    'mia',
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

  const SERVICE_ORDER: Record<string, number> = { junior: 0, rio: 1, mia: 2, hamlet: 3 };
  const filtered = prompts
    .filter(p => {
      if (filter !== 'all' && p.service !== filter) return false;
      if (search && !p.name.toLowerCase().includes(search.toLowerCase()) && !p.id.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    })
    .sort((a, b) => {
      const sa = SERVICE_ORDER[a.service] ?? 99;
      const sb = SERVICE_ORDER[b.service] ?? 99;
      if (sa !== sb) return sa - sb;
      return a.name.localeCompare(b.name);
    });

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Page header */}
      <div className="shrink-0 px-5 py-4 border-b border-[var(--hairline)]">
        <div className="text-[18px] font-semibold text-[var(--text)] tracking-[-0.02em]">System Prompts</div>
        <div className="text-[12px] text-[var(--text-muted)] mt-0.5">
          Manage system prompts used across Hamlet and chat bots. Edits propagate within 1 min.
        </div>
      </div>

      {/* Toolbar — search + service filter chips */}
      <div className="shrink-0 px-5 py-3 border-b border-[var(--hairline)] flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-2 bg-[var(--bg-elev-2)] border border-[var(--hairline)] rounded-[var(--r-sm)] px-3 h-[30px] w-[240px] shrink-0">
          <Search className="w-3.5 h-3.5 text-[var(--text-dim)] shrink-0" />
          <input
            type="text"
            placeholder="Search prompts…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="bg-transparent text-[12px] text-[var(--text)] placeholder-[var(--text-dim)] outline-none w-full"
          />
          <span className="font-mono text-[9.5px] text-[var(--text-dim)] px-1 py-px rounded border border-[var(--hairline)]">⌘K</span>
        </div>
        {(['all', 'hamlet', 'junior', 'rio', 'mia'] as const).map(s => {
          const active = filter === s;
          return (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`inline-flex items-center h-7 px-2.5 rounded-[var(--r-sm)] border text-[11.5px] font-mono uppercase tracking-[0.04em] transition-colors ${
                active
                  ? 'bg-[var(--bg-elev-3)] border-[var(--hairline-strong)] text-[var(--text)]'
                  : 'bg-[var(--bg-elev-2)] border-[var(--hairline)] text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--hairline-strong)]'
              }`}
            >
              {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          );
        })}
        <span className="ml-auto font-mono text-[10.5px] uppercase tracking-[0.08em] text-[var(--text-dim)]">
          {filtered.length} prompt{filtered.length === 1 ? '' : 's'}
        </span>
      </div>

      {/* Prompts list */}
      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 pb-16">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3 text-[var(--text-muted)]">
            <Loader2 className="w-8 h-8 animate-spin text-[var(--ai)]" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center text-[12px] text-[var(--text-muted)] py-12">No prompts match.</div>
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
  const tone = SERVICE_TONE[prompt.service] ?? 'hamlet';

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
    <div className={`meta-card ${expanded ? 'expanded' : ''}`}>
      {/* Head row */}
      <button
        onClick={onToggle}
        className="flex items-center gap-2.5 flex-wrap text-left bg-transparent w-full"
      >
        <span className="text-[13px] font-medium text-[var(--text)]">
          {prompt.service.charAt(0).toUpperCase() + prompt.service.slice(1)} — {prompt.name}
        </span>
        <MetaTag tone={tone} label={prompt.service} />
        {prompt.isOverridden && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-mono text-[9.5px] uppercase tracking-[0.08em]"
                style={{ background: 'oklch(0.82 0.14 75 / 0.12)', color: 'var(--amber)' }}>
            <Check className="w-2.5 h-2.5" /> Overridden
          </span>
        )}
        <span className="ml-auto font-mono text-[10.5px] text-[var(--text-dim)]">{prompt.fileRef}</span>
      </button>

      {/* Description */}
      <div className="text-[11.5px] text-[var(--text-muted)] leading-[1.45]">{prompt.description}</div>

      {/* Meta row: model + thinking + variables note */}
      <div className="meta-row">
        <MetaSelect
          label="Model"
          value={modelDraft}
          options={MODEL_OPTIONS}
          onChange={v => setModelDraft(v)}
          isDefault={modelDraft === prompt.defaultModel}
        />
        <MetaSelect
          label="Thinking"
          value={budgetDraft}
          options={THINKING_BUDGET_OPTIONS}
          onChange={v => setBudgetDraft(v as ThinkingBudget)}
          isDefault={budgetDraft === prompt.defaultThinkingBudget}
        />
        <span className="meta-note">
          Variables:{' '}
          {prompt.variables.length > 0
            ? prompt.variables.map(v => `\${${v}}`).join(', ')
            : 'none'}
        </span>
      </div>

      {/* Expanded body — textarea + save/revert actions */}
      {expanded && (
        <>
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onClick={e => e.stopPropagation()}
            className="w-full min-h-[260px] px-3 py-2.5 rounded-[var(--r-sm)] bg-[var(--bg-elev-2)] border border-[var(--hairline)] font-mono text-[11.5px] leading-[1.6] text-[var(--text)] outline-none resize-y whitespace-pre-wrap"
            spellCheck={false}
          />
          <div className="flex items-center gap-1.5 justify-end">
            {prompt.isOverridden && (
              <button
                onClick={handleReset}
                disabled={saving}
                className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-[var(--r-sm)] bg-[var(--bg-elev-2)] border border-[var(--hairline)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-elev-3)] hover:border-[var(--hairline-strong)] text-[12px] transition-colors disabled:opacity-50"
              >
                <RotateCcw className="w-3 h-3" />
                Revert
              </button>
            )}
            <button
              onClick={handleSave}
              disabled={!isDirty || saving}
              className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-[var(--r-sm)] text-[12px] transition-colors disabled:opacity-40"
              style={{
                background: isDirty ? 'var(--ai-soft)' : 'var(--bg-elev-2)',
                color: isDirty ? 'var(--ai)' : 'var(--text-muted)',
                border: `1px solid ${isDirty ? 'oklch(0.82 0.14 var(--ai-h) / 0.3)' : 'var(--hairline)'}`,
              }}
            >
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
              Save
            </button>
          </div>
        </>
      )}
    </div>
  );
}
