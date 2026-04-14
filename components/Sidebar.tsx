'use client';
import Image from 'next/image';
import { LayoutList, MessageSquare, CheckSquare, Users, Plus, LogOut } from 'lucide-react';

export type SidebarView = 'project' | 'chat' | 'todos' | 'roles';

interface Props {
  activeView: SidebarView;
  onViewChange: (view: SidebarView) => void;
  onCreateFeature: () => void;
  user?: { name: string; avatarUrl: string };
}

export function Sidebar({ activeView, onViewChange, onCreateFeature, user }: Props) {
  return (
    <aside className="w-[220px] min-h-screen flex flex-col bg-[var(--background)] border-r border-[var(--border)] shrink-0 sticky top-0 h-screen">
      {/* Logo */}
      <div className="px-5 py-5 flex items-center gap-2.5 border-b border-[var(--border)]">
        <Image src="/hamlet.png" alt="Hamlet" width={26} height={26} className="rounded-full" />
        <span className="text-[var(--foreground)] font-medium text-base" style={{ fontFamily: 'var(--font-newsreader)' }}>
          Hamlet
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 flex flex-col gap-1">
        <button
          onClick={onCreateFeature}
          className="flex items-center gap-2.5 w-full px-3 py-2.5 rounded-xl bg-blue-700 hover:bg-blue-600 text-[var(--foreground)] text-sm font-medium transition-colors mb-3"
        >
          <Plus className="w-4 h-4 shrink-0" />
          Create Feature
        </button>

        <NavItem
          icon={<LayoutList className="w-4 h-4 shrink-0" />}
          label="Project View"
          active={activeView === 'project'}
          onClick={() => onViewChange('project')}
        />
        <NavItem
          icon={<MessageSquare className="w-4 h-4 shrink-0" />}
          label="Chat"
          active={activeView === 'chat'}
          onClick={() => onViewChange('chat')}
        />
        <NavItem
          icon={<CheckSquare className="w-4 h-4 shrink-0" />}
          label="To Dos"
          active={activeView === 'todos'}
          onClick={() => onViewChange('todos')}
        />
        <NavItem
          icon={<Users className="w-4 h-4 shrink-0" />}
          label="R&R"
          active={activeView === 'roles'}
          onClick={() => onViewChange('roles')}
        />
      </nav>

      {/* User + Logout */}
      <div className="px-4 py-4 border-t border-[var(--border)] flex items-center gap-3">
        <div className="shrink-0">
          {user?.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.avatarUrl}
              alt={user.name}
              width={28}
              height={28}
              className="rounded-full w-7 h-7 object-cover"
              onError={(e) => { (e.target as HTMLImageElement).src = '/hamlet.png'; }}
            />
          ) : (
            <Image src="/hamlet.png" alt="Avatar" width={28} height={28} className="rounded-full" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-[var(--foreground)] font-medium truncate">{user?.name ?? 'User'}</p>
          <a
            href="/api/auth/logout"
            className="text-[10px] text-gray-500 hover:text-gray-300 transition-colors flex items-center gap-1 mt-0.5"
          >
            <LogOut className="w-2.5 h-2.5" />
            Log out
          </a>
        </div>
      </div>
    </aside>
  );
}

function NavItem({
  icon, label, active, onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2.5 w-full px-3 py-2.5 rounded-xl text-sm transition-colors border ${
        active
          ? 'bg-[var(--card)] border-[var(--border)] text-[var(--foreground)] font-medium shadow-sm'
          : 'border-transparent text-gray-400 hover:text-[var(--foreground)] hover:bg-[var(--card-hover)]'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
