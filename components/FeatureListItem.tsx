'use client';
import { Feature } from '@/lib/types';
import { StatusBadge } from './StatusBadge';
import { PriorityBadge } from './PriorityBadge';
import { Pencil, ExternalLink, RefreshCw, User, Calendar } from 'lucide-react';

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
          <span className="text-white text-sm font-semibold leading-tight">{feature.name}</span>
          <div className="flex items-center gap-1.5 shrink-0">
            {feature.meegoUrl && (
              <>
                <a href={feature.meegoUrl} target="_blank" rel="noreferrer" className="text-gray-500 hover:text-purple-400 transition-colors">
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
                <button onClick={() => onSync(feature)} disabled={syncing} className="text-gray-500 hover:text-blue-400 disabled:opacity-40">
                  <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
                </button>
              </>
            )}
            <button onClick={() => onEdit(feature)} className="text-gray-500 hover:text-white">
              <Pencil className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
        {feature.description && <p className="text-gray-400 text-xs line-clamp-2">{feature.description}</p>}
        <div className="flex items-center gap-2 flex-wrap">
          <StatusBadge status={feature.status} />
          <PriorityBadge priority={feature.priority} />
        </div>
      </div>

      {/* Desktop layout */}
      <div className="hidden sm:grid grid-cols-[2fr_1fr_1fr_1fr_1fr_40px] gap-4 items-center">
        <div>
          <p className="text-white text-sm font-semibold truncate">{feature.name}</p>
          {feature.description && <p className="text-gray-500 text-xs truncate mt-0.5">{feature.description}</p>}
        </div>
        <StatusBadge status={feature.status} />
        <PriorityBadge priority={feature.priority} />
        <span className="flex items-center gap-1 text-xs text-gray-400 truncate">
          <User className="w-3 h-3 shrink-0" />
          {feature.owner || '—'}
        </span>
        <span className="flex items-center gap-1 text-xs text-gray-400">
          <Calendar className="w-3 h-3 shrink-0" />
          {new Date(feature.lastUpdated).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </span>
        <div className="flex items-center gap-1.5 justify-end">
          {feature.meegoUrl && (
            <>
              <a href={feature.meegoUrl} target="_blank" rel="noreferrer" className="text-gray-500 hover:text-purple-400 transition-colors">
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
              <button onClick={() => onSync(feature)} disabled={syncing} className="text-gray-500 hover:text-blue-400 disabled:opacity-40">
                <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
              </button>
            </>
          )}
          <button onClick={() => onEdit(feature)} className="text-gray-500 hover:text-white">
            <Pencil className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
