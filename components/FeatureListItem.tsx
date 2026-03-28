'use client';
import { Feature } from '@/lib/types';
import { StatusBadge } from './StatusBadge';
import { PriorityBadge } from './PriorityBadge';
import { RefreshCw, Calendar } from 'lucide-react';

interface Props {
  feature: Feature;
  syncing: boolean;
  onEdit: (feature: Feature) => void;
  onSync: (feature: Feature) => void;
}

export function FeatureListItem({ feature, syncing, onEdit, onSync }: Props) {
  return (
    <div className="bg-[#13162a] border border-[#1e2240] rounded-xl px-4 py-3 hover:border-[#2e3460] transition-colors">
      {/* Mobile layout */}
      <div className="sm:hidden flex flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <button
            onClick={() => onEdit(feature)}
            className="text-white text-sm font-semibold leading-tight text-left hover:text-purple-300 transition-colors"
          >
            {feature.name}
          </button>
          {feature.meegoUrl && (
            <button onClick={() => onSync(feature)} disabled={syncing} className="text-gray-500 hover:text-blue-400 disabled:opacity-40 shrink-0">
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <StatusBadge status={feature.status} />
          <PriorityBadge priority={feature.priority} />
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {feature.meegoUrl && (
            <a href={feature.meegoUrl} target="_blank" rel="noreferrer" className="text-xs text-purple-400 hover:text-purple-300 transition-colors">
              Meego ↗
            </a>
          )}
          {feature.prd && (
            <a href={feature.prd} target="_blank" rel="noreferrer" className="text-xs text-blue-400 hover:text-blue-300 transition-colors">
              PRD ↗
            </a>
          )}
          {feature.complianceUrl && (
            <a href={feature.complianceUrl} target="_blank" rel="noreferrer" className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors">
              Compliance ↗
            </a>
          )}
        </div>
      </div>

      {/* Desktop layout */}
      <div className="hidden sm:grid grid-cols-[2fr_auto_auto_auto_1fr] gap-4 items-center">
        <button
          onClick={() => onEdit(feature)}
          className="w-full min-w-0 text-white text-sm font-semibold truncate text-left hover:text-purple-300 transition-colors cursor-pointer"
        >
          {feature.name}
        </button>
        <StatusBadge status={feature.status} />
        <PriorityBadge priority={feature.priority} />
        <div className="flex items-center gap-3 whitespace-nowrap">
          {feature.meegoUrl && (
            <a href={feature.meegoUrl} target="_blank" rel="noreferrer" className="text-xs text-purple-400 hover:text-purple-300 transition-colors whitespace-nowrap">
              Meego ↗
            </a>
          )}
          {feature.prd && (
            <a href={feature.prd} target="_blank" rel="noreferrer" className="text-xs text-blue-400 hover:text-blue-300 transition-colors whitespace-nowrap">
              PRD ↗
            </a>
          )}
          {feature.complianceUrl && (
            <a href={feature.complianceUrl} target="_blank" rel="noreferrer" className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors whitespace-nowrap">
              Compliance ↗
            </a>
          )}
        </div>
        <span className="flex items-center gap-1 text-xs text-gray-400 truncate">
          <Calendar className="w-3 h-3 shrink-0" />
          {new Date(feature.lastUpdated).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </span>
      </div>
    </div>
  );
}
