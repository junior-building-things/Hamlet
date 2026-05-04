'use client';
import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { Feature, Priority } from '@/lib/types';
import { FilterBar, GroupBy, SortBy, SortDir } from '@/components/FilterBar';
import { useSync } from '@/components/SyncContext';
import { FeatureListHeader } from '@/components/FeatureListHeader';
import { FeatureListItem } from '@/components/FeatureListItem';
import { FeatureModal } from '@/components/FeatureModal';
import { FeatureDrawer } from '@/components/FeatureDrawer';
import { JuniorBrief } from '@/components/JuniorBrief';
import { statusStyle, STATUS_TONE, STATUS_TONE_STYLES, type StatusTone } from '@/components/StatusBadge';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { AV } from '@/lib/avatars';

// (localStorage feature cache removed — GCS cache is the source of truth)
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
    case 'P0': return 'bg-red-500/15 border border-red-500/30 text-red-700';
    case 'P1': return 'bg-orange-500/15 border border-orange-500/30 text-orange-700';
    case 'P2': return 'bg-blue-500/15 border border-blue-500/30 text-blue-700';
    case 'P3': return 'bg-gray-500/15 border border-gray-500/30 text-gray-600';
    default:   return 'bg-[var(--card-hover)] border border-[var(--border)] text-gray-400';
  }
}

function statusChipCls(key: string): string {
  return statusStyle(key);
}

// Group pill colors — for status groups, use the same STATUS_TONE map
// the StatusBadge uses so the chip color in the group header matches
// the badge in each row + the feature drawer. Priority groups use a
// short separate map.
const GROUP_TONE_BY_PRIORITY: Record<string, StatusTone> = {
  P0: 'rose', P1: 'amber', P2: 'blue', P3: 'gray',
};

function groupTone(groupBy: GroupBy, key: string): StatusTone {
  if (!key) return 'gray';
  if (groupBy === 'status')   return STATUS_TONE[key]            ?? 'gray';
  if (groupBy === 'priority') return GROUP_TONE_BY_PRIORITY[key] ?? 'gray';
  return 'gray';
}

