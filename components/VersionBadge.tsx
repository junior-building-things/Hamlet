'use client';

const VERSION_COLORS = [
  { bg: 'bg-cyan-900/50 border border-cyan-700',     text: 'text-cyan-400'    },
  { bg: 'bg-violet-900/50 border border-violet-700',  text: 'text-violet-400'  },
  { bg: 'bg-amber-900/50 border border-amber-700',    text: 'text-amber-400'   },
  { bg: 'bg-emerald-900/50 border border-emerald-700', text: 'text-emerald-400' },
  { bg: 'bg-rose-900/50 border border-rose-700',      text: 'text-rose-400'    },
  { bg: 'bg-blue-900/50 border border-blue-700',      text: 'text-blue-400'    },
  { bg: 'bg-orange-900/50 border border-orange-700',  text: 'text-orange-400'  },
  { bg: 'bg-teal-900/50 border border-teal-700',      text: 'text-teal-400'    },
];

function versionColor(version: string) {
  let hash = 0;
  for (let i = 0; i < version.length; i++) {
    hash = ((hash << 5) - hash + version.charCodeAt(i)) | 0;
  }
  return VERSION_COLORS[Math.abs(hash) % VERSION_COLORS.length];
}

export function VersionBadge({ version }: { version?: string }) {
  if (!version) return null;
  const config = versionColor(version);
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium whitespace-nowrap ${config.bg} ${config.text}`}>
      {version}
    </span>
  );
}
