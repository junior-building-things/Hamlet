'use client';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { Feature, Priority } from '@/lib/types';
import { Header } from '@/components/Header';
import { StatsCards } from '@/components/StatsCards';
import { FilterBar } from '@/components/FilterBar';
import { FeatureCard } from '@/components/FeatureCard';
import { FeatureListHeader } from '@/components/FeatureListHeader';
import { FeatureListItem } from '@/components/FeatureListItem';
import { FeatureModal } from '@/components/FeatureModal';
import { Loader2 } from 'lucide-react';

const STORAGE_KEY = 'hamlet_features_v1';

function greeting(): string {
  const h = new Date().getHours();
  if (h >= 5  && h < 12) return 'Good morning';
  if (h >= 12 && h < 17) return 'Good afternoon';
  return 'Good evening';
}

function Greeting({ name }: { name: string }) {
  return (
    <div className="px-6 pt-6 pb-2">
      <p className="text-2xl font-semibold text-white">
        {greeting()}, {name}!
      </p>
    </div>
  );
}

export default function Home() {
  const [features, setFeatures]           = useState<Feature[]>([]);
  const [hydrated, setHydrated]           = useState(false);
  const [loading, setLoading]             = useState(true);
  const [view, setView]                   = useState<'grid' | 'list'>('list');
  const [search, setSearch]               = useState('');
  const [statusFilter, setStatusFilter]   = useState<string>('All');
  const [priorityFilter, setPriority]     = useState<Priority | 'All'>('All');
  const [modalMode, setModalMode]         = useState<'add' | 'edit' | null>(null);
  const [editingFeature, setEditing]      = useState<Feature | undefined>(undefined);
  const [syncingId, setSyncingId]         = useState<string | null>(null);
  const [syncingAll, setSyncingAll]       = useState(false);
  const [detailSyncCount, setDetailSyncCount] = useState(0);
  const [detailSyncTotal, setDetailSyncTotal] = useState(0);
  const [userName, setUserName]           = useState<string>('');

  // Background-sync full details (status, PRD, compliance, priority) for all features
  // in parallel batches of 5 so the UI populates immediately after load.
  const syncAllDetails = useCallback(async (featureList: Feature[]) => {
    const withUrl = featureList.filter(f => f.meegoUrl);
    if (withUrl.length === 0) return;
    setDetailSyncTotal(withUrl.length);
    setDetailSyncCount(0);

    const BATCH = 5;
    for (let i = 0; i < withUrl.length; i += BATCH) {
      const batch = withUrl.slice(i, i + BATCH);
      await Promise.all(batch.map(async (feature) => {
        try {
          const res = await fetch('/api/meego/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ meegoUrl: feature.meegoUrl }),
          });
          if (!res.ok) return;
          const data = await res.json() as {
            status: string; name: string; owner: string;
            meegoNodeKey: string; prd: string; complianceUrl: string;
            priority: string | null; canCompleteNode: boolean;
            quarterlyCycle: string; businessLine: string; socialComponent: string;
            lastUpdated: string; pmOwner: string; tpmOwner: string; techOwner: string; iosOwner: string; androidOwner: string;
            serverOwner: string; qaOwner: string; daOwner: string;
            uiuxOwner: string; contentDesigner: string;
          };
          setFeatures(prev => prev.map(f =>
            f.id === feature.id
              ? {
                  ...f,
                  status:          data.status          || f.status,
                  name:            data.name             || f.name,
                  owner:           data.owner            || f.owner,
                  meegoNodeKey:    data.meegoNodeKey     || f.meegoNodeKey,
                  prd:             data.prd              || f.prd,
                  complianceUrl:   data.complianceUrl    || f.complianceUrl,
                  priority:        (data.priority as Priority) ?? f.priority,
                  canCompleteNode: data.canCompleteNode,
                  quarterlyCycle:  data.quarterlyCycle   || f.quarterlyCycle,
                  businessLine:    data.businessLine     || f.businessLine,
                  socialComponent: data.socialComponent  || f.socialComponent,
                  pmOwner:         data.pmOwner          || f.pmOwner,
                  tpmOwner:        data.tpmOwner         || f.tpmOwner,
                  techOwner:       data.techOwner        || f.techOwner,
                  iosOwner:        data.iosOwner         || f.iosOwner,
                  androidOwner:    data.androidOwner     || f.androidOwner,
                  serverOwner:     data.serverOwner      || f.serverOwner,
                  qaOwner:         data.qaOwner          || f.qaOwner,
                  daOwner:         data.daOwner          || f.daOwner,
                  uiuxOwner:       data.uiuxOwner        || f.uiuxOwner,
                  contentDesigner: data.contentDesigner  || f.contentDesigner,
                  lastUpdated:     data.lastUpdated || new Date().toISOString().split('T')[0],
                }
              : f
          ));
        } catch { /* silently ignore per-card errors */ }
        setDetailSyncCount(c => c + 1);
      }));
    }

    setDetailSyncTotal(0);
    setDetailSyncCount(0);
  }, []);

  // Fetch feature list, show it immediately, then sync details in the background.
  useEffect(() => {
    async function init() {
      let featureList: Feature[] | null = null;

      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        try {
          const parsed = JSON.parse(stored) as Feature[];
          if (parsed.length > 0) {
            featureList = parsed;
            setFeatures(parsed);
          }
        } catch { /* fall through */ }
      }

      if (!featureList) {
        featureList = await fetchFromMeego();
      }

      setHydrated(true);
      setLoading(false);

      if (featureList) {
        syncAllDetails(featureList);
      }
    }
    init();
    // Fetch current user name for greeting
    fetch('/api/auth/me')
      .then(r => r.json())
      .then((d: { name?: string }) => { if (d.name) setUserName(d.name.split(' ')[0]); })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Only persist to localStorage when we actually have features
  useEffect(() => {
    if (hydrated && features.length > 0) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(features));
    }
  }, [features, hydrated]);

  const [fetchError, setFetchError] = useState<string | null>(null);

  async function fetchFromMeego(): Promise<Feature[] | null> {
    setFetchError(null);
    try {
      const res = await fetch('/api/meego/features');
      const data = await res.json() as { features?: Feature[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      if (data.features && data.features.length > 0) {
        setFeatures(data.features);
        return data.features;
      } else {
        setFetchError('No features returned from Meego');
        return null;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.error('Meego fetch error:', msg);
      setFetchError(msg);
      return null;
    }
  }

  const syncOne = useCallback(async (feature: Feature) => {
    if (!feature.meegoUrl) return;
    setSyncingId(feature.id);
    try {
      const res = await fetch('/api/meego/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meegoUrl: feature.meegoUrl }),
      });
      if (!res.ok) throw new Error('Sync failed');
      const data = await res.json() as {
        status: string; name: string; owner: string;
        meegoNodeKey: string; prd: string; complianceUrl: string;
        priority: string | null; canCompleteNode: boolean;
        quarterlyCycle: string; businessLine: string; socialComponent: string;
        lastUpdated: string; pmOwner: string; tpmOwner: string; techOwner: string; iosOwner: string; androidOwner: string;
        serverOwner: string; qaOwner: string; daOwner: string;
        uiuxOwner: string; contentDesigner: string;
      };
      setFeatures(prev => prev.map(f =>
        f.id === feature.id
          ? {
              ...f,
              status:          data.status          || f.status,
              name:            data.name             || f.name,
              owner:           data.owner            || f.owner,
              meegoNodeKey:    data.meegoNodeKey     || f.meegoNodeKey,
              prd:             data.prd              || f.prd,
              complianceUrl:   data.complianceUrl    || f.complianceUrl,
              priority:        (data.priority as Priority) ?? f.priority,
              canCompleteNode: data.canCompleteNode,
              quarterlyCycle:  data.quarterlyCycle   || f.quarterlyCycle,
              businessLine:    data.businessLine     || f.businessLine,
              socialComponent: data.socialComponent  || f.socialComponent,
              pmOwner:         data.pmOwner          || f.pmOwner,
                  tpmOwner:        data.tpmOwner         || f.tpmOwner,
                  techOwner:       data.techOwner        || f.techOwner,
              iosOwner:        data.iosOwner         || f.iosOwner,
              androidOwner:    data.androidOwner     || f.androidOwner,
              serverOwner:     data.serverOwner      || f.serverOwner,
              qaOwner:         data.qaOwner          || f.qaOwner,
              daOwner:         data.daOwner          || f.daOwner,
              uiuxOwner:       data.uiuxOwner        || f.uiuxOwner,
              contentDesigner: data.contentDesigner  || f.contentDesigner,
              lastUpdated:     new Date().toISOString().split('T')[0],
            }
          : f
      ));
    } catch (err) {
      console.error('Sync error:', err);
    } finally {
      setSyncingId(null);
    }
  }, []);

  async function syncAll() {
    setSyncingAll(true);
    const featureList = await fetchFromMeego();
    setSyncingAll(false);
    if (featureList) syncAllDetails(featureList);
  }

  const uniqueStatuses = useMemo(() =>
    [...new Set(features.map(f => f.status).filter(Boolean))].sort(),
  [features]);

  const filtered = useMemo(() => features.filter(f => {
    const q = search.toLowerCase();
    const matchSearch = !q || f.name.toLowerCase().includes(q) || f.description.toLowerCase().includes(q) || f.owner.toLowerCase().includes(q);
    const matchStatus = statusFilter === 'All' || f.status === statusFilter;
    const matchPriority = priorityFilter === 'All' || f.priority === priorityFilter;
    return matchSearch && matchStatus && matchPriority;
  }), [features, search, statusFilter, priorityFilter]);

  function handleSave(saved: Feature) {
    if (modalMode === 'add') {
      setFeatures(prev => [saved, ...prev]);
    }
    setModalMode(null);
    setEditing(undefined);
  }

  function handleFeatureCreated(tempId: string, feature: Feature | null) {
    if (feature) {
      setFeatures(prev => prev.map(f => f.id === tempId ? feature : f));
    } else {
      setFeatures(prev => prev.filter(f => f.id !== tempId));
    }
  }

  function handleNodeCompleted(featureId: string) {
    const f = features.find(feat => feat.id === featureId);
    if (f) syncOne(f);
  }

  function openEdit(feature: Feature) {
    setEditing(feature);
    setModalMode('edit');
  }

  return (
    <main className="min-h-screen" style={{ backgroundColor: '#0c0e1a' }}>
      <div className="max-w-5xl mx-auto pb-16">
        <Header syncing={syncingAll} onSyncAll={syncAll} />
        {userName && <Greeting name={userName} />}
        <StatsCards features={features} />
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
          onAddFeature={() => setModalMode('add')}
        />

        <div className="px-6 mt-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-24 gap-3 text-gray-500">
              <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
              <p className="text-sm">Loading features from Meego…</p>
            </div>
          ) : fetchError ? (
            <div className="flex flex-col items-center justify-center py-24 gap-3 text-gray-500">
              <p className="text-sm text-red-400">Failed to load from Meego: {fetchError}</p>
              <button onClick={() => { setLoading(true); fetchFromMeego().finally(() => setLoading(false)); }}
                className="text-xs text-purple-400 hover:text-purple-300 underline">
                Retry
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 gap-2 text-gray-500">
              <p className="text-sm">No features match your filters.</p>
              <button onClick={() => { setSearch(''); setStatusFilter('All'); setPriority('All'); }}
                className="text-xs text-purple-400 hover:text-purple-300 underline">
                Clear filters
              </button>
            </div>
          ) : view === 'grid' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {filtered.map(f => (
                <FeatureCard
                  key={f.id}
                  feature={f}
                  syncing={syncingId === f.id}
                  onEdit={openEdit}
                  onSync={syncOne}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-2 sm:grid sm:grid-cols-[2fr_auto_auto_220px_1fr] sm:gap-x-4 sm:gap-y-2">
              <FeatureListHeader />
              {filtered.map(f => (
                <FeatureListItem
                  key={f.id}
                  feature={f}
                  syncing={syncingId === f.id}
                  onEdit={openEdit}
                  onSync={syncOne}
                />
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
      </div>

      {modalMode && (
        <FeatureModal
          mode={modalMode}
          feature={editingFeature}
          onSave={handleSave}
          onClose={() => { setModalMode(null); setEditing(undefined); }}
          onNodeCompleted={handleNodeCompleted}
          onFeatureCreated={handleFeatureCreated}
        />
      )}
    </main>
  );
}
