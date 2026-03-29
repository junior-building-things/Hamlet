'use client';
import { useState } from 'react';
import { Feature, Priority } from '@/lib/types';
import { CheckCircle2, ExternalLink, Loader2, RefreshCw } from 'lucide-react';

interface Props {
  features: Feature[];
  setFeatures: React.Dispatch<React.SetStateAction<Feature[]>>;
}

export function TodoView({ features, setFeatures }: Props) {
  const [completing, setCompleting] = useState<string | null>(null);
  const [completed,  setCompleted]  = useState<Set<string>>(new Set());
  const [errors,     setErrors]     = useState<Record<string, string>>({});

  // Features where the user is the assignee on an active node
  const todos = features.filter(f => f.canCompleteNode === true && !completed.has(f.id));

  // Features still syncing (canCompleteNode not yet determined)
  const syncing = features.filter(f => f.canCompleteNode === undefined && f.meegoUrl);

  async function completeNode(feature: Feature) {
    if (!feature.meegoProjectKey || !feature.meegoIssueId || !feature.meegoNodeKey) {
      setErrors(prev => ({ ...prev, [feature.id]: 'Missing node info — try syncing first.' }));
      return;
    }
    setCompleting(feature.id);
    setErrors(prev => { const n = { ...prev }; delete n[feature.id]; return n; });

    try {
      const res = await fetch('/api/meego/complete-node', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          projectKey: feature.meegoProjectKey,
          workItemId: feature.meegoIssueId,
          nodeKey:    feature.meegoNodeKey,
        }),
      });
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        throw new Error(d.error ?? 'Failed');
      }

      setCompleted(prev => new Set([...prev, feature.id]));

      // Trigger a background re-sync for this feature
      if (feature.meegoUrl) {
        fetch('/api/meego/sync', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ meegoUrl: feature.meegoUrl }),
        })
          .then(r => r.ok ? r.json() : null)
          .then((d: Record<string, unknown> | null) => {
            if (!d) return;
            setFeatures(prev => prev.map(f => f.id !== feature.id ? f : {
              ...f,
              status:          (d.status         as string) || f.status,
              canCompleteNode: d.canCompleteNode  as boolean,
              meegoNodeKey:    (d.meegoNodeKey    as string) || f.meegoNodeKey,
              priority:        ((d.priority as Priority) ?? f.priority),
              lastUpdated:     new Date().toISOString().split('T')[0],
            }));
          })
          .catch(() => {});
      }
    } catch (err) {
      setErrors(prev => ({ ...prev, [feature.id]: err instanceof Error ? err.message : 'Failed' }));
    } finally {
      setCompleting(null);
    }
  }

  return (
    <div className="min-h-screen px-6 py-7">
      <div className="mb-6">
        <h1 className="text-2xl text-white" style={{ fontFamily: 'var(--font-newsreader)' }}>
          To Dos
        </h1>
        <p className="text-sm text-gray-500 mt-1">Nodes waiting for your action</p>
      </div>

      {/* Still loading sync data */}
      {todos.length === 0 && syncing.length > 0 && (
        <div className="flex items-center gap-2 text-gray-500 py-12 justify-center">
          <Loader2 className="w-4 h-4 animate-spin text-purple-500" />
          <span className="text-sm">Checking for pending nodes…</span>
        </div>
      )}

      {/* No features loaded at all */}
      {features.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-12 text-gray-500">
          <Loader2 className="w-6 h-6 animate-spin text-purple-500" />
          <p className="text-sm">Loading features…</p>
        </div>
      )}

      {/* All synced but nothing to do */}
      {features.length > 0 && syncing.length === 0 && todos.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-16 text-gray-500">
          <CheckCircle2 className="w-10 h-10 text-emerald-500/60" />
          <p className="text-sm font-medium text-gray-400">You&apos;re all caught up!</p>
          <p className="text-xs text-gray-600">No pending nodes assigned to you.</p>
        </div>
      )}

      {/* Todo cards */}
      {todos.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-5xl">
          {todos.map(feature => (
            <TodoCard
              key={feature.id}
              feature={feature}
              completing={completing === feature.id}
              error={errors[feature.id]}
              onComplete={() => completeNode(feature)}
            />
          ))}
        </div>
      )}

      {/* Recently completed (this session) */}
      {completed.size > 0 && (
        <div className="mt-10">
          <h2 className="text-xs font-bold tracking-wide text-gray-500 mb-3">COMPLETED THIS SESSION</h2>
          <div className="flex flex-col gap-2">
            {features
              .filter(f => completed.has(f.id))
              .map(f => (
                <div key={f.id} className="flex items-center gap-3 text-sm text-gray-500">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                  <span>{f.name}</span>
                  <span className="text-gray-600">·</span>
                  <span>{f.status}</span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Todo Card ────────────────────────────────────────────────────────────────

function TodoCard({
  feature, completing, error, onComplete,
}: {
  feature: Feature;
  completing: boolean;
  error?: string;
  onComplete: () => void;
}) {
  const [syncing, setSyncing] = useState(false);

  async function handleRefresh() {
    if (!feature.meegoUrl) return;
    setSyncing(true);
    try {
      await fetch('/api/meego/sync', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meegoUrl: feature.meegoUrl }),
      });
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="bg-[#0e1120] border border-[#1e2240] rounded-2xl p-5 flex flex-col gap-4">
      {/* Feature name */}
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-medium text-white leading-snug">{feature.name}</h3>
        <button
          onClick={handleRefresh}
          disabled={syncing}
          className="shrink-0 text-gray-600 hover:text-gray-300 transition-colors disabled:opacity-40"
          title="Refresh"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Node badge */}
      <div className="flex items-center gap-2">
        <span className="text-xs bg-[#1e2240] text-purple-300 px-2.5 py-1 rounded-full">
          {feature.status}
        </span>
        {feature.priority && (
          <span className="text-xs text-gray-500">{feature.priority}</span>
        )}
      </div>

      {/* Links */}
      <div className="flex items-center gap-3">
        {feature.meegoUrl && (
          <a
            href={feature.meegoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-purple-400 hover:text-purple-300 flex items-center gap-1 transition-colors"
            style={{ textDecoration: 'none' }}
          >
            Meego <ExternalLink className="w-3 h-3" />
          </a>
        )}
        {feature.prd && (
          <a
            href={feature.prd}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 transition-colors"
            style={{ textDecoration: 'none' }}
          >
            PRD <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>

      {/* Error */}
      {error && <p className="text-xs text-red-400">{error}</p>}

      {/* Complete button */}
      <button
        onClick={onComplete}
        disabled={completing}
        className="flex items-center justify-center gap-2 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors w-full"
      >
        {completing ? (
          <><Loader2 className="w-4 h-4 animate-spin" /> Completing…</>
        ) : (
          <><CheckCircle2 className="w-4 h-4" /> Complete: {feature.status}</>
        )}
      </button>
    </div>
  );
}
