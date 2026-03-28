'use client';
import { Priority } from '@/lib/types';

const priorityConfig: Record<Priority, { bg: string; text: string }> = {
  P0: { bg: 'bg-red-900/50 border border-red-700',      text: 'text-red-400'    },
  P1: { bg: 'bg-orange-900/50 border border-orange-700', text: 'text-orange-400' },
  P2: { bg: 'bg-blue-900/50 border border-blue-700',    text: 'text-blue-400'   },
  P3: { bg: 'bg-gray-800 border border-gray-700',       text: 'text-gray-400'   },
};

export function PriorityBadge({ priority }: { priority: Priority }) {
  const config = priorityConfig[priority] ?? { bg: 'bg-gray-800 border border-gray-700', text: 'text-gray-400' };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium whitespace-nowrap ${config.bg} ${config.text}`}>
      {priority}
    </span>
  );
}
