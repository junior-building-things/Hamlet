'use client';
import React, { useState, useCallback, useMemo } from 'react';
import { Feature, Priority } from '@/lib/types';
import { FilterBar } from './FilterBar';
import { FeatureListHeader } from './FeatureListHeader';
import { FeatureListItem } from './FeatureListItem';
import { FeatureModal } from './FeatureModal';
import { FeatureDrawer } from './FeatureDrawer';
import { JuniorBrief } from './JuniorBrief';
import { STATUS_TONE, STATUS_TONE_STYLES } from './StatusBadge';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { AV } from '@/lib/avatars';
import { useViewedFeatures } from '@/lib/viewedFeatures';

const STATUS_GROUP_ORDER: Record<string, number> = {
  'AB Testing': 1, 'Merged': 2, 'QA Testing': 3, 'Development': 4,
  'Tech Design': 5, 'PRD Walkthrough': 6, 'RD Allocation': 7,
  'Dependency Check': 8, 'PRD/Design Prep': 9, 'Done': 10,
};

// Match ProjectView's GroupHeader visuals — same status-tone pill +
// breathing dot + fading hairline.
function GroupHeader({ label, count, first }: { label: string; count: number; first: boolean }) {
  const tone = STATUS_TONE[label] ?? 'gray';
  const s = STATUS_TONE_STYLES[tone];
  return (
    <div
      className={`flex items-center gap-2.5 py-2 sticky bg-[var(--bg-elev-1)] z-[5] ${first ? 'mt-1' : 'mt-3'}`}
      style={{ top: 34 }}
    >
      <span
        className="inline-flex items-center gap-1.5 px-2.5 py-[3px] rounded-full font-mono text-[10px] font-medium uppercase tracking-[0.06em] whitespace-nowrap"
        style={{ background: s.bg, color: s.fg }}
      >
        {label || '—'}
      </span>
      <span className="font-mono text-[10.5px] text-[var(--text-dim)]">{count}</span>
      <span className="flex-1 h-px ml-1" style={{ background: 'linear-gradient(90deg, var(--hairline) 0%, transparent 90%)' }} />
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
  const [search,        setSearch]        = useState('');
  const { hasUnread, markViewed } = useViewedFeatures();
  const openDrawer = useCallback((f: Feature) => {
    markViewed(f.id);
    setDrawerFeature(f);
  }, [markViewed]);

  // Features where the user is the assignee on an active node (excluding completed ones)
  const allTodos = features.filter(f =>
    f.canCompleteNode === true &&
    !completed.has(f.id) &&
    f.status !== 'Done' &&
    f.status !== '结束'
  );
  // Free-text search filter applied on top.
  const todos = search.trim()
    ? allTodos.filter(f => f.name.toLowerCase().includes(search.trim().toLowerCase()))
    : allTodos;

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
  // Mostly the same template ProjectView uses, but with a wider Action
  // column (120px → fits the "Complete" hm-btn) since To Dos always
  // renders that button. ProjectView hides Action entirely.
  // Feature capped at 400px so Notes (1fr) gets the leftover space.
  const gridTemplateColumns =
    'minmax(240px,400px) 150px 56px 55px 130px 80px 80px minmax(200px,1fr) 120px 40px';

  return (
    <div className="h-full flex flex-col overflow-hidden">

      {/* Page header — matches Ongoing Features */}
      <div className="shrink-0 px-5 py-4 border-b border-[var(--hairline)]">
        <div className="text-[18px] font-semibold text-[var(--text)] tracking-[-0.02em]">To Dos</div>
        <div className="text-[12px] text-[var(--text-muted)] mt-0.5">
          Features pending your action — auto-filtered, search to narrow.
        </div>
      </div>

      {/* Junior — actionable-todos summary, dismissible per-day. */}
      <div className="shrink-0">
        <JuniorBrief
          mode="todos"
          features={features}
          onCompleteAll={completeAll}
          completeAllRunning={bulkRunning}
        />
      </div>

      {/* Toolbar — search-only mode (no filter / group / sort) */}
      <div className="shrink-0">
        <FilterBar
          search={search}
          statusFilter={[]}    statuses={[]}
          priorityFilter={[]}
          onSearchChange={setSearch}
          onStatusChange={() => {}}
          onPriorityChange={() => {}}
          onAddFeature={() => {}}  hideAddButton
          groupBy={'none'}     onGroupByChange={() => {}}
          sortBy={'none'}      onSortByChange={() => {}}
          sortDir={'asc'}      onSortDirToggle={() => {}}
          searchOnly
        />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-16">
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
                    onOpenDetail={openDrawer}
                    onSync={syncOne}
                    completing={completingId === f.id}
                    onComplete={handleComplete}
                    hasUpdate={hasUnread(f)}
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
