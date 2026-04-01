'use client';
import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { Feature, Priority } from '@/lib/types';
import { FilterBar, GroupBy, SortBy, SortDir } from '@/components/FilterBar';
import { FeatureCard } from '@/components/FeatureCard';
import { FeatureListHeader } from '@/components/FeatureListHeader';
import { FeatureListItem } from '@/components/FeatureListItem';
import { FeatureModal } from '@/components/FeatureModal';
import { Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { AV } from '@/lib/avatars';

const STORAGE_KEY      = 'hamlet_features_v1';
const STORAGE_GROUP_BY = 'hamlet_group_by';
const STORAGE_SORT_BY  = 'hamlet_sort_by';
const STORAGE_SORT_DIR = 'hamlet_sort_dir';
const SYNC_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

const PRIORITY_ORDER: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

/** Append a new version to the history if it differs from the last entry */
function trackVersion(history: string[] | undefined, newVersion: string | undefined): string[] | undefined {
  if (!newVersion) return history;
  const h = history ?? [];
  if (h.length === 0 || h[h.length - 1] !== newVersion) return [...h, newVersion];
  return h;
}

// ─── Group header row (spans all 6 list columns) ──────────────────────────────

function priorityChipCls(key: string): string {
  switch (key) {
    case 'P0': return 'bg-red-900/50 border border-red-700 text-red-400';
    case 'P1': return 'bg-orange-900/50 border border-orange-700 text-orange-400';
    case 'P2': return 'bg-blue-900/50 border border-blue-700 text-blue-400';
    case 'P3': return 'bg-gray-800 border border-gray-700 text-gray-400';
    default:   return 'bg-[#1e2240] border border-[#2e3460] text-gray-400';
  }
}

function statusChipCls(key: string): string {
  const s = key.toLowerCase();
  if (s.includes('上线') || s.includes('launch') || s.includes('灰度') || s.includes('已发布') || s.includes('已完成') || s.includes('验收'))
    return 'bg-[#0d2b1f] border border-emerald-900 text-emerald-400';
  if (s.includes('ab') || s.includes('测试') || s.includes('testing'))
    return 'bg-[#1e2240] border border-yellow-900/50 text-yellow-300';
  if (s.includes('开发') || s.includes('dev') || s.includes('coding') || s.includes('impl'))
    return 'bg-[#1a2535] border border-blue-900/50 text-blue-300';
  if (s.includes('设计') || s.includes('design') || s.includes('走查'))
    return 'bg-[#1e2240] border border-blue-900/50 text-blue-300';
  if (s.includes('hold') || s.includes('暂停') || s.includes('搁置'))
    return 'bg-[#221a10] border border-amber-900 text-amber-400';
  return 'bg-[#1e2240] border border-[#2e3460] text-gray-300';
}

function groupChipCls(groupBy: GroupBy, key: string): string {
  if (!key) return 'bg-[#1e2240] border border-[#2e3460] text-gray-500';
  if (groupBy === 'priority') return priorityChipCls(key);
  if (groupBy === 'status')   return statusChipCls(key);
  return 'bg-[#1e2240] border border-[#2e3460] text-gray-300';
}

function GroupHeader({ label, count, first, groupBy }: { label: string; count: number; first: boolean; groupBy: GroupBy }) {
  const chipCls = groupChipCls(groupBy, label === '—' ? '' : label);
  return (
    <div className={`sm:col-span-full flex items-center gap-2.5 px-1 ${first ? 'mt-2' : 'mt-5'}`}>
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded text-xs font-semibold whitespace-nowrap ${chipCls}`}>
        {label || '—'}
      </span>
      <span className="text-xs text-gray-600">{count}</span>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  features: Feature[];
  setFeatures: React.Dispatch<React.SetStateAction<Feature[]>>;
  pinnedId?: string | null;
  onClearPin?: () => void;
}

export function ProjectView({ features, setFeatures, pinnedId, onClearPin }: Props) {
  const [view,           setView]           = useState<'grid' | 'list'>('list');
  const [search,         setSearch]         = useState('');
  const [statusFilter,   setStatusFilter]   = useState<string>('All');
  const [priorityFilter, setPriority]       = useState<Priority | 'All'>('All');
  const [loading,        setLoading]        = useState(features.length === 0);
  const [fetchError,     setFetchError]     = useState<string | null>(null);
  const [syncingAll,     setSyncingAll]     = useState(false);
  const [syncingId,      setSyncingId]      = useState<string | null>(null);
  const [detailSyncCount, setDetailSyncCount] = useState(0);
  const [detailSyncTotal, setDetailSyncTotal] = useState(0);
  const [modalMode,      setModalMode]      = useState<'edit' | null>(null);
  const [editingFeature, setEditing]        = useState<Feature | undefined>();
  const [completingId,   setCompletingId]   = useState<string | null>(null);

  // ── Persisted group + sort preferences ───────────────────────────────────

  const [groupBy, setGroupByState] = useState<GroupBy>(() => {
    if (typeof window === 'undefined') return 'none';
    return (localStorage.getItem(STORAGE_GROUP_BY) as GroupBy) || 'none';
  });
  const [sortBy, setSortByState] = useState<SortBy>(() => {
    if (typeof window === 'undefined') return 'none';
    return (localStorage.getItem(STORAGE_SORT_BY) as SortBy) || 'none';
  });
  const [sortDir, setSortDirState] = useState<SortDir>(() => {
    if (typeof window === 'undefined') return 'asc';
    return (localStorage.getItem(STORAGE_SORT_DIR) as SortDir) || 'asc';
  });

  function setGroupBy(v: GroupBy)  { setGroupByState(v);  localStorage.setItem(STORAGE_GROUP_BY, v); }
  function setSortBy(v: SortBy)    { setSortByState(v);   localStorage.setItem(STORAGE_SORT_BY, v); }
  function toggleSortDir() {
    const next: SortDir = sortDir === 'asc' ? 'desc' : 'asc';
    setSortDirState(next);
    localStorage.setItem(STORAGE_SORT_DIR, next);
  }

  // ── Detail sync ────────────────────────────────────────────────────────────

  const syncAllDetails = useCallback(async (list: Feature[]) => {
    const withUrl = list.filter(f => f.meegoUrl);
    if (withUrl.length === 0) return;
    setDetailSyncTotal(withUrl.length);
    setDetailSyncCount(0);
    const BATCH = 5;
    for (let i = 0; i < withUrl.length; i += BATCH) {
      await Promise.all(withUrl.slice(i, i + BATCH).map(async (f) => {
        try {
          const res  = await fetch('/api/meego/sync', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ meegoUrl: f.meegoUrl, chatId: f.chatId }),
          });
          if (!res.ok) return;
          const d = await res.json() as Record<string, unknown>;
          // Merge discovered avatars into the global AV map
          if (d.pocAvatars && typeof d.pocAvatars === 'object') {
            Object.assign(AV, d.pocAvatars);
          }
          setFeatures(prev => prev.map(p => p.id !== f.id ? p : {
            ...p,
            status:          (d.status          as string) || p.status,
            name:            (d.name             as string) || p.name,
            owner:           (d.owner            as string) || p.owner,
            meegoNodeKey:    (d.meegoNodeKey     as string) || p.meegoNodeKey,
            prd:             (d.prd              as string) || p.prd,
            figmaUrl:        (d.figmaUrl         as string) || p.figmaUrl,
            complianceUrl:   (d.complianceUrl    as string) || p.complianceUrl,
            priority:        ((d.priority as Priority) ?? p.priority),
            canCompleteNode: d.canCompleteNode   as boolean,
            quarterlyCycle:  (d.quarterlyCycle   as string) || p.quarterlyCycle,
            businessLine:    (d.businessLine     as string) || p.businessLine,
            socialComponent: (d.socialComponent  as string) || p.socialComponent,
            pmOwner:         (d.pmOwner          as string) || p.pmOwner,
            tpmOwner:        (d.tpmOwner         as string) || p.tpmOwner,
            techOwner:       (d.techOwner        as string) || p.techOwner,
            iosOwner:        (d.iosOwner         as string) || p.iosOwner,
            androidOwner:    (d.androidOwner     as string) || p.androidOwner,
            serverOwner:     (d.serverOwner      as string) || p.serverOwner,
            qaOwner:         (d.qaOwner          as string) || p.qaOwner,
            daOwner:         (d.daOwner          as string) || p.daOwner,
            uiuxOwner:       (d.uiuxOwner        as string) || p.uiuxOwner,
            contentDesigner: (d.contentDesigner  as string) || p.contentDesigner,
            iosVersion:      (d.iosVersion       as string) || p.iosVersion,
            versionHistory:  trackVersion(p.versionHistory, (d.iosVersion as string) || p.iosVersion),
            abReportUrl:     (d.abReportUrl      as string) || p.abReportUrl,
            packageQrUrl:    (d.packageQrUrl     as string) || p.packageQrUrl,
            packageDownloadUrl: (d.packageDownloadUrl as string) || p.packageDownloadUrl,
            iosPackageQrUrl: (d.iosPackageQrUrl  as string) || p.iosPackageQrUrl,
            iosPackageDownloadUrl: (d.iosPackageDownloadUrl as string) || p.iosPackageDownloadUrl,
            chatId:          (d.chatId           as string) || p.chatId,
            lastUpdated:     p.lastUpdated || (d.lastUpdated as string) || '',
          }));
        } catch { /* ignore per-card errors */ }
        setDetailSyncCount(c => c + 1);
      }));
    }
    setDetailSyncTotal(0);
    setDetailSyncCount(0);
  }, [setFeatures]);

  // ── Fetch from Meego ───────────────────────────────────────────────────────

  const fetchFromMeego = useCallback(async (): Promise<Feature[] | null> => {
    setFetchError(null);
    try {
      const res  = await fetch('/api/meego/features');
      const data = await res.json() as { features?: Feature[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      if (data.features && data.features.length > 0) {
        // Merge new list with existing features to preserve enriched fields
        // (figmaUrl, packageQrUrl, chatId, abReportUrl, etc.) that MQL doesn't return
        setFeatures(prev => {
          const existing = new Map(prev.map(f => [f.id, f]));
          return data.features!.map(f => {
            const old = existing.get(f.id);
            if (!old) return f;
            // New basic fields from MQL overwrite, but keep enriched fields from previous sync
            return { ...old, ...f,
              // Preserve enriched fields that MQL doesn't return (only overwrite if new value is non-empty)
              figmaUrl:        f.figmaUrl        || old.figmaUrl,
              abReportUrl:     f.abReportUrl     || old.abReportUrl,
              packageQrUrl:    f.packageQrUrl    || old.packageQrUrl,
              packageDownloadUrl: f.packageDownloadUrl || old.packageDownloadUrl,
              iosPackageQrUrl: f.iosPackageQrUrl || old.iosPackageQrUrl,
              iosPackageDownloadUrl: f.iosPackageDownloadUrl || old.iosPackageDownloadUrl,
              chatId:          f.chatId          || old.chatId,
              quarterlyCycle:  f.quarterlyCycle   || old.quarterlyCycle,
              businessLine:    f.businessLine     || old.businessLine,
              socialComponent: f.socialComponent  || old.socialComponent,
              pmOwner:         f.pmOwner          || old.pmOwner,
              tpmOwner:        f.tpmOwner         || old.tpmOwner,
              techOwner:       f.techOwner        || old.techOwner,
              iosOwner:        f.iosOwner         || old.iosOwner,
              androidOwner:    f.androidOwner     || old.androidOwner,
              serverOwner:     f.serverOwner      || old.serverOwner,
              qaOwner:         f.qaOwner          || old.qaOwner,
              daOwner:         f.daOwner          || old.daOwner,
              uiuxOwner:       f.uiuxOwner        || old.uiuxOwner,
              contentDesigner: f.contentDesigner   || old.contentDesigner,
              iosVersion:      f.iosVersion        || old.iosVersion,
              versionHistory:  trackVersion(old.versionHistory, f.iosVersion || old.iosVersion),
              canCompleteNode: f.canCompleteNode   ?? old.canCompleteNode,
              lastUpdated:     f.lastUpdated       || old.lastUpdated,
            };
          });
        });
        return data.features;
      }
      setFetchError('No features returned from Meego');
      return null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setFetchError(msg);
      return null;
    }
  }, [setFeatures]);

  // ── Initial load ───────────────────────────────────────────────────────────

  useEffect(() => {
    async function init() {
      let list: Feature[] | null = null;
      const stored = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
      if (stored) {
        try {
          const parsed = JSON.parse(stored) as Feature[];
          if (parsed.length > 0) { list = parsed; setFeatures(parsed); }
        } catch { /* fall through */ }
      }
      if (!list) list = await fetchFromMeego();
      setLoading(false);
      if (list) {
        syncAllDetails(list);
        if (typeof window !== 'undefined') localStorage.setItem('hamlet_last_sync', String(Date.now()));
      }
    }
    const lastSync = typeof window !== 'undefined' ? Number(localStorage.getItem('hamlet_last_sync') || '0') : 0;
    const elapsed = Date.now() - lastSync;

    if (features.length === 0) init();
    else if (elapsed >= SYNC_COOLDOWN_MS) {
      setLoading(false);
      syncAllDetails(features);
      if (typeof window !== 'undefined') localStorage.setItem('hamlet_last_sync', String(Date.now()));
    } else {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (features.length > 0) {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(features)); } catch { /* ignore */ }
    }
  }, [features]);

  // ── Periodic auto-sync every 2 hours ──────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(syncAll, 2 * 60 * 60 * 1000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Single sync ────────────────────────────────────────────────────────────

  const syncOne = useCallback(async (feature: Feature) => {
    if (!feature.meegoUrl) return;
    setSyncingId(feature.id);
    try {
      const res  = await fetch('/api/meego/sync', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meegoUrl: feature.meegoUrl, chatId: feature.chatId }),
      });
      if (!res.ok) throw new Error('Sync failed');
      const d = await res.json() as Record<string, unknown>;
      if (d.pocAvatars && typeof d.pocAvatars === 'object') {
        Object.assign(AV, d.pocAvatars);
      }
      setFeatures(prev => prev.map(p => p.id !== feature.id ? p : {
        ...p,
        status:          (d.status         as string) || p.status,
        name:            (d.name            as string) || p.name,
        owner:           (d.owner           as string) || p.owner,
        meegoNodeKey:    (d.meegoNodeKey    as string) || p.meegoNodeKey,
        prd:             (d.prd             as string) || p.prd,
        figmaUrl:        (d.figmaUrl        as string) || p.figmaUrl,
        complianceUrl:   (d.complianceUrl   as string) || p.complianceUrl,
        priority:        ((d.priority as Priority) ?? p.priority),
        canCompleteNode: d.canCompleteNode  as boolean,
        quarterlyCycle:  (d.quarterlyCycle  as string) || p.quarterlyCycle,
        businessLine:    (d.businessLine    as string) || p.businessLine,
        socialComponent: (d.socialComponent as string) || p.socialComponent,
        pmOwner:         (d.pmOwner         as string) || p.pmOwner,
        tpmOwner:        (d.tpmOwner        as string) || p.tpmOwner,
        techOwner:       (d.techOwner       as string) || p.techOwner,
        iosOwner:        (d.iosOwner        as string) || p.iosOwner,
        androidOwner:    (d.androidOwner    as string) || p.androidOwner,
        serverOwner:     (d.serverOwner     as string) || p.serverOwner,
        qaOwner:         (d.qaOwner         as string) || p.qaOwner,
        daOwner:         (d.daOwner         as string) || p.daOwner,
        uiuxOwner:       (d.uiuxOwner       as string) || p.uiuxOwner,
        contentDesigner: (d.contentDesigner as string) || p.contentDesigner,
        iosVersion:      (d.iosVersion     as string) || p.iosVersion,
        versionHistory:  trackVersion(p.versionHistory, (d.iosVersion as string) || p.iosVersion),
        abReportUrl:     (d.abReportUrl    as string) || p.abReportUrl,
        packageQrUrl:    (d.packageQrUrl  as string) || p.packageQrUrl,
        packageDownloadUrl: (d.packageDownloadUrl as string) || p.packageDownloadUrl,
        chatId:          (d.chatId        as string) || p.chatId,
        lastUpdated:     p.lastUpdated || (d.lastUpdated as string) || '',
      }));
    } catch { /* ignore */ }
    finally { setSyncingId(null); }
  }, [setFeatures]);

  async function syncAll() {
    onClearPin?.();
    setSyncingAll(true);
    const list = await fetchFromMeego();
    setSyncingAll(false);
    if (list) {
      syncAllDetails(list);
      if (typeof window !== 'undefined') localStorage.setItem('hamlet_last_sync', String(Date.now()));
    }
  }

  function handleNodeCompleted(featureId: string) {
    const f = features.find(x => x.id === featureId);
    if (f) syncOne(f);
  }

  function handleFeatureCreated(tempId: string, feature: Feature | null) {
    if (feature) {
      setFeatures(prev => prev.map(f => f.id === tempId ? feature : f));
      toast.success(`"${feature.name}" created`);
    } else {
      setFeatures(prev => prev.filter(f => f.id !== tempId));
      toast.error('Failed to create feature');
    }
  }

  // ── Filter ─────────────────────────────────────────────────────────────────

  const uniqueStatuses = useMemo(
    () => [...new Set(features.map(f => f.status).filter(Boolean))].sort(),
    [features],
  );

  const filtered = useMemo(() => {
    const result = features.filter(f => {
      // Hide features with Unknown status (deleted/completed on Meego)
      if (f.status === 'Unknown') return false;
      const q = search.toLowerCase();
      return (
        (!q || f.name.toLowerCase().includes(q) || f.description.toLowerCase().includes(q) || f.owner.toLowerCase().includes(q)) &&
        (statusFilter   === 'All' || f.status   === statusFilter) &&
        (priorityFilter === 'All' || f.priority === priorityFilter)
      );
    });
    if (priorityFilter !== 'All' && result.some(f => f.priority !== priorityFilter)) {
      console.warn('[ProjectView] Filter bug detected: filtered array contains wrong priority', {
        priorityFilter, features: result.map(f => ({ id: f.id, name: f.name, priority: f.priority }))
      });
    }
    return result;
  }, [features, search, statusFilter, priorityFilter]);

  // ── Sort ───────────────────────────────────────────────────────────────────

  const sorted = useMemo(() => {
    let list = [...filtered];
    if (sortBy !== 'none') {
      list.sort((a, b) => {
        let cmp = 0;
        if (sortBy === 'priority') {
          cmp = (PRIORITY_ORDER[a.priority] ?? 99) - (PRIORITY_ORDER[b.priority] ?? 99);
        } else if (sortBy === 'status') {
          cmp = (a.status ?? '').localeCompare(b.status ?? '');
        } else if (sortBy === 'lastUpdated') {
          cmp = new Date(a.lastUpdated).getTime() - new Date(b.lastUpdated).getTime();
        }
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }
    // Pin newly created feature to the top
    if (pinnedId) {
      const idx = list.findIndex(f => f.id === pinnedId);
      console.log('[pin] pinnedId:', pinnedId, 'idx in list:', idx, 'list length:', list.length, 'ids:', list.slice(0, 5).map(f => f.id));
      if (idx > 0) {
        const [pinned] = list.splice(idx, 1);
        list.unshift(pinned);
      } else if (idx === -1) {
        // Feature might be filtered out — find it in the full features list and prepend
        const pinned = features.find(f => f.id === pinnedId);
        console.log('[pin] fallback lookup in features:', !!pinned);
        if (pinned) list.unshift(pinned);
      }
    }
    return list;
  }, [filtered, features, sortBy, sortDir, pinnedId]);

  // ── Group ──────────────────────────────────────────────────────────────────

  type FeatureGroup = { key: string; label: string; items: Feature[] };

  const groups = useMemo((): FeatureGroup[] | null => {
    if (groupBy === 'none') return null;

    const buckets = new Map<string, Feature[]>();
    for (const f of sorted) {
      let key = '';
      if      (groupBy === 'priority')        key = f.priority        ?? '';
      else if (groupBy === 'status')          key = f.status          ?? '';
      else if (groupBy === 'businessLine')    key = f.businessLine    ?? '';
      else if (groupBy === 'socialComponent') key = f.socialComponent ?? '';
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(f);
    }

    const keys = [...buckets.keys()].sort((a, b) => {
      if (!a) return 1;   // empty/unknown always last
      if (!b) return -1;
      if (groupBy === 'priority') {
        return (PRIORITY_ORDER[a] ?? 99) - (PRIORITY_ORDER[b] ?? 99);
      }
      return a.localeCompare(b);
    });

    return keys.map(key => ({ key, label: key || '—', items: buckets.get(key)! }));
  }, [sorted, groupBy]);

  // ── Render ─────────────────────────────────────────────────────────────────

  const listGridCls = 'flex flex-col gap-2 sm:grid sm:grid-cols-[1fr_max-content_max-content_max-content_max-content_max-content_max-content_max-content_max-content_max-content] sm:gap-x-1.5 sm:gap-y-2';

  async function handleComplete(feature: Feature) {
    if (!feature.meegoProjectKey || !feature.meegoIssueId || !feature.meegoNodeKey) {
      toast.error('Missing node info — try syncing first.');
      return;
    }
    setCompletingId(feature.id);
    try {
      const res = await fetch('/api/meego/complete-node', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectKey: feature.meegoProjectKey,
          workItemId: feature.meegoIssueId,
          nodeKey:    feature.meegoNodeKey,
        }),
      });
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        throw new Error(d.error ?? 'Failed');
      }
      toast.success(`"${feature.status}" marked as complete`);
      // Background re-sync
      if (feature.meegoUrl) {
        fetch('/api/meego/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ meegoUrl: feature.meegoUrl, chatId: feature.chatId }),
        })
          .then(r => r.ok ? r.json() : null)
          .then((d: Record<string, unknown> | null) => {
            if (!d) return;
            if (d.pocAvatars && typeof d.pocAvatars === 'object') {
              Object.assign(AV, d.pocAvatars);
            }
            setFeatures(prev => prev.map(f => f.id !== feature.id ? f : {
              ...f,
              status:          (d.status as string) || f.status,
              canCompleteNode: d.canCompleteNode as boolean,
              meegoNodeKey:    (d.meegoNodeKey as string) || f.meegoNodeKey,
              priority:        ((d.priority as Priority) ?? f.priority),
              packageQrUrl:    (d.packageQrUrl as string) || f.packageQrUrl,
              packageDownloadUrl: (d.packageDownloadUrl as string) || f.packageDownloadUrl,
              chatId:          (d.chatId as string) || f.chatId,
              lastUpdated:     f.lastUpdated || (d.lastUpdated as string) || '',
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

  function renderListRows(items: Feature[]) {
    return items.map(f => (
      <FeatureListItem key={f.id} feature={f} syncing={syncingId === f.id}
        onEdit={feat => { setEditing(feat); setModalMode('edit'); }} onSync={syncOne}
        completing={completingId === f.id} onComplete={handleComplete}
        pinned={f.id === pinnedId} />
    ));
  }

  return (
    <div className="min-h-screen">

      {/* Toolbar */}
      <div className="px-6 pt-7 pb-2 flex items-center justify-between">
        <div>
          <h1 className="text-2xl text-white" style={{ fontFamily: 'var(--font-newsreader)' }}>
            Project View
          </h1>
          <p className="text-sm text-gray-500 mt-1">An overview of your projects</p>
        </div>
        <button
          onClick={syncAll}
          disabled={syncingAll || detailSyncTotal > 0}
          className="flex items-center gap-2 px-4 py-2 bg-[#1e2240] hover:bg-[#252a4a] text-gray-300 hover:text-white text-sm rounded-xl transition-colors disabled:opacity-50"
        >
          {syncingAll || detailSyncTotal > 0
            ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Syncing</>
            : <><RefreshCw className="w-3.5 h-3.5" /> Sync All</>}
        </button>
      </div>

      <FilterBar
        search={search} statusFilter={statusFilter} statuses={uniqueStatuses}
        priorityFilter={priorityFilter} view={view}
        onSearchChange={setSearch} onStatusChange={setStatusFilter}
        onPriorityChange={setPriority} onViewChange={setView}
        onAddFeature={() => {}} hideAddButton
        groupBy={groupBy}  onGroupByChange={setGroupBy}
        sortBy={sortBy}    onSortByChange={setSortBy}
        sortDir={sortDir}  onSortDirToggle={toggleSortDir}
      />

      <div className="px-6 pb-16 mt-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3 text-gray-500">
            <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
            <p className="text-sm">Loading features from Meego…</p>
          </div>
        ) : fetchError ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <p className="text-sm text-red-400">Failed to load: {fetchError}</p>
            <button onClick={() => { setLoading(true); fetchFromMeego().finally(() => setLoading(false)); }}
              className="text-xs text-blue-400 hover:text-blue-300 underline">Retry</button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-2 text-gray-500">
            <p className="text-sm">No features match your filters.</p>
            <button onClick={() => { setSearch(''); setStatusFilter('All'); setPriority('All'); }}
              className="text-xs text-blue-400 hover:text-blue-300 underline">Clear filters</button>
          </div>
        ) : view === 'grid' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {sorted.map(f => (
              <FeatureCard key={f.id} feature={f} syncing={syncingId === f.id}
                onEdit={feat => { setEditing(feat); setModalMode('edit'); }} onSync={syncOne} />
            ))}
          </div>
        ) : groups ? (
          // ── Grouped list view ──────────────────────────────────────────────
          <div className={listGridCls}>
            <FeatureListHeader />
            {/* Render pinned feature above all groups */}
            {pinnedId && (() => {
              const pinned = features.find(f => f.id === pinnedId);
              return pinned ? renderListRows([pinned]) : null;
            })()}
            {groups.map((group, gi) => (
              <React.Fragment key={group.key}>
                <GroupHeader label={group.label} count={group.items.length} first={gi === 0} groupBy={groupBy} />
                {renderListRows(group.items.filter(f => f.id !== pinnedId))}
              </React.Fragment>
            ))}
          </div>
        ) : (
          // ── Plain list view ────────────────────────────────────────────────
          <div className={listGridCls}>
            <FeatureListHeader />
            {renderListRows(sorted)}
          </div>
        )}

      </div>

      {modalMode === 'edit' && editingFeature && (
        <FeatureModal
          mode="edit"
          feature={editingFeature}
          onSave={() => { setModalMode(null); setEditing(undefined); }}
          onClose={() => { setModalMode(null); setEditing(undefined); }}
          onNodeCompleted={handleNodeCompleted}
          onFeatureCreated={handleFeatureCreated}
        />
      )}
    </div>
  );
}
