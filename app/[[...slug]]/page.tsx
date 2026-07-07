'use client';
import { useState, useEffect, useMemo } from 'react';
import { Feature } from '@/lib/types';
import { Sidebar, SidebarView } from '@/components/Sidebar';
import { ProjectView } from '@/components/ProjectView';
import { ChatView } from '@/components/ChatView';
import { TodoView } from '@/components/TodoView';
import { RolesView } from '@/components/RolesView';
import { PromptsView } from '@/components/PromptsView';
import { JuniorContextView } from '@/components/JuniorContextView';
import { CronJobsView } from '@/components/CronJobsView';
import { VibeCodingView } from '@/components/VibeCodingView';
import { SyncProvider } from '@/components/SyncContext';
import { GlobalActions } from '@/components/GlobalActions';
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
      if (path === '/vibe') return 'vibe';
      if (path === '/todos') return 'todos';
      if (path === '/chat') return 'chat';
      if (path === '/roles') return 'roles';
      if (path === '/prompts') return 'prompts';
      if (path === '/context') return 'context';
      if (path === '/crons') return 'crons';
    }
    return 'project';
  });
  const [showAddModal,  setShowAddModal]  = useState(false);
  // Set right after a "New Feature" create succeeds — ProjectView
  // watches this and pops the drawer for the matching feature, then
  // calls back to clear it. Avoids the legacy in-modal edit UI.
  const [openDrawerForId, setOpenDrawerForId] = useState<string | null>(null);
  const [user,          setUser]          = useState<{ name: string; avatarUrl: string } | undefined>();

  // Sync URL when view changes
  const viewToPath: Record<SidebarView, string> = { project: '/projects', vibe: '/vibe', todos: '/todos', chat: '/chat', roles: '/roles', prompts: '/prompts', context: '/context', crons: '/crons' };
  function handleViewChange(view: SidebarView) {
    setActiveView(view);
    window.history.pushState(null, '', viewToPath[view]);
  }

  // Handle browser back/forward
  useEffect(() => {
    function onPopState() {
      const path = window.location.pathname;
      if (path === '/vibe') setActiveView('vibe');
      else if (path === '/todos') setActiveView('todos');
      else if (path === '/chat') setActiveView('chat');
      else if (path === '/roles') setActiveView('roles');
      else if (path === '/prompts') setActiveView('prompts');
      else if (path === '/context') setActiveView('context');
      else if (path === '/crons') setActiveView('crons');
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
   * Insert the just-created feature into the list. The list's normal
   * sort places it according to its status; no pinning, no scroll.
   * Modal stays open so the user can see the success banner with
   * Meego / PRD links — they close it manually via Cancel / X.
   */
  function handleTempAdded(feature: Feature) {
    setFeatures(prev => [...prev, feature]);
    setOpenDrawerForId(feature.id);
  }

  /** Replace temp feature with the real one, or remove it on failure */
  function handleFeatureCreated(tempId: string, feature: Feature | null) {
    if (feature) {
      setFeatures(prev => prev.map(f => f.id === tempId ? feature : f));
      // If the drawer is currently keyed to the temp id, re-key it
      // to the real id so the drawer doesn't close when the temp
      // entry is replaced.
      setOpenDrawerForId(prev => prev === tempId ? feature.id : prev);
    } else {
      setFeatures(prev => prev.filter(f => f.id !== tempId));
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <SyncProvider>
      <main className="flex h-screen p-3 gap-3 relative z-10 overflow-hidden">
        <Sidebar
          activeView={activeView}
          onViewChange={handleViewChange}
          onCreateFeature={() => setShowAddModal(true)}
          user={user}
          featureCount={features.filter(f => f.status !== 'Done' && f.status !== '已完成').length}
          todoCount={features.filter(f => f.canCompleteNode === true && f.status !== 'Done' && f.status !== '已完成').length}
        />

        <div
          id="main-scroll"
          className="flex-1 overflow-y-auto h-full relative rounded-[var(--r-xl)] bg-[var(--bg-elev-1)] border border-[var(--hairline)]"
          style={{ boxShadow: 'var(--shadow-md)' }}
        >
          {/* Floating top-right actions, present on every tab. */}
          <div className="absolute top-7 right-6 z-20">
            <GlobalActions />
          </div>

          {/* ProjectView stays mounted always (hidden when inactive)
              so its sync state survives tab navigation. Other tabs
              are mount/unmount as before since they have no live
              background work.
              The wrapper has h-full so ProjectView's own h-full
              resolves against an actually-constrained parent (not
              an auto-height div) — otherwise it grows with content
              and the page-level scroll takes over. */}
          <div className={`h-full ${activeView === 'project' ? '' : 'hidden'}`}>
            <ProjectView
              features={features}
              setFeatures={setFeatures}
              openDrawerForId={openDrawerForId}
              onDrawerOpened={() => setOpenDrawerForId(null)}
            />
          </div>
          {activeView === 'vibe' && (
            <VibeCodingView user={user} />
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
          {activeView === 'context' && (
            <JuniorContextView />
          )}
          {activeView === 'crons' && (
            <CronJobsView />
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
    </SyncProvider>
  );
}
