'use client';
import { Feature } from '@/lib/types';
import { StatusBadge } from './StatusBadge';
import { PriorityBadge } from './PriorityBadge';
import { TeamAvatars } from './TeamAvatars';
import { RefreshCw, Calendar, ExternalLink } from 'lucide-react';

interface Props {
  feature: Feature;
  syncing: boolean;
  onEdit: (feature: Feature) => void;
  onSync: (feature: Feature) => void;
}

export function FeatureListItem({ feature, syncing, onEdit, onSync }: Props) {
  return (
    <div className="bg-[#13162a] border border-[#1e2240] rounded-xl hover:border-[#2e3460] transition-colors
                    sm:col-span-full sm:grid sm:[grid-template-columns:subgrid] sm:items-center">

      {/* Mobile layout */}
      <div className="sm:hidden px-4 py-3 flex flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <button
            onClick={() => onEdit(feature)}
            className="text-white text-sm font-semibold leading-tight text-left hover:text-purple-300 transition-colors cursor-pointer"
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
            <a href={feature.meegoUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-purple-400 hover:text-purple-300 transition-colors">
              Meego <ExternalLink className="w-3 h-3" />
            </a>
          )}
          {feature.prd && (
            <a href={feature.prd} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors">
              PRD <ExternalLink className="w-3 h-3" />
            </a>
          )}
          {feature.complianceUrl && (
            <a href={feature.complianceUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300 transition-colors">
              Compliance <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      </div>

      {/* Desktop cells — direct subgrid children */}
      <button
        onClick={() => onEdit(feature)}
        className="hidden sm:block pl-4 py-3 w-full min-w-0 truncate text-left text-white text-sm font-semibold hover:text-purple-300 transition-colors cursor-pointer"
      >
        {feature.name}
      </button>

      <div className="hidden sm:flex py-3">
        <StatusBadge status={feature.status} />
      </div>

      <div className="hidden sm:flex py-3">
        <PriorityBadge priority={feature.priority} />
      </div>

      <div className="hidden sm:flex items-center gap-3 py-3 whitespace-nowrap">
        {feature.meegoUrl && (
          <a href={feature.meegoUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-purple-400 hover:text-purple-300 transition-colors">
            Meego <ExternalLink className="w-3 h-3" />
          </a>
        )}
        {feature.prd && (
          <a href={feature.prd} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors">
            PRD <ExternalLink className="w-3 h-3" />
          </a>
        )}
        {feature.complianceUrl && (
          <a href={feature.complianceUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300 transition-colors">
            Compliance <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>

      {/* Team avatars */}
      <div className="hidden sm:flex items-center py-3">
        <TeamAvatars feature={feature} ringColor="#13162a" />
      </div>

      <span className="hidden sm:flex items-center gap-1 pr-4 py-3 text-xs text-gray-400 truncate">
        <Calendar className="w-3 h-3 shrink-0" />
        {new Date(feature.lastUpdated).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
      </span>
    </div>
  );
}
