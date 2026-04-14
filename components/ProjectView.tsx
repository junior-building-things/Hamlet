'use client';
import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { Feature, Priority } from '@/lib/types';
import { FilterBar, GroupBy, SortBy, SortDir } from '@/components/FilterBar';
import { FeatureCard } from '@/components/FeatureCard';
import { FeatureListHeader } from '@/components/FeatureListHeader';
import { FeatureListItem } from '@/components/FeatureListItem';
import { FeatureModal } from '@/components/FeatureModal';
import { statusStyle } from '@/components/StatusBadge';
import { Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { AV } from '@/lib/avatars';

const STORAGE_KEY             = 'hamlet_features_v1';
const STORAGE_GROUP_BY        = 'hamlet_group_by';
const STORAGE_SORT_BY         = 'hamlet_sort_by';
const STORAGE_SORT_DIR        = 'hamlet_sort_dir';
const STORAGE_STATUS_FILTER   = 'hamlet_status_filter';
const STORAGE_PRIORITY_FILTER = 'hamlet_priority_filter';
const SYNC_COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 hours

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
    default:   return 'bg-[var(--card-hover)] border border-[var(--border)] text-gray-400';
  }
}

function statusChipCls(key: string): string {
  return statusStyle(key);
}

function groupChipCls(groupBy: GroupBy, key: string): string {
  if (!key) return 'bg-[var(--card-hover)] border border-[var(--border)] text-gray-500';
  if (groupBy === 'priority') return priorityChipCls(key);
  if (groupBy === 'status')   return statusChipCls(key);
  return 'bg-[var(--card-hover)] border border-[var(--border)] text-gray-300';
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
  const [statusFilter,   setStatusFilterState]   = useState<string[]>(() => {
    if (typeof window === 'undefined') return [];
    try { return JSON.parse(localStorage.getItem(STORAGE_STATUS_FILTER) ?? '[]'); } catch { return []; }
  });
  const [priorityFilter, setPriorityState]       = useState<string[]>(() => {
    if (typeof window === 'undefined') return [];
    try { return JSON.parse(localStorage.getItem(STORAGE_PRIORITY_FILTER) ?? '[]'); } catch { return []; }
  });
  function setStatusFilter(v: string[])   { setStatusFilterState(v);  localStorage.setItem(STORAGE_STATUS_FILTER, JSON.stringify(v)); }
  function setPriority(v: string[])       { setPriorityState(v);      localStorage.setItem(STORAGE_PRIORITY_FILTER, JSON.stringify(v)); }
  const [loading,        setLoading]        = useState(features.length === 0);
  const [fetchError,     setFetchError]     = useState<string | null>(null);
  const [syncingAll,     setSyncingAll]     = useState(false);
  const [syncingIds,     setSyncingIds]      = useState<Set<string>>(new Set());
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
    // Sort: most progressed first (excluding Done), then Done last.
    // Higher index = more progressed. Done features go to the end since
    // they skip expensive lookups anyway.
    const STATUS_ORDER: Record<string, number> = {
      'PRD/Design Prep': 1, 'Line Review': 2, 'Dependency Check': 3,
      'RD Allocation': 4, 'PRD Walkthrough': 5, 'Tech Design': 6,
      'Development': 7, 'QA Testing': 8, 'Merged': 9, 'AB Testing': 10,
      'Done': 0, // last
    };
    withUrl.sort((a, b) => {
      const oa = STATUS_ORDER[a.status] ?? 5;
      const ob = STATUS_ORDER[b.status] ?? 5;
      return ob - oa; // descending — most progressed first
    });
    setDetailSyncTotal(withUrl.length);
    setDetailSyncCount(0);
    // Mark ALL features as syncing upfront so every card shows the spinner
    // immediately, even before its batch starts.
    setSyncingIds(new Set(withUrl.map(f => f.id)));
    const BATCH = 2; // Keep low to avoid Lark API rate limits during AB doc reads
    for (let i = 0; i < withUrl.length; i += BATCH) {
      const batch = withUrl.slice(i, i + BATCH);
      await Promise.all(batch.map(async (f) => {
        try {
          const res  = await fetch('/api/meego/sync', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ meegoUrl: f.meegoUrl, chatId: f.chatId }),
          });
          if (!res.ok) return;
          const d = await res.json() as Record<string, unknown>;
          // Merge avatars into both the global AV map and the feature's avatars field
          const newAvatars = (d.pocAvatars && typeof d.pocAvatars === 'object') ? d.pocAvatars as Record<string, string> : {};
          if (Object.keys(newAvatars).length > 0) Object.assign(AV, newAvatars);
          setFeatures(prev => prev.map(p => p.id !== f.id ? p : {
            ...p,
            status:          ((d.status as string) && d.status !== 'Unknown' && d.status !== 'Syncing…') ? (d.status as string) : p.status,
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
            libraUrl:        (d.libraUrl         as string) || p.libraUrl,
            packageQrUrl:    (d.packageQrUrl     as string) || p.packageQrUrl,
            packageDownloadUrl: (d.packageDownloadUrl as string) || p.packageDownloadUrl,
            iosPackageQrUrl: (d.iosPackageQrUrl  as string) || p.iosPackageQrUrl,
            iosPackageDownloadUrl: (d.iosPackageDownloadUrl as string) || p.iosPackageDownloadUrl,
            chatId:          (d.chatId           as string) || p.chatId,
            avatars:         { ...p.avatars, ...newAvatars },
            agents:          p.agents,
            lastUpdated:     p.lastUpdated || (d.lastUpdated as string) || '',
          }));
        } catch { /* ignore per-card errors */ }
        setSyncingIds(prev => { const next = new Set(prev); next.delete(f.id); return next; });
        setDetailSyncCount(c => c + 1);
      }));
    }
    setDetailSyncTotal(0);
    setDetailSyncCount(0);
  }, [setFeatures]);

  // ── Fetch from Meego ───────────────────────────────────────────────────────

  const fetchFromMeego = useCallback(async (force = false): Promise<Feature[] | null> => {
    setFetchError(null);
    try {
      const res  = await fetch(`/api/meego/features${force ? '?force=1' : ''}`);
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
              // Preserve status from previous sync if MQL returns empty/Unknown
              status:          (f.status && f.status !== 'Unknown' && f.status !== 'Syncing…') ? f.status : old.status,
              // Preserve enriched fields that MQL doesn't return (only overwrite if new value is non-empty)
              figmaUrl:        f.figmaUrl        || old.figmaUrl,
              abReportUrl:     f.abReportUrl     || old.abReportUrl,
              libraUrl:        f.libraUrl        || old.libraUrl,
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
              avatars:         old.avatars,
              agents:          old.agents,
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
      // Try loading from server-side GCS cache first (instant, no Meego call).
      let list: Feature[] | null = null;
      let cacheAge = Infinity;
      try {
        const cacheRes = await fetch('/api/features/cache');
        if (cacheRes.ok) {
          const cacheData = await cacheRes.json() as { features?: Feature[]; updatedAt?: string };
          if (cacheData.features && cacheData.features.length > 0) {
            list = cacheData.features;
            setFeatures(list);
            cacheAge = cacheData.updatedAt ? Date.now() - Date.parse(cacheData.updatedAt) : Infinity;
          }
        }
      } catch { /* fall through to live fetch */ }

      // If no cache or cache is stale, fetch live from Meego.
      if (!list) {
        list = await fetchFromMeego();
      }

      setLoading(false);

      // Sync details if we have features and cache is stale or missing.
      if (list && cacheAge >= SYNC_COOLDOWN_MS) {
        syncAllDetails(list);
      }
    }

    if (features.length === 0) init();
    else setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Periodic auto-sync every 2 hours ──────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(syncAll, 2 * 60 * 60 * 1000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Single sync ────────────────────────────────────────────────────────────

  const syncOne = useCallback(async (feature: Feature) => {
    if (!feature.meegoUrl) return;
    setSyncingIds(prev => new Set(prev).add(feature.id));
    try {
      const res  = await fetch('/api/meego/sync', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meegoUrl: feature.meegoUrl, chatId: feature.chatId }),
      });
      if (!res.ok) throw new Error('Sync failed');
      const d = await res.json() as Record<string, unknown>;
      const newAvatars2 = (d.pocAvatars && typeof d.pocAvatars === 'object') ? d.pocAvatars as Record<string, string> : {};
      if (Object.keys(newAvatars2).length > 0) Object.assign(AV, newAvatars2);
      setFeatures(prev => prev.map(p => p.id !== feature.id ? p : {
        ...p,
        status:          ((d.status as string) && d.status !== 'Unknown' && d.status !== 'Syncing…') ? (d.status as string) : p.status,
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
        libraUrl:        (d.libraUrl      as string) || p.libraUrl,
        packageQrUrl:    (d.packageQrUrl  as string) || p.packageQrUrl,
        packageDownloadUrl: (d.packageDownloadUrl as string) || p.packageDownloadUrl,
        chatId:          (d.chatId        as string) || p.chatId,
        avatars:         { ...p.avatars, ...newAvatars2 },
        agents:          p.agents,
        lastUpdated:     p.lastUpdated || (d.lastUpdated as string) || '',
      }));
    } catch { /* ignore */ }
    finally { setSyncingIds(prev => { const next = new Set(prev); next.delete(feature.id); return next; }); }
  }, [setFeatures]);

  async function syncAll() {
    onClearPin?.();
    setSyncingAll(true);
    const list = await fetchFromMeego(true); // force=true bypasses GCS cache
    setSyncingAll(false);
    if (list) {
      syncAllDetails(list);
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
    const statusSet   = new Set(statusFilter);
    const prioritySet = new Set(priorityFilter);
    return features.filter(f => {
      // Hide features with Unknown status (deleted/completed on Meego)
      if (f.status === 'Unknown') return false;
      const q = search.toLowerCase();
      return (
        (!q || f.name.toLowerCase().includes(q) || f.description.toLowerCase().includes(q) || f.owner.toLowerCase().includes(q)) &&
        (statusSet.size   === 0 || statusSet.has(f.status ?? '')) &&
        (prioritySet.size === 0 || prioritySet.has(f.priority ?? ''))
      );
    });
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

  const listGridCls = 'flex flex-col gap-2 sm:grid sm:grid-cols-[minmax(0,500px)_max-content_max-content_max-content_max-content_max-content_max-content_max-content] sm:gap-x-1.5 sm:gap-y-2';

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
            const na3 = (d.pocAvatars && typeof d.pocAvatars === 'object') ? d.pocAvatars as Record<string, string> : {};
            if (Object.keys(na3).length > 0) Object.assign(AV, na3);
            setFeatures(prev => prev.map(f => f.id !== feature.id ? f : {
              ...f,
              status:          (d.status as string) || f.status,
              canCompleteNode: d.canCompleteNode as boolean,
              meegoNodeKey:    (d.meegoNodeKey as string) || f.meegoNodeKey,
              priority:        ((d.priority as Priority) ?? f.priority),
              packageQrUrl:    (d.packageQrUrl as string) || f.packageQrUrl,
              packageDownloadUrl: (d.packageDownloadUrl as string) || f.packageDownloadUrl,
              chatId:          (d.chatId as string) || f.chatId,
              avatars:         { ...f.avatars, ...na3 },
              agents:          f.agents,
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

  function handleToggleAgent(featureId: string, agentKey: string) {
    setFeatures(prev => prev.map(f => {
      if (f.id !== featureId) return f;
      const agents = f.agents ?? [];
      const has = agents.includes(agentKey);
      return { ...f, agents: has ? agents.filter(a => a !== agentKey) : [...agents, agentKey] };
    }));
  }

  function renderListRows(items: Feature[]) {
    return items.map(f => (
      <FeatureListItem key={f.id} feature={f} syncing={syncingIds.has(f.id)}
        onEdit={feat => { setEditing(feat); setModalMode('edit'); }} onSync={syncOne}
        completing={completingId === f.id} onComplete={handleComplete}
        pinned={f.id === pinnedId} onToggleAgent={handleToggleAgent} />
    ));
  }

  return (
    <div className="min-h-screen">

      {/* Toolbar */}
      <div className="px-6 pt-7 pb-2 flex items-center justify-between">
        <div>
          <h1 className="text-2xl text-[var(--foreground)]" style={{ fontFamily: 'var(--font-newsreader)' }}>
            Project View
          </h1>
          <p className="text-sm text-gray-500 mt-1">An overview of your projects</p>
        </div>
        <button
          onClick={syncAll}
          disabled={syncingAll || detailSyncTotal > 0}
          className="flex items-center gap-2 px-4 py-2 bg-[var(--card-hover)] hover:bg-[#252a4a] text-gray-300 hover:text-[var(--foreground)] text-sm rounded-xl transition-colors disabled:opacity-50"
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
            <button onClick={() => { setSearch(''); setStatusFilter([]); setPriority([]); }}
              className="text-xs text-blue-400 hover:text-blue-300 underline">Clear filters</button>
          </div>
        ) : view === 'grid' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {sorted.map(f => (
              <FeatureCard key={f.id} feature={f} syncing={syncingIds.has(f.id)}
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
