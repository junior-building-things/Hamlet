'use client';
import { Priority } from '@/lib/types';

const priorityConfig: Record<Priority, { bg: string; text: string }> = {
  P0: { bg: 'bg-red-500/15 border border-red-500/30',      text: 'text-red-700'    },
  P1: { bg: 'bg-orange-500/15 border border-orange-500/30', text: 'text-orange-700' },
  P2: { bg: 'bg-blue-500/15 border border-blue-500/30',     text: 'text-blue-700'   },
  P3: { bg: 'bg-gray-500/15 border border-gray-500/30',     text: 'text-gray-600'   },
};

export function PriorityBadge({ priority }: { priority: Priority }) {
  const config = priorityConfig[priority] ?? { bg: 'bg-gray-500/15 border border-gray-500/30', text: 'text-gray-600' };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium whitespace-nowrap ${config.bg} ${config.text}`}>
      {priority}
    </span>
  );
}
