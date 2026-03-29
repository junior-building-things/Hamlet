'use client';
import { useState, useMemo, useCallback, useEffect } from 'react';
import { Feature, Priority } from '@/lib/types';
import { FilterBar } from '@/components/FilterBar';
import { FeatureCard } from '@/components/FeatureCard';
import { FeatureListHeader } from '@/components/FeatureListHeader';
import { FeatureListItem } from '@/components/FeatureListItem';
import { FeatureModal } from '@/components/FeatureModal';
import { Loader2, RefreshCw } from 'lucide-react';

const STORAGE_KEY = 'hamlet_features_v1';

interface Props {
  features: Feature[];
  setFeatures: React.Dispatch<React.SetStateAction<Feature[]>>;
}

export function ProjectView({ features, setFeatures }: Props) {
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
            body: JSON.stringify({ meegoUrl: f.meegoUrl }),
          });
          if (!res.ok) return;
          const d = await res.json() as Record<string, unknown>;
          setFeatures(prev => prev.map(p => p.id !== f.id ? p : {
            ...p,
            status:          (d.status          as string) || p.status,
            name:            (d.name             as string) || p.name,
            owner:           (d.owner            as string) || p.owner,
            meegoNodeKey:    (d.meegoNodeKey     as string) || p.meegoNodeKey,
            prd:             (d.prd              as string) || p.prd,
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
            lastUpdated:     (d.lastUpdated      as string) || new Date().toISOString().split('T')[0],
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
        setFeatures(data.features);
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
      if (list) syncAllDetails(list);
    }
    if (features.length === 0) init();
    else { setLoading(false); syncAllDetails(features); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist to localStorage whenever features change
  useEffect(() => {
    if (features.length > 0) {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(features)); } catch { /* ignore */ }
    }
  }, [features]);

  // ── Single sync ────────────────────────────────────────────────────────────

  const syncOne = useCallback(async (feature: Feature) => {
    if (!feature.meegoUrl) return;
    setSyncingId(feature.id);
    try {
      const res  = await fetch('/api/meego/sync', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meegoUrl: feature.meegoUrl }),
      });
      if (!res.ok) throw new Error('Sync failed');
      const d = await res.json() as Record<string, unknown>;
      setFeatures(prev => prev.map(p => p.id !== feature.id ? p : {
        ...p,
        status:          (d.status         as string) || p.status,
        name:            (d.name            as string) || p.name,
        owner:           (d.owner           as string) || p.owner,
        meegoNodeKey:    (d.meegoNodeKey    as string) || p.meegoNodeKey,
        prd:             (d.prd             as string) || p.prd,
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
        lastUpdated:     new Date().toISOString().split('T')[0],
      }));
    } catch { /* ignore */ }
    finally { setSyncingId(null); }
  }, [setFeatures]);

  async function syncAll() {
    setSyncingAll(true);
    const list = await fetchFromMeego();
    setSyncingAll(false);
    if (list) syncAllDetails(list);
  }

  // ── Node completion callback ───────────────────────────────────────────────

  function handleNodeCompleted(featureId: string) {
    const f = features.find(x => x.id === featureId);
    if (f) syncOne(f);
  }

  function handleFeatureCreated(tempId: string, feature: Feature | null) {
    if (feature) setFeatures(prev => prev.map(f => f.id === tempId ? feature : f));
    else         setFeatures(prev => prev.filter(f => f.id !== tempId));
  }

  // ── Filters ────────────────────────────────────────────────────────────────

  const uniqueStatuses = useMemo(
    () => [...new Set(features.map(f => f.status).filter(Boolean))].sort(),
    [features],
  );

  const filtered = useMemo(() => features.filter(f => {
    const q = search.toLowerCase();
    return (
      (!q || f.name.toLowerCase().includes(q) || f.description.toLowerCase().includes(q) || f.owner.toLowerCase().includes(q)) &&
      (statusFilter   === 'All' || f.status   === statusFilter) &&
      (priorityFilter === 'All' || f.priority === priorityFilter)
    );
  }), [features, search, statusFilter, priorityFilter]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen">

      {/* Toolbar */}
      <div className="px-6 pt-7 pb-2 flex items-center justify-between">
        <div>
          <h1 className="text-2xl text-white" style={{ fontFamily: 'var(--font-newsreader)' }}>
            Project View
          </h1>
          <p className="text-sm text-gray-500 mt-1">{features.length} features</p>
        </div>
        <button
          onClick={syncAll}
          disabled={syncingAll}
          className="flex items-center gap-2 px-4 py-2 bg-[#1e2240] hover:bg-[#252a4a] text-gray-300 hover:text-white text-sm rounded-xl transition-colors disabled:opacity-50"
        >
          {syncingAll
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <RefreshCw className="w-3.5 h-3.5" />
          }
          Sync All
        </button>
      </div>

      {/* FilterBar has its own px-6 internally */}
      <FilterBar
        search={search}
        statusFilter={statusFilter}
        statuses={uniqueStatuses}
        priorityFilter={priorityFilter}
        view={view}
        onSearchChange={setSearch}
        onStatusChange={setStatusFilter}
        onPriorityChange={setPriority}
        onViewChange={setView}
        onAddFeature={() => { /* handled by sidebar */ }}
        hideAddButton
      />

      <div className="px-6 pb-16 mt-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3 text-gray-500">
            <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
            <p className="text-sm">Loading features from Meego…</p>
          </div>
        ) : fetchError ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <p className="text-sm text-red-400">Failed to load: {fetchError}</p>
            <button
              onClick={() => { setLoading(true); fetchFromMeego().finally(() => setLoading(false)); }}
              className="text-xs text-purple-400 hover:text-purple-300 underline"
            >
              Retry
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-2 text-gray-500">
            <p className="text-sm">No features match your filters.</p>
            <button
              onClick={() => { setSearch(''); setStatusFilter('All'); setPriority('All'); }}
              className="text-xs text-purple-400 hover:text-purple-300 underline"
            >
              Clear filters
            </button>
          </div>
        ) : view === 'grid' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {filtered.map(f => (
              <FeatureCard key={f.id} feature={f} syncing={syncingId === f.id}
                onEdit={feat => { setEditing(feat); setModalMode('edit'); }} onSync={syncOne} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-2 sm:grid sm:grid-cols-[2fr_auto_auto_160px_auto_1fr] sm:gap-x-4 sm:gap-y-2">
            <FeatureListHeader />
            {filtered.map(f => (
              <FeatureListItem key={f.id} feature={f} syncing={syncingId === f.id}
                onEdit={feat => { setEditing(feat); setModalMode('edit'); }} onSync={syncOne} />
            ))}
          </div>
        )}

        {detailSyncTotal > 0 && (
          <div className="flex items-center justify-center gap-2 mt-6 text-gray-500">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-500" />
            <p className="text-xs">Syncing details… {detailSyncCount}/{detailSyncTotal}</p>
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
