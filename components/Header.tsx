'use client';
import { useTheme } from 'next-themes';
import { Moon, Sun, RefreshCw, LogOut } from 'lucide-react';

interface Props {
  syncing: boolean;
  onSyncAll: () => void;
  user?: { name: string; avatarUrl: string };
}

export function Header({ syncing, onSyncAll, user }: Props) {
  const { theme, setTheme } = useTheme();

  return (
    <div className="flex items-center justify-between px-6 py-5">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl overflow-hidden bg-purple-700 flex items-center justify-center text-white shrink-0">
          {user?.avatarUrl
            ? <img src={user.avatarUrl} alt={user.name} className="w-full h-full object-cover" />
            : <img src="/hamlet.png" alt="Hamlet" className="w-full h-full object-contain p-1" />}
        </div>
        <div>
          <h1 className="text-xl font-bold text-white">{user?.name ?? 'Hamlet'}</h1>
          <a href="/api/auth/logout"
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-red-400 transition-colors w-fit">
            <LogOut className="w-3 h-3" />
            Log out
          </a>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onSyncAll}
          disabled={syncing}
          title="Sync all from Meego"
          className="flex items-center gap-2 bg-[#13162a] border border-[#1e2240] text-gray-300 text-xs px-3 py-1.5 rounded-lg hover:border-purple-700 hover:text-white transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'Syncing…' : 'Sync Meego'}
        </button>

        <button
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="w-9 h-9 rounded-lg bg-[#1e2240] flex items-center justify-center text-gray-400 hover:text-white transition-colors"
          title="Toggle theme"
        >
          {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}
