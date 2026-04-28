'use client';
import { useState, useEffect, useMemo } from 'react';
import { Feature } from '@/lib/types';
import { Sidebar, SidebarView } from '@/components/Sidebar';
import { ProjectView } from '@/components/ProjectView';
import { ChatView } from '@/components/ChatView';
import { TodoView } from '@/components/TodoView';
import { RolesView } from '@/components/RolesView';
import { PromptsView } from '@/components/PromptsView';
import { FeatureModal } from '@/components/FeatureModal';

interface PlatformPackage {
  version: string;
  qrUrl: string;
  downloadUrl: string;
  packageName?: string;
  buildTime?: string;
}
interface PackagesByMeego {
  updatedAt?: string;
  features?: Record<string, { android: PlatformPackage | null; ios: PlatformPackage | null }>;
}

const JUNIOR_PACKAGES_URL = 'https://junior-416594255546.asia-southeast1.run.app/api/packages/latest';

export default function Home() {
  const [featuresRaw,   setFeatures]      = useState<Feature[]>([]);
  const [pkgMap,        setPkgMap]        = useState<PackagesByMeego | null>(null);
  const [activeView,    setActiveView]    = useState<SidebarView>(() => {
    if (typeof window !== 'undefined') {
      const path = window.location.pathname;
      if (path === '/todos') return 'todos';
      if (path === '/chat') return 'chat';
      if (path === '/roles') return 'roles';
      if (path === '/prompts') return 'prompts';
    }
    return 'project';
  });
  const [showAddModal,  setShowAddModal]  = useState(false);
  const [pinnedId,      setPinnedId]      = useState<string | null>(null);
  const [user,          setUser]          = useState<{ name: string; avatarUrl: string } | undefined>();

  // Sync URL when view changes
  const viewToPath: Record<SidebarView, string> = { project: '/projects', todos: '/todos', chat: '/chat', roles: '/roles', prompts: '/prompts' };
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
      else if (path === '/prompts') setActiveView('prompts');
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

  // Per-Meego package map from Bits (via Junior + compliance-bot on the DevBox).
  // Falls back silently to Lark chat data if this fetch fails or a feature is missing.
  useEffect(() => {
    fetch(JUNIOR_PACKAGES_URL)
      .then(r => r.ok ? r.json() : null)
      .then((d: PackagesByMeego | null) => { if (d?.features) setPkgMap(d); })
      .catch(() => {});
  }, []);

  // Enrich features with Bits package URLs (keyed by Meego work item ID).
  // If a feature has no Bits entry, its existing packageQrUrl from the Lark
  // chat scan is kept. If neither has data, no package icon is shown.
  const features = useMemo(() => {
    const byId = pkgMap?.features;
    if (!byId) return featuresRaw;
    return featuresRaw.map(f => {
      const key = f.meegoIssueId || f.meegoUrl?.match(/\/detail\/(\d+)/)?.[1];
      if (!key) return f;
      const p = byId[key];
      if (!p) return f;
      return {
        ...f,
        packageQrUrl:          p.android?.qrUrl        || f.packageQrUrl,
        packageDownloadUrl:    p.android?.downloadUrl  || f.packageDownloadUrl,
        packageName:           p.android?.packageName  || f.packageName,
        packageBuildTime:      p.android?.buildTime    || f.packageBuildTime,
        iosPackageQrUrl:       p.ios?.qrUrl            || f.iosPackageQrUrl,
        iosPackageDownloadUrl: p.ios?.downloadUrl      || f.iosPackageDownloadUrl,
        iosPackageName:        p.ios?.packageName      || f.iosPackageName,
        iosPackageBuildTime:   p.ios?.buildTime        || f.iosPackageBuildTime,
      };
    });
  }, [featuresRaw, pkgMap]);

  // ── Add-modal callbacks ────────────────────────────────────────────────────

  /**
   * Insert the just-created feature into the list and pin it. Modal
   * stays open so the user can see the success banner with Meego /
   * PRD links — they close it manually via Cancel / X.
   */
  function handleTempAdded(feature: Feature) {
    setFeatures(prev => [feature, ...prev]);
    setPinnedId(feature.id);
    setTimeout(() => {
      document.getElementById('main-scroll')?.scrollTo({ top: 0, behavior: 'smooth' });
    }, 100);
    setTimeout(() => setPinnedId(prev => prev === feature.id ? null : prev), 30_000);
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
        {activeView === 'prompts' && (
          <PromptsView />
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
