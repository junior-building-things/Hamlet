'use client';
import { useState, useEffect } from 'react';
import { Feature } from '@/lib/types';
import { Sidebar, SidebarView } from '@/components/Sidebar';
import { ProjectView } from '@/components/ProjectView';
import { ChatView } from '@/components/ChatView';
import { TodoView } from '@/components/TodoView';
import { RolesView } from '@/components/RolesView';
import { FeatureModal } from '@/components/FeatureModal';

export default function Home() {
  const [features,      setFeatures]      = useState<Feature[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const stored = localStorage.getItem('hamlet_features_v1');
      if (stored) { const parsed = JSON.parse(stored); if (Array.isArray(parsed) && parsed.length > 0) return parsed; }
    } catch { /* fall through */ }
    return [];
  });
  const [activeView,    setActiveView]    = useState<SidebarView>(() => {
    if (typeof window !== 'undefined') {
      const path = window.location.pathname;
      if (path === '/todos') return 'todos';
      if (path === '/chat') return 'chat';
      if (path === '/roles') return 'roles';
    }
    return 'project';
  });
  const [showAddModal,  setShowAddModal]  = useState(false);
  const [pinnedId,      setPinnedId]      = useState<string | null>(null);
  const [user,          setUser]          = useState<{ name: string; avatarUrl: string } | undefined>();

  // Sync URL when view changes
  const viewToPath: Record<SidebarView, string> = { project: '/projects', todos: '/todos', chat: '/chat', roles: '/roles' };
  function handleViewChange(view: SidebarView) {
    setActiveView(view);
    window.history.pushState(null, '', viewToPath[view]);
  }

  // Handle browser back/forward
  useEffect(() => {
    function onPopState() {
      const path = window.location.pathname;
      if (path === '/todos') setActiveView('todos');
      else if (path === '/chat') setActiveView('chat');
      else if (path === '/roles') setActiveView('roles');
      else setActiveView('project');
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Set initial URL if on root
  useEffect(() => {
    if (window.location.pathname === '/') {
      window.history.replaceState(null, '', '/projects');
    }
  }, []);

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
    setPinnedId(feature.id);
    setShowAddModal(false);
    setTimeout(() => {
      document.getElementById('main-scroll')?.scrollTo({ top: 0, behavior: 'smooth' });
    }, 100);
  }

  /** Replace temp feature with the real one, or remove it on failure */
  function handleFeatureCreated(tempId: string, feature: Feature | null) {
    if (feature) {
      console.log('[pin] setting pinnedId:', feature.id, 'tempId:', tempId);
      setFeatures(prev => prev.map(f => f.id === tempId ? feature : f));
      // Pin the new feature to the top of the list for 30 seconds
      setPinnedId(feature.id);
      // Scroll to top so the pinned feature is visible
      setTimeout(() => {
        document.getElementById('main-scroll')?.scrollTo({ top: 0, behavior: 'smooth' });
      }, 100);
      setTimeout(() => setPinnedId(prev => prev === feature.id ? null : prev), 30_000);
    } else {
      setFeatures(prev => prev.filter(f => f.id !== tempId));
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <main className="flex min-h-screen">
      <Sidebar
        activeView={activeView}
        onViewChange={handleViewChange}
        onCreateFeature={() => setShowAddModal(true)}
        user={user}
      />

      <div id="main-scroll" className="flex-1 overflow-y-auto min-h-screen">
        {activeView === 'project' && (
          <ProjectView features={features} setFeatures={setFeatures} pinnedId={pinnedId} onClearPin={() => setPinnedId(null)} />
        )}
        {activeView === 'chat' && (
          <ChatView onFeatureCreated={f => setFeatures(prev => [f, ...prev])} />
        )}
        {activeView === 'todos' && (
          <TodoView features={features} setFeatures={setFeatures} />
        )}
        {activeView === 'roles' && (
          <RolesView />
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
