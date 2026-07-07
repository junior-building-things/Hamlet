'use client';
import {
  LayoutList, MessageSquare, CheckSquare, Users, Plus, LogOut,
  MessageSquareCode, Database, Clock, Sparkles, Wand2,
} from 'lucide-react';
import { useEffect } from 'react';
import { JuniorStatusCard } from './JuniorStatusCard';

export type SidebarView = 'project' | 'vibe' | 'chat' | 'todos' | 'roles' | 'prompts' | 'context' | 'crons';

interface Props {
  activeView: SidebarView;
  onViewChange: (view: SidebarView) => void;
  onCreateFeature: () => void;
  user?: { name: string; avatarUrl: string };
  /** Total ongoing features (excludes Done). Shown next to the
   *  "Product Features" nav item. */
  featureCount?: number;
  /** Features awaiting the user's action — shown next to "To Dos". */
  todoCount?: number;
}

interface NavEntry {
  id: SidebarView;
  icon: React.ReactNode;
  label: string;
  count?: number;
  aiTagged?: boolean;
}

export function Sidebar({ activeView, onViewChange, onCreateFeature, user, featureCount, todoCount }: Props) {
  // ⌘N / Ctrl+N → fire onCreateFeature
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        onCreateFeature();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCreateFeature]);

  const workspace: NavEntry[] = [
    { id: 'project', icon: <LayoutList className="w-3.5 h-3.5" />,    label: 'Product Features', count: featureCount },
    { id: 'vibe',    icon: <Wand2 className="w-3.5 h-3.5" />,         label: 'Vibe Projects' },
    { id: 'todos',   icon: <CheckSquare className="w-3.5 h-3.5" />,   label: 'To Dos', count: todoCount },
    { id: 'chat',    icon: <MessageSquare className="w-3.5 h-3.5" />, label: 'Chat' },
    { id: 'roles',   icon: <Users className="w-3.5 h-3.5" />,         label: 'R&R' },
  ];
  const aiSetup: NavEntry[] = [
    { id: 'crons',    icon: <Clock className="w-3.5 h-3.5" />,             label: 'Cron Jobs' },
    { id: 'prompts',  icon: <MessageSquareCode className="w-3.5 h-3.5" />, label: 'System Prompts' },
    { id: 'context',  icon: <Database className="w-3.5 h-3.5" />,          label: 'Junior Context' },
  ];

  const initials = (user?.name ?? 'U')
    .split(/\s+/)
    .map(s => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <aside className="sidebar-panel w-[232px] shrink-0 flex flex-col px-3 pt-3.5 pb-3 relative z-10 h-full">
      {/* User identity — use the Lark avatar URL when available, else
          fall back to the conic-gradient initials mark. */}
      <div className="flex items-center gap-2.5 px-1.5 pb-4 pt-1 relative">
        <div className="user-mark">
          {user?.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.avatarUrl}
              alt={user.name ?? 'User'}
              onError={e => {
                // Swap to the initials sibling on load error.
                const img = e.currentTarget as HTMLImageElement;
                img.style.display = 'none';
                const fallback = img.nextElementSibling as HTMLElement | null;
                if (fallback) fallback.style.display = 'block';
              }}
            />
          ) : null}
          <span style={{ display: user?.avatarUrl ? 'none' : 'block' }}>{initials}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold tracking-[-0.02em] text-[var(--text)] truncate">{user?.name ?? 'User'}</div>
          <div className="font-mono text-[9.5px] text-[var(--text-dim)] tracking-[0.08em] uppercase mt-0.5">Product Manager</div>
        </div>
      </div>

      {/* Create */}
      <button
        onClick={onCreateFeature}
        className="relative w-full px-3 py-2.5 rounded-[var(--r-md)] bg-[var(--text)] text-[var(--bg)] text-[12.5px] font-medium tracking-[-0.01em] flex items-center gap-2 transition-transform hover:-translate-y-px"
        style={{ boxShadow: '0 0 0 1px var(--hairline-strong), var(--shadow-sm)' }}
      >
        <Plus className="w-3 h-3 shrink-0" />
        <span>New Feature</span>
        <span className="ml-auto font-mono text-[10px] opacity-50 px-1.5 py-px rounded bg-black/15 dark:bg-white/20">⌘N</span>
      </button>

      <NavSection label="Workspace" items={workspace} activeView={activeView} onViewChange={onViewChange} />
      <NavSection label="AI Setup"  items={aiSetup}    activeView={activeView} onViewChange={onViewChange} />

      {/* Junior status — sits directly below the AI Setup nav.
          Animated snake border while a cron is in flight, idle
          "Monitoring..." otherwise. */}
      <div className="mt-4">
        <JuniorStatusCard />
      </div>

      <div className="flex-1" />

      {/* Footer: version pill + logout */}
      <div className="pt-3 border-t border-[var(--hairline)] flex items-center justify-between px-1">
        <span className="version-pill">
          <span className="lowercase">v</span>0.42
        </span>
        <a
          href="/api/auth/logout"
          className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-[var(--text-dim)] hover:text-[var(--text)] transition-colors flex items-center gap-1.5"
        >
          <LogOut className="w-2.5 h-2.5" />
          Log out
        </a>
      </div>
    </aside>
  );
}

function NavSection({
  label, items, activeView, onViewChange,
}: {
  label: string;
  items: NavEntry[];
  activeView: SidebarView;
  onViewChange: (v: SidebarView) => void;
}) {
  return (
    <div className="mt-4 flex flex-col gap-px relative">
      <div className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-[var(--text-dim)] px-2 pb-2">{label}</div>
      {items.map(item => {
        const active = activeView === item.id;
        return (
          <button
            key={item.id}
            onClick={() => onViewChange(item.id)}
            className={`relative flex items-center gap-2.5 w-full px-2 py-1.5 rounded-[var(--r-sm)] text-[12.5px] transition-colors ${
              active
                ? 'text-[var(--text)] bg-[var(--hairline)] nav-active-bar'
                : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--hairline)]'
            } ${item.aiTagged ? 'ai-dot pr-5' : ''}`}
          >
            <span className="grid place-items-center w-3.5 h-3.5 shrink-0">{item.icon}</span>
            <span className="text-left">{item.label}</span>
            {item.count != null && (
              <span className="ml-auto font-mono text-[10px] text-[var(--text-dim)]">{item.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// Re-export so any consumer that imported Sparkles via this file keeps working.
export { Sparkles };