function GroupHeader({ label, count, first, groupBy }: { label: string; count: number; first: boolean; groupBy: GroupBy }) {
  const tone = groupTone(groupBy, label === '—' ? '' : label);
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
        <span className="w-1.5 h-1.5 rounded-full dot-breathe" style={{ background: s.dot }} />
        {label || '—'}
      </span>
      <span className="font-mono text-[10.5px] text-[var(--text-dim)]">{count}</span>
      <span className="flex-1 h-px ml-1" style={{ background: 'linear-gradient(90deg, var(--hairline) 0%, transparent 90%)' }} />
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
  const { setSyncState, registerSyncAll, markSynced } = useSync();
  const [modalMode,      setModalMode]      = useState<'edit' | null>(null);
  const [editingFeature, setEditing]        = useState<Feature | undefined>();
  const [completingId,   setCompletingId]   = useState<string | null>(null);
  // Phase C: row clicks open the detail drawer instead of jumping to
  // the full edit modal. The modal is reachable via the drawer's
  // Edit button (or directly when a sync triggers an open).
  const [drawerFeature,  setDrawerFeature]  = useState<Feature | null>(null);

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
      'AB Testing': 1, 'Merged': 2, 'QA Testing': 3, 'Development': 4,
      'Tech Design': 5, 'PRD Walkthrough': 6, 'RD Allocation': 7,
      'Dependency Check': 8, 'PRD/Design Prep': 9,
      'Done': 10,
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
          const d = await res.json() as Record<string, unknown>;
          // Remove deleted features from list and GCS cache
          if (d.deleted) {
            setFeatures(prev => prev.filter(p => p.id !== f.id));
            fetch('/api/features/cache', {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ featureId: f.id }),
            }).catch(() => {});
            return;
          }
          if (!res.ok) return;
          // Merge avatars into both the global AV map and the feature's avatars field
          const newAvatars = (d.pocAvatars && typeof d.pocAvatars === 'object') ? d.pocAvatars as Record<string, string> : {};
          if (Object.keys(newAvatars).length > 0) Object.assign(AV, newAvatars);
          setFeatures(prev => prev.map(p => {
            if (p.id !== f.id) return p;
            const me = new Set(p.manualEdits ?? []);
            // pick: use synced value unless field was manually edited
            const pick = (key: string, synced: unknown, fallback: unknown) =>
              me.has(key) ? fallback : (synced || fallback);
            return {
              ...p,
              status:          ((d.status as string) && d.status !== 'Unknown' && d.status !== 'Syncing…') ? (d.status as string) : p.status,
              name:            (pick('name', d.name, p.name) as string),
              owner:           (d.owner            as string) || p.owner,
              meegoNodeKey:    (d.meegoNodeKey     as string) || p.meegoNodeKey,
              prd:             (pick('prd', d.prd, p.prd) as string),
              figmaUrl:        (pick('figmaUrl', d.figmaUrl, p.figmaUrl) as string),
              complianceUrl:   (pick('complianceUrl', d.complianceUrl, p.complianceUrl) as string),
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
              abReportUrl:     (pick('abReportUrl', d.abReportUrl, p.abReportUrl) as string),
              libraUrl:        (pick('libraUrl', d.libraUrl, p.libraUrl) as string),
              packageQrUrl:    (d.packageQrUrl     as string) || p.packageQrUrl,
              packageDownloadUrl: (d.packageDownloadUrl as string) || p.packageDownloadUrl,
              iosPackageQrUrl: (d.iosPackageQrUrl  as string) || p.iosPackageQrUrl,
              iosPackageDownloadUrl: (d.iosPackageDownloadUrl as string) || p.iosPackageDownloadUrl,
              chatId:          (d.chatId           as string) || p.chatId,
              avatars:         { ...p.avatars, ...newAvatars },
              agents:          p.agents,
              manualEdits:     p.manualEdits,
              lastUpdated:     p.lastUpdated || (d.lastUpdated as string) || '',
            };
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
            const me = new Set(old.manualEdits ?? []);
            // pick: use new value unless field was manually edited
            const pick = (key: string, synced: unknown, fallback: unknown) =>
              me.has(key) ? fallback : (synced || fallback);
            // New basic fields from MQL overwrite, but keep enriched fields from previous sync
            return { ...old, ...f,
              // Always prefer existing status — MQL/list_todo returns node-level
              // status (e.g. "UAT") which is less accurate than the overall status
              // from syncFeatureStatus (e.g. "AB Testing").
              status:          old.status || f.status,
              // Preserve enriched fields; protect manually edited ones
              figmaUrl:        (pick('figmaUrl', f.figmaUrl, old.figmaUrl) as string),
              abReportUrl:     (pick('abReportUrl', f.abReportUrl, old.abReportUrl) as string),
              libraUrl:        (pick('libraUrl', f.libraUrl, old.libraUrl) as string),
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
              manualEdits:     old.manualEdits,
              lastUpdated:     f.lastUpdated       || old.lastUpdated,
            };
          });
        });
        markSynced();
        return data.features;
      }
      setFetchError('No features returned from Meego');
      return null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setFetchError(msg);
      return null;
    }
  }, [setFeatures, markSynced]);

  // ── Initial load ───────────────────────────────────────────────────────────

  useEffect(() => {
    async function init() {
      // Load cached data from GCS — this is the single source of truth on
      // page load. The cache is kept authoritative by Sync All (which
      // replaces the full list) and the daily digest pipeline.
      // No live Meego fetch on refresh — that would be slow and cause
      // status flicker (MQL returns node-level status, not overall status).
      try {
        const cacheRes = await fetch('/api/features/cache');
        if (cacheRes.ok) {
          const cacheData = await cacheRes.json() as { features?: Feature[] };
          if (cacheData.features && cacheData.features.length > 0) {
            // Seed the global AV map from every cached feature's
            // per-feature avatars so the FeatureModal's people
            // dropdowns can render proper images for team members
            // even before any of those features get synced this
            // session. Without this, opening "New Feature" right
            // after page load shows "AL" / "KC" initials only.
            for (const f of cacheData.features) {
              if (f.avatars) Object.assign(AV, f.avatars);
            }
            setFeatures(cacheData.features);
            setLoading(false);
            markSynced();
            // Backfill avatars for people who only show up in
            // pocEmails but never had their avatar written into
            // any feature.avatars (PMs / DAs / TPMs). Sends one
            // batched request per page load so the Lark contact
            // API is hit just once.
            const missing: Record<string, string> = {};
            for (const f of cacheData.features) {
              const pocEmails = f.pocEmails ?? {};
              for (const [name, email] of Object.entries(pocEmails)) {
                if (!AV[name] && email && !missing[name]) missing[name] = email;
              }
            }
            if (Object.keys(missing).length > 0) {
              fetch('/api/avatars/resolve', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ emails: missing }),
              })
                .then(r => r.ok ? r.json() : null)
                .then((d: { avatars?: Record<string, string> } | null) => {
                  if (d?.avatars && Object.keys(d.avatars).length > 0) {
                    Object.assign(AV, d.avatars);
                    // Force a re-render so FeatureModal options
                    // pick up the new avatars on next open.
                    setFeatures(prev => [...prev]);
                  }
                })
                .catch(() => {});
            }
            return;
          }
        }
      } catch { /* fall through */ }

      // No cache available — do a live Meego fetch as fallback
      await fetchFromMeego(true);
      setLoading(false);
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
      const d = await res.json() as Record<string, unknown>;
      if (d.deleted) {
        setFeatures(prev => prev.filter(p => p.id !== feature.id));
        fetch('/api/features/cache', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ featureId: feature.id }),
        }).catch(() => {});
        toast.success(`"${feature.name}" removed (deleted in Meego)`);
        setSyncingIds(prev => { const next = new Set(prev); next.delete(feature.id); return next; });
        return;
      }
      if (!res.ok) throw new Error('Sync failed');
      const newAvatars2 = (d.pocAvatars && typeof d.pocAvatars === 'object') ? d.pocAvatars as Record<string, string> : {};
      if (Object.keys(newAvatars2).length > 0) Object.assign(AV, newAvatars2);
      setFeatures(prev => prev.map(p => {
        if (p.id !== feature.id) return p;
        const me = new Set(p.manualEdits ?? []);
        const pick = (key: string, synced: unknown, fallback: unknown) =>
          me.has(key) ? fallback : (synced || fallback);
        return {
        ...p,
        status:          ((d.status as string) && d.status !== 'Unknown' && d.status !== 'Syncing…') ? (d.status as string) : p.status,
        name:            (pick('name', d.name, p.name) as string),
        owner:           (d.owner           as string) || p.owner,
        meegoNodeKey:    (d.meegoNodeKey    as string) || p.meegoNodeKey,
        prd:             (pick('prd', d.prd, p.prd) as string),
        figmaUrl:        (pick('figmaUrl', d.figmaUrl, p.figmaUrl) as string),
        complianceUrl:   (pick('complianceUrl', d.complianceUrl, p.complianceUrl) as string),
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
        abReportUrl:     (pick('abReportUrl', d.abReportUrl, p.abReportUrl) as string),
        libraUrl:        (pick('libraUrl', d.libraUrl, p.libraUrl) as string),
        packageQrUrl:    (d.packageQrUrl  as string) || p.packageQrUrl,
        packageDownloadUrl: (d.packageDownloadUrl as string) || p.packageDownloadUrl,
        chatId:          (d.chatId        as string) || p.chatId,
        avatars:         { ...p.avatars, ...newAvatars2 },
        agents:          p.agents,
        manualEdits:     p.manualEdits,
        lastUpdated:     p.lastUpdated || (d.lastUpdated as string) || '',
      };  }));
    } catch { /* ignore */ }
    finally { setSyncingIds(prev => { const next = new Set(prev); next.delete(feature.id); return next; }); }
  }, [setFeatures]);

  const syncAll = useCallback(async () => {
    onClearPin?.();
    setSyncingAll(true);
    const list = await fetchFromMeego(true); // force=true bypasses GCS cache
    setSyncingAll(false);
    if (list) {
      syncAllDetails(list);
    }
  }, [onClearPin, fetchFromMeego, syncAllDetails]);

  // Expose syncAll + sync state to the page-level context so the
  // floating top-right Sync All button (visible on every tab) works.
  useEffect(() => {
    registerSyncAll(syncAll);
  }, [registerSyncAll, syncAll]);
  useEffect(() => {
    setSyncState({ syncingAll, detailSyncTotal });
  }, [setSyncState, syncingAll, detailSyncTotal]);

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

  const uniqueStatuses = useMemo(() => {
    const STATUS_DROPDOWN_ORDER = [
      'AB Testing', 'Merged', 'QA Testing', 'Development', 'Tech Design',
      'PRD Walkthrough', 'RD Allocation', 'Dependency Check',
      'Line Review', 'PRD/Design Prep', 'Done',
    ];
    const present = new Set(features.map(f => f.status).filter(Boolean));
    const ordered = STATUS_DROPDOWN_ORDER.filter(s => present.has(s));
    const extras = [...present].filter(s => !STATUS_DROPDOWN_ORDER.includes(s)).sort();
    return [...ordered, ...extras];
  }, [features]);

  const filtered = useMemo(() => {
    // Tri-state filter: values starting with '!' are excludes, others are includes.
    function splitFilter(list: string[]): { includes: Set<string>; excludes: Set<string> } {
      const includes = new Set<string>();
      const excludes = new Set<string>();
      for (const v of list) {
        if (v.startsWith('!')) excludes.add(v.slice(1));
        else includes.add(v);
      }
      return { includes, excludes };
    }
    function matchFilter(val: string, includes: Set<string>, excludes: Set<string>): boolean {
      if (excludes.has(val)) return false;
      if (includes.size === 0) return true;
      return includes.has(val);
    }
    const statusF   = splitFilter(statusFilter);
    const priorityF = splitFilter(priorityFilter);
    return features.filter(f => {
      // Hide features with Unknown status (deleted/completed on Meego)
      if (f.status === 'Unknown') return false;
      const q = search.toLowerCase();
      return (
        (!q || f.name.toLowerCase().includes(q) || f.description.toLowerCase().includes(q) || f.owner.toLowerCase().includes(q)) &&
        matchFilter(f.status ?? '',   statusF.includes,   statusF.excludes) &&
        matchFilter(f.priority ?? '', priorityF.includes, priorityF.excludes)
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

    const STATUS_GROUP_ORDER: Record<string, number> = {
      'AB Testing': 1, 'Merged': 2, 'QA Testing': 3, 'Development': 4,
      'Tech Design': 5, 'PRD Walkthrough': 6, 'RD Allocation': 7,
      'Dependency Check': 8, 'Line Review': 9, 'PRD/Design Prep': 10, 'Done': 11,
    };
    const keys = [...buckets.keys()].sort((a, b) => {
      if (!a) return 1;   // empty/unknown always last
      if (!b) return -1;
      if (groupBy === 'priority') {
        return (PRIORITY_ORDER[a] ?? 99) - (PRIORITY_ORDER[b] ?? 99);
      }
      if (groupBy === 'status') {
        return (STATUS_GROUP_ORDER[a] ?? 99) - (STATUS_GROUP_ORDER[b] ?? 99);
      }
      return a.localeCompare(b);
    });

    return keys.map(key => ({ key, label: key || '—', items: buckets.get(key)! }));
  }, [sorted, groupBy]);

  // ── Render ─────────────────────────────────────────────────────────────────

  // Hide the column whose value drives the current grouping — its value
  // is already on the group header, and showing it on every row is just
  // noise. Adjust the grid template + skip the cell in the header / row.
  const hideStatus   = groupBy === 'status';
  const hidePriority = groupBy === 'priority';
  // Fixed widths per column so the SAME template can be applied to both
  // the header and each row. (We were using `subgrid` for this before,
  // but with the parent's tracks set via inline style, the subgrid
  // children weren't always picking the parent's tracks up reliably,
  // and the header drifted out of alignment with the row cells.)
  // Action column hidden in the main Ongoing Features view — Sync icon
  // stays at the right. (TodoView keeps the Action column.)
  const hideAction = true;
  const gridTemplateColumns = (() => {
    // Feature is capped at 360px so the Notes column can take the
    // leftover space (1fr) — names truncate with the existing
    // hover-tooltip when they overflow, and the Notes cell gets
    // breathing room for longer free-form text.
    const cols = ['minmax(240px,360px)'];        // Feature
    if (!hideStatus)   cols.push('150px');       // Status pill
    cols.push('80px');                           // Version
    if (!hidePriority) cols.push('64px');        // Priority chip
    cols.push('184px');                          // Links (up to 7 stacked icons)
    cols.push('120px');                          // Team avatars (up to 5)
    cols.push('100px');                          // Risk dot + label
    cols.push('minmax(200px,1fr)');              // Notes — gets the leftover
    if (!hideAction) cols.push('80px');          // Action button
    cols.push('40px');                           // Sync icon
    return cols.join(' ');
  })();
  // Parent is a vertical stack — each row + header is its own grid with
  // the same gridTemplateColumns, so columns line up by virtue of the
  // identical template.
  const listGridCls = 'flex flex-col';

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

  async function handleFieldUpdate(featureId: string, updates: Partial<Feature>) {
    // Find feature before update for revert on error
    const prev = features.find(f => f.id === featureId);
    if (!prev) return;

    // Track manually edited fields so sync won't overwrite them
    // Only protect link fields from sync overwrites — name and complianceUrl
    // are Meego-authoritative and should always sync.
    const PROTECTED_FIELDS = new Set(['prd', 'figmaUrl', 'abReportUrl', 'libraUrl']);
    const editedKeys = Object.keys(updates).filter(k => PROTECTED_FIELDS.has(k));
    // Optimistic update
    setFeatures(fs => fs.map(f => {
      if (f.id !== featureId) return f;
      const existing = new Set(f.manualEdits ?? []);
      for (const k of editedKeys) existing.add(k);
      return { ...f, ...updates, manualEdits: [...existing] };
    }));

    try {
      await fetch('/api/meego/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectKey: prev.meegoProjectKey,
          workItemId: prev.meegoIssueId,
          featureId,
          fields: {
            ...updates,
            ...(updates.name && prev.prd ? { prd: prev.prd } : {}),
            manualEdits: [...new Set([...(prev.manualEdits ?? []), ...editedKeys])],
          },
        }),
      }).then(r => {
        if (!r.ok) throw new Error('Update failed');
      });
    } catch {
      // Revert on error
      setFeatures(fs => fs.map(f => f.id !== featureId ? f : prev));
      toast.error('Failed to save changes');
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
        onEdit={feat => { setEditing(feat); setModalMode('edit'); }}
        onOpenDetail={setDrawerFeature}
        onSync={syncOne}
        completing={completingId === f.id} onComplete={handleComplete}
        pinned={f.id === pinnedId} onToggleAgent={handleToggleAgent}
        onFieldUpdate={handleFieldUpdate}
        hideStatus={hideStatus}
        hidePriority={hidePriority}
        hideAction={hideAction}
        gridTemplateColumns={gridTemplateColumns} />
    ));
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">

      {/* Page header (sticky) — title + subtitle only.
          Sync/theme buttons render via the page-level <GlobalActions />
          floating in the top-right corner. */}
      <div className="shrink-0 px-5 py-4 border-b border-[var(--hairline)]">
        <div className="text-[18px] font-semibold text-[var(--text)] tracking-[-0.02em]">Ongoing Features</div>
        <div className="text-[12px] text-[var(--text-muted)] mt-0.5">An overview of your projects</div>
      </div>

      {/* Junior — at-risk summary, dismissible. */}
      <div className="shrink-0">
        <JuniorBrief mode="risk" features={features} />
      </div>

      <div className="shrink-0">
        <FilterBar
          search={search} statusFilter={statusFilter} statuses={uniqueStatuses}
          priorityFilter={priorityFilter}
          onSearchChange={setSearch} onStatusChange={setStatusFilter}
          onPriorityChange={setPriority}
          onAddFeature={() => {}} hideAddButton
          groupBy={groupBy}  onGroupByChange={setGroupBy}
          sortBy={sortBy}    onSortByChange={setSortBy}
          sortDir={sortDir}  onSortDirToggle={toggleSortDir}
        />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-16 mt-4">
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
        ) : groups ? (
          // ── Grouped list view ──────────────────────────────────────────────
          <div className={listGridCls}>
            <FeatureListHeader hideStatus={hideStatus} hidePriority={hidePriority} hideAction={hideAction} gridTemplateColumns={gridTemplateColumns} />
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
            <FeatureListHeader hideStatus={hideStatus} hidePriority={hidePriority} hideAction={hideAction} gridTemplateColumns={gridTemplateColumns} />
            {renderListRows(sorted)}
          </div>
        )}

      </div>

      {/* Detail drawer — slides in from the right of the main panel.
          Renders inside the main scroll container (which is `relative`)
          so the drawer + backdrop don't cover the sidebar. */}
      <FeatureDrawer
        feature={drawerFeature}
        onClose={() => setDrawerFeature(null)}
        onEdit={feat => {
          setEditing(feat);
          setModalMode('edit');
          setDrawerFeature(null);
        }}
      />

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
