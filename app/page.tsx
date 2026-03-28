'use client';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { Feature, Status, Priority } from '@/lib/types';
import { Header } from '@/components/Header';
import { StatsCards } from '@/components/StatsCards';
import { FilterBar } from '@/components/FilterBar';
import { FeatureCard } from '@/components/FeatureCard';
import { FeatureListHeader } from '@/components/FeatureListHeader';
import { FeatureListItem } from '@/components/FeatureListItem';
import { FeatureModal } from '@/components/FeatureModal';
import { Loader2 } from 'lucide-react';

const STORAGE_KEY = 'momentum_features_v2';

export default function Home() {
  const [features, setFeatures]           = useState<Feature[]>([]);
  const [hydrated, setHydrated]           = useState(false);
  const [loading, setLoading]             = useState(true);
  const [view, setView]                   = useState<'grid' | 'list'>('grid');
  const [search, setSearch]               = useState('');
  const [statusFilter, setStatusFilter]   = useState<Status | 'All'>('All');
  const [priorityFilter, setPriority]     = useState<Priority | 'All'>('All');
  const [modalMode, setModalMode]         = useState<'add' | 'edit' | null>(null);
  const [editingFeature, setEditing]      = useState<Feature | undefined>(undefined);
  const [syncingId, setSyncingId]         = useState<string | null>(null);
  const [syncingAll, setSyncingAll]       = useState(false);

  // Load from localStorage, then fetch from Meego if empty
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        setFeatures(JSON.parse(stored) as Feature[]);
        setHydrated(true);
        setLoading(false);
        return;
      } catch { /* fall through to Meego fetch */ }
    }
    // First visit — load from Meego
    fetchFromMeego().finally(() => {
      setHydrated(true);
      setLoading(false);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist to localStorage when features change
  useEffect(() => {
    if (hydrated) localStorage.setItem(STORAGE_KEY, JSON.stringify(features));
  }, [features, hydrated]);

  async function fetchFromMeego() {
    try {
      const res = await fetch('/api/meego/features');
      if (!res.ok) throw new Error('Failed');
      const data = await res.json() as { features: Feature[] };
      if (data.features?.length) setFeatures(data.features);
    } catch (err) {
      console.error('Meego fetch error:', err);
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
      const data = await res.json() as { status: Status; name: string; owner: string };
      setFeatures(prev => prev.map(f =>
        f.id === feature.id
          ? { ...f, status: data.status, name: data.name || f.name, owner: data.owner || f.owner, lastUpdated: new Date().toISOString().split('T')[0] }
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
    const linked = features.filter(f => f.meegoUrl);
    for (const f of linked) await syncOne(f);
    setSyncingAll(false);
  }

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
    } else {
      setFeatures(prev => prev.map(f => f.id === saved.id ? saved : f));
    }
    setModalMode(null);
    setEditing(undefined);
  }

  function openEdit(feature: Feature) {
    setEditing(feature);
    setModalMode('edit');
  }

  return (
    <main className="min-h-screen" style={{ backgroundColor: '#0c0e1a' }}>
      <div className="max-w-5xl mx-auto pb-16">
        <Header syncing={syncingAll} onSyncAll={syncAll} />
        <StatsCards features={features} />
        <FilterBar
          search={search}
          statusFilter={statusFilter}
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
            <div className="flex flex-col gap-2">
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
        </div>
      </div>

      {modalMode && (
        <FeatureModal
          mode={modalMode}
          feature={editingFeature}
          onSave={handleSave}
          onClose={() => { setModalMode(null); setEditing(undefined); }}
        />
      )}
    </main>
  );
}
