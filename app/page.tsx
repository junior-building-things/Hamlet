'use client';
import { useState, useEffect, useMemo } from 'react';
import { Feature } from '@/lib/types';
import { Sidebar, SidebarView } from '@/components/Sidebar';
import { ProjectView } from '@/components/ProjectView';
import { ChatView } from '@/components/ChatView';
import { TodoView } from '@/components/TodoView';
import { RolesView } from '@/components/RolesView';
import { FeatureModal } from '@/components/FeatureModal';

interface GlobalPackages {
  updatedAt?: string;
  version?: string;
  android?: { qrUrl?: string; downloadUrl?: string; version?: string } | null;
  ios?:     { qrUrl?: string; downloadUrl?: string; version?: string } | null;
}

const JUNIOR_PACKAGES_URL = 'https://junior-416594255546.asia-southeast1.run.app/api/packages/latest';

// Features only get the global-latest package fallback once they're past Tech
// Design (i.e., there's code to build). Pre-dev features have no Bits task
// and shouldn't surface a misleading "latest TikTok build" as their package.
const HAS_CODE_STATUSES = new Set([
  'Development', 'QA Testing', 'Merged', 'AB Testing', 'Done',
]);

export default function Home() {
  const [featuresRaw,   setFeatures]      = useState<Feature[]>([]);
  const [globalPkg,     setGlobalPkg]     = useState<GlobalPackages | null>(null);
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

  // Fetch global latest packages (TikTok Android/iOS) from Junior's GCS-backed endpoint.
  // These serve as a fallback when a feature doesn't have its own package URL from Lark chat.
  useEffect(() => {
    fetch(JUNIOR_PACKAGES_URL)
      .then(r => r.ok ? r.json() : null)
      .then((d: GlobalPackages | null) => { if (d && (d.android || d.ios)) setGlobalPkg(d); })
      .catch(() => {});
  }, []);

  // Enrich features with global package URLs (GCS/Bits data takes precedence
  // over Lark chat scraping), but only for features that are actually in a
  // build-producing state. Pre-dev features stay as-is.
  const features = useMemo(() => {
    if (!globalPkg) return featuresRaw;
    const androidQr   = globalPkg.android?.qrUrl       || '';
    const androidDl   = globalPkg.android?.downloadUrl || '';
    const iosQr       = globalPkg.ios?.qrUrl           || '';
    const iosDl       = globalPkg.ios?.downloadUrl     || '';
    return featuresRaw.map(f => {
      if (!HAS_CODE_STATUSES.has(f.status)) return f;
      return {
        ...f,
        packageQrUrl:          androidQr || f.packageQrUrl,
        packageDownloadUrl:    androidDl || f.packageDownloadUrl,
        iosPackageQrUrl:       iosQr     || f.iosPackageQrUrl,
        iosPackageDownloadUrl: iosDl     || f.iosPackageDownloadUrl,
      };
    });
  }, [featuresRaw, globalPkg]);

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
