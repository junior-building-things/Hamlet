'use client';
import { useState } from 'react';
import { Feature, Priority } from '@/lib/types';
import { FeatureListHeader } from './FeatureListHeader';
import { FeatureListItem } from './FeatureListItem';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  features: Feature[];
  setFeatures: React.Dispatch<React.SetStateAction<Feature[]>>;
}

export function TodoView({ features, setFeatures }: Props) {
  const [completingId,  setCompletingId]  = useState<string | null>(null);
  const [completed,     setCompleted]     = useState<Set<string>>(new Set());
  const [bulkRunning,   setBulkRunning]   = useState<string | null>(null);

  // Features where the user is the assignee on an active node
  const todos = features.filter(f => f.canCompleteNode === true && !completed.has(f.id));

  // Features still syncing (canCompleteNode not yet determined)
  const syncing = features.filter(f => f.canCompleteNode === undefined && f.meegoUrl);

  // Bulk completion groups
  const pmAcceptanceTodos   = todos.filter(f => f.status === 'PM Acceptance');
  const uiuxAcceptanceTodos = todos.filter(f => f.status === 'UI/UX Acceptance');

  async function handleComplete(feature: Feature) {
    if (!feature.meegoProjectKey || !feature.meegoIssueId || !feature.meegoNodeKey) {
      toast.error('Missing node info — try syncing first.');
      return;
    }
    setCompletingId(feature.id);
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
      toast.success(`"${feature.status}" marked as complete`);

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
              status:          (d.status as string) || f.status,
              canCompleteNode: d.canCompleteNode as boolean,
              meegoNodeKey:    (d.meegoNodeKey as string) || f.meegoNodeKey,
              priority:        ((d.priority as Priority) ?? f.priority),
              lastUpdated:     new Date().toISOString().split('T')[0],
            }));
          })
          .catch(() => {});
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to complete node');
    } finally {
      setCompletingId(null);
    }
  }

  async function bulkComplete(nodeType: string, items: Feature[]) {
    if (items.length === 0 || bulkRunning) return;
    setBulkRunning(nodeType);
    let count = 0;
    for (const feature of items) {
      try {
        await handleComplete(feature);
        count++;
      } catch {
        // individual errors handled by handleComplete
      }
    }
    setBulkRunning(null);
    toast.success(`Completed ${count}/${items.length} ${nodeType} nodes`);
  }

  const listGridCls = 'flex flex-col gap-2 sm:grid sm:grid-cols-[2fr_auto_auto_220px_auto_1fr_auto] sm:gap-x-4 sm:gap-y-2';

  return (
    <div className="min-h-screen">

      {/* Header */}
      <div className="px-6 pt-7 pb-2">
        <h1 className="text-2xl text-white" style={{ fontFamily: 'var(--font-newsreader)' }}>
          To Dos
        </h1>
        <p className="text-sm text-gray-500 mt-1">Nodes waiting for your action</p>
      </div>

      {/* Bulk completion cards */}
      {(pmAcceptanceTodos.length > 0 || uiuxAcceptanceTodos.length > 0) && (
        <div className="px-6 py-3 flex items-center gap-3 flex-wrap">
          {pmAcceptanceTodos.length > 0 && (
            <button
              onClick={() => bulkComplete('PM Acceptance', pmAcceptanceTodos)}
              disabled={!!bulkRunning}
              className="flex items-center gap-2.5 px-4 py-2.5 bg-[#0e1120] border border-[#1e2240] rounded-xl hover:border-purple-500/40 transition-colors disabled:opacity-50"
            >
              {bulkRunning === 'PM Acceptance'
                ? <Loader2 className="w-4 h-4 text-purple-400 animate-spin" />
                : <CheckCircle2 className="w-4 h-4 text-purple-400" />}
              <span className="text-sm text-white font-medium">Complete All PM Acceptance</span>
              <span className="text-xs text-gray-500">{pmAcceptanceTodos.length}</span>
            </button>
          )}
          {uiuxAcceptanceTodos.length > 0 && (
            <button
              onClick={() => bulkComplete('UI/UX Acceptance', uiuxAcceptanceTodos)}
              disabled={!!bulkRunning}
              className="flex items-center gap-2.5 px-4 py-2.5 bg-[#0e1120] border border-[#1e2240] rounded-xl hover:border-blue-500/40 transition-colors disabled:opacity-50"
            >
              {bulkRunning === 'UI/UX Acceptance'
                ? <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
                : <CheckCircle2 className="w-4 h-4 text-blue-400" />}
              <span className="text-sm text-white font-medium">Complete All UI/UX Acceptance</span>
              <span className="text-xs text-gray-500">{uiuxAcceptanceTodos.length}</span>
            </button>
          )}
        </div>
      )}

      <div className="px-6 pb-16 mt-4">
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

        {/* Todo list — same layout as Project View */}
        {todos.length > 0 && (
          <div className={listGridCls}>
            <FeatureListHeader />
            {todos.map(f => (
              <FeatureListItem
                key={f.id}
                feature={f}
                syncing={false}
                onEdit={() => {}}
                onSync={() => {}}
                completing={completingId === f.id}
                onComplete={handleComplete}
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
    </div>
  );
}
