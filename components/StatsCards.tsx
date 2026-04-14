'use client';
import { Feature } from '@/lib/types';
import { Package, Clock, CheckCircle, Flame } from 'lucide-react';

export function StatsCards({ features }: { features: Feature[] }) {
  const total      = features.length;
  const inProgress = features.filter(f => {
    const s = f.status.toLowerCase();
    return s.includes('开发') || s.includes('dev') || s.includes('设计') || s.includes('design') ||
           s.includes('ab') || s.includes('测试') || s.includes('testing');
  }).length;
  const launched   = features.filter(f => {
    const s = f.status.toLowerCase();
    return s.includes('上线') || s.includes('launch') || s.includes('已完成') || s.includes('验收') ||
           s.includes('灰度') || s.includes('已发布');
  }).length;
  const critical   = features.filter(f => f.priority === 'P0').length;

  const cards = [
    { label: 'Total Features',   value: total,      Icon: Package,     iconBg: 'bg-blue-900/50',    iconColor: 'text-blue-400'    },
    { label: 'In Progress',      value: inProgress,  Icon: Clock,       iconBg: 'bg-orange-900/50',  iconColor: 'text-orange-400'  },
    { label: 'Launched',         value: launched,    Icon: CheckCircle, iconBg: 'bg-emerald-900/50 border border-emerald-700', iconColor: 'text-emerald-400' },
    { label: 'Critical Priority',value: critical,    Icon: Flame,       iconBg: 'bg-red-900/50',     iconColor: 'text-red-400'     },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 px-6 mt-1">
      {cards.map(({ label, value, Icon, iconBg, iconColor }) => (
        <div key={label} className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5 flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-400">{label}</p>
            <p className="text-4xl font-bold text-[var(--foreground)] mt-1">{value}</p>
          </div>
          <div className={`w-10 h-10 rounded-full ${iconBg} flex items-center justify-center ${iconColor}`}>
            <Icon className="w-5 h-5" />
          </div>
        </div>
      ))}
    </div>
  );
}
