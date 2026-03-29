'use client';
import { useState, useEffect } from 'react';
import { Feature } from '@/lib/types';
import { Sidebar, SidebarView } from '@/components/Sidebar';
import { ProjectView } from '@/components/ProjectView';
import { ChatView } from '@/components/ChatView';
import { TodoView } from '@/components/TodoView';
import { FeatureModal } from '@/components/FeatureModal';

export default function Home() {
  const [features,      setFeatures]      = useState<Feature[]>([]);
  const [activeView,    setActiveView]    = useState<SidebarView>('project');
  const [showAddModal,  setShowAddModal]  = useState(false);
  const [user,          setUser]          = useState<{ name: string; avatarUrl: string } | undefined>();

  // Fetch current user for sidebar avatar + name
  useEffect(() => {
    fetch('/api/auth/me')
      .then(r => r.json())
      .then((d: { name?: string; avatarUrl?: string }) => {
        if (d.name) setUser({ name: d.name, avatarUrl: d.avatarUrl ?? '' });
      })
      .catch(() => {});
  }, []);

  // ── Add-modal callbacks ────────────────────────────────────────────────────

  /** Immediately add the temp feature (status: 'Creating…') and close the modal */
  function handleTempAdded(feature: Feature) {
    setFeatures(prev => [feature, ...prev]);
    setShowAddModal(false);
  }

  /** Replace temp feature with the real one, or remove it on failure */
  function handleFeatureCreated(tempId: string, feature: Feature | null) {
    if (feature) {
      setFeatures(prev => prev.map(f => f.id === tempId ? feature : f));
    } else {
      setFeatures(prev => prev.filter(f => f.id !== tempId));
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <main className="flex min-h-screen">
      <Sidebar
        activeView={activeView}
        onViewChange={setActiveView}
        onCreateFeature={() => setShowAddModal(true)}
        user={user}
      />

      <div className="flex-1 overflow-y-auto min-h-screen">
        {activeView === 'project' && (
          <ProjectView features={features} setFeatures={setFeatures} />
        )}
        {activeView === 'chat' && (
          <ChatView onFeatureCreated={f => setFeatures(prev => [f, ...prev])} />
        )}
        {activeView === 'todos' && (
          <TodoView features={features} setFeatures={setFeatures} />
        )}
      </div>

      {showAddModal && (
        <FeatureModal
          mode="add"
          onSave={handleTempAdded}
          onClose={() => setShowAddModal(false)}
          onFeatureCreated={handleFeatureCreated}
        />
      )}
    </main>
  );
}
