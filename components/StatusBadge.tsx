'use client';
import { Status } from '@/lib/types';

const statusStyles: Record<Status, string> = {
  Discovery:     'bg-[#1e2240] text-gray-300',
  Design:        'bg-[#1e2240] text-purple-300',
  Development:   'bg-[#1a2535] text-blue-300',
  'AB Testing':  'bg-[#1e2240] text-yellow-300',
  Launched:      'bg-[#0d2b1f] text-emerald-400 border border-emerald-900',
  'On Hold':     'bg-[#221a10] text-amber-400 border border-amber-900',
};

export function StatusBadge({ status }: { status: Status }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium whitespace-nowrap ${statusStyles[status]}`}>
      {status}
    </span>
  );
}
