'use client';
import React, { useState, useCallback, useMemo } from 'react';
import { Feature, Priority } from '@/lib/types';
import { FeatureListHeader } from './FeatureListHeader';
import { FeatureListItem } from './FeatureListItem';
import { FeatureModal } from './FeatureModal';
import { FeatureDrawer } from './FeatureDrawer';
import { ThemeToggle } from './FilterBar';
import { statusStyle } from './StatusBadge';
import { CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { AV } from '@/lib/avatars';

const STATUS_GROUP_ORDER: Record<string, number> = {
  'AB Testing': 1, 'Merged': 2, 'QA Testing': 3, 'Development': 4,
  'Tech Design': 5, 'PRD Walkthrough': 6, 'RD Allocation': 7,
  'Dependency Check': 8, 'PRD/Design Prep': 9, 'Done': 10,
};

function statusChipCls(key: string): string {
  return statusStyle(key);
}

function GroupHeader({ label, count, first }: { label: string; count: number; first: boolean }) {
  return (
    <div className={`flex items-center gap-2.5 px-1 ${first ? 'mt-2' : 'mt-5'}`}>
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded text-xs font-semibold whitespace-nowrap ${statusChipCls(label)}`}>
        {label || '—'}
      </span>
      <span className="text-xs text-gray-600">{count}</span>
    </div>
  );
}

interface Props {
  features: Feature[];
  setFeatures: React.Dispatch<React.SetStateAction<Feature[]>>;
}

export function TodoView({ features, setFeatures }: Props) {
  const [completingId,  setCompletingId]  = useState<string | null>(null);
  const [completed,     setCompleted]     = useState<Set<string>>(new Set());
  const [bulkRunning,   setBulkRunning]   = useState(false);
  const [syncingAll,    setSyncingAll]    = useState(false);
  const [syncingIds,    setSyncingIds]    = useState<Set<string>>(new Set());
  const [editingFeature, setEditing]      = useState<Feature | undefined>();
  const [modalMode,     setModalMode]     = useState<'edit' | null>(null);
  const [drawerFeature, setDrawerFeature] = useState<Feature | null>(null);

  // Features where the user is the assignee on an active node (excluding completed ones)
  const todos = features.filter(f =>
    f.canCompleteNode === true &&
    !completed.has(f.id) &&
    f.status !== 'Done' &&
    f.status !== '结束'
  );

  // Features still syncing (canCompleteNode not yet determined)
  const syncing = features.filter(f => f.canCompleteNode === undefined && f.meegoUrl);

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

  async function completeAll() {
    if (todos.length === 0 || bulkRunning) return;
    setBulkRunning(true);
    let count = 0;
    for (const feature of todos) {
      try {
        await handleComplete(feature);
        count++;
      } catch { /* individual errors handled by handleComplete */ }
    }
    setBulkRunning(false);
    toast.success(`Completed ${count}/${todos.length} nodes`);
  }

  // ── Sync ──────────────────────────────────────────────────────────────────
  const syncOne = useCallback(async (feature: Feature) => {
    if (!feature.meegoUrl) return;
    setSyncingIds(prev => new Set(prev).add(feature.id));
    try {
      const res = await fetch('/api/meego/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meegoUrl: feature.meegoUrl, chatId: feature.chatId }),
      });
      if (!res.ok) throw new Error('Sync failed');
      const d = await res.json() as Record<string, unknown>;
      if (d.pocAvatars && typeof d.pocAvatars === 'object') Object.assign(AV, d.pocAvatars);
      setFeatures(prev => prev.map(p => p.id !== feature.id ? p : {
        ...p, ...Object.fromEntries(Object.entries(d).filter(([, v]) => v !== '' && v !== null && v !== undefined)),
        lastUpdated: p.lastUpdated || (d.lastUpdated as string) || '',
      }));
    } catch { /* ignore */ }
    finally { setSyncingIds(prev => { const next = new Set(prev); next.delete(feature.id); return next; }); }
  }, [setFeatures]);

  async function syncAll() {
    setSyncingAll(true);
    const withUrl = features.filter(f => f.meegoUrl);
    for (const f of withUrl) {
      try { await syncOne(f); } catch { /* ignore */ }
    }
    setSyncingAll(false);
  }

  function openDetail(feature: Feature) {
    setEditing(feature);
    setModalMode('edit');
  }

  // ── Group by status with custom ordering ──────────────────────────────────
  const groups = useMemo(() => {
    const buckets = new Map<string, Feature[]>();
    for (const f of todos) {
      const key = f.status || '';
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(f);
    }
    const keys = [...buckets.keys()].sort((a, b) => {
      if (!a) return 1;
      if (!b) return -1;
      return (STATUS_GROUP_ORDER[a] ?? 99) - (STATUS_GROUP_ORDER[b] ?? 99);
    });
    return keys.map(key => ({ key, label: key || '—', items: buckets.get(key)! }));
  }, [todos]);

  const listGridCls = 'flex flex-col';
  // Same fixed-width template ProjectView uses, so the columns line up
  // 1:1 across both views.
  const gridTemplateColumns =
    'minmax(240px,1fr) 150px 80px 64px 184px 120px 100px minmax(120px,200px) 80px 40px';

  return (
    <div className="h-full flex flex-col overflow-hidden">

      {/* Header (sticky) */}
      <div className="shrink-0 px-6 pt-7 pb-2 flex items-center justify-between">
        <div>
          <h1 className="text-2xl text-[var(--foreground)]" style={{ fontFamily: 'var(--font-newsreader)' }}>
            To Dos
          </h1>
          <p className="text-sm text-gray-500 mt-1">Projects pending your action</p>
        </div>
        {/* Theme toggle + Sync All live in the page-level GlobalActions
            (top-right of every tab) for cross-tab consistency. */}
        <div aria-hidden className="invisible" />
      </div>

      {/* Action bar (sticky) */}
      <div className="shrink-0 flex items-center gap-2 px-6 mt-5 flex-wrap">
        <button
          onClick={completeAll}
          disabled={todos.length === 0 || bulkRunning}
          className="flex items-center gap-1.5 px-4 py-2 bg-blue-700 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors"
        >
          {bulkRunning
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <CheckCircle2 className="w-3.5 h-3.5" />}
          Complete All
          {todos.length > 0 && <span className="text-blue-200 font-normal">{todos.length}</span>}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-16 mt-4">
        {/* Still loading sync data */}
        {todos.length === 0 && syncing.length > 0 && (
          <div className="flex items-center gap-2 text-gray-500 py-12 justify-center">
            <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
            <span className="text-sm">Checking for pending nodes…</span>
          </div>
        )}

        {/* No features loaded at all */}
        {features.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-12 text-gray-500">
            <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
            <p className="text-sm">Loading features…</p>
          </div>
        )}

        {/* All synced but nothing to do */}
        {features.length > 0 && syncing.length === 0 && todos.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-16 text-gray-500">
            <CheckCircle2 className="w-10 h-10 text-blue-500/60" />
            <p className="text-sm font-medium text-gray-400">You&apos;re all caught up!</p>
            <p className="text-xs text-gray-600">No pending nodes assigned to you.</p>
          </div>
        )}

        {/* Todo list — grouped by status */}
        {todos.length > 0 && (
          <div className={listGridCls}>
            <FeatureListHeader gridTemplateColumns={gridTemplateColumns} />
            {groups.map((group, gi) => (
              <React.Fragment key={group.key}>
                <GroupHeader label={group.label} count={group.items.length} first={gi === 0} />
                {group.items.map(f => (
                  <FeatureListItem
                    key={f.id}
                    feature={f}
                    syncing={syncingIds.has(f.id)}
                    onEdit={openDetail}
                    onOpenDetail={setDrawerFeature}
                    onSync={syncOne}
                    completing={completingId === f.id}
                    onComplete={handleComplete}
                    gridTemplateColumns={gridTemplateColumns}
                  />
                ))}
              </React.Fragment>
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
                    <CheckCircle2 className="w-4 h-4 text-blue-500 shrink-0" />
                    <span>{f.name}</span>
                    <span className="text-gray-600">·</span>
                    <span>{f.status}</span>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>

      {/* Detail drawer */}
      <FeatureDrawer
        feature={drawerFeature}
        onClose={() => setDrawerFeature(null)}
        onEdit={feat => {
          setEditing(feat);
          setModalMode('edit');
          setDrawerFeature(null);
        }}
      />

      {/* Detail modal (full edit) — opened from drawer */}
      {modalMode === 'edit' && editingFeature && (
        <FeatureModal
          mode="edit"
          feature={editingFeature}
          onClose={() => { setModalMode(null); setEditing(undefined); }}
          onSave={() => {}}
        />
      )}
    </div>
  );
}
