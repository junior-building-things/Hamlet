'use client';
import { Priority } from '@/lib/types';

const priorityConfig: Record<Priority, { bg: string; text: string; icon: string }> = {
  Critical: { bg: 'bg-red-900/50 border border-red-700',    text: 'text-red-400',    icon: '🔥' },
  High:     { bg: 'bg-orange-900/50 border border-orange-700', text: 'text-orange-400', icon: '↑' },
  Medium:   { bg: 'bg-blue-900/50 border border-blue-700',  text: 'text-blue-400',   icon: '●' },
  Low:      { bg: 'bg-gray-800 border border-gray-700',     text: 'text-gray-400',   icon: '↓' },
};

export function PriorityBadge({ priority }: { priority: Priority }) {
  const config = priorityConfig[priority];
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-xs font-medium whitespace-nowrap ${config.bg} ${config.text}`}>
      <span>{config.icon}</span>
      {priority}
    </span>
  );
}
