'use client';
import { Feature } from '@/lib/types';
import { StatusBadge } from './StatusBadge';
import { PriorityBadge } from './PriorityBadge';
import { Pencil, User, Calendar, ExternalLink, RefreshCw } from 'lucide-react';

interface Props {
  feature: Feature;
  syncing: boolean;
  onEdit: (feature: Feature) => void;
  onSync: (feature: Feature) => void;
}

export function FeatureCard({ feature, syncing, onEdit, onSync }: Props) {
  const completedTasks = feature.tasks.filter(t => t.completed).length;
  const totalTasks = feature.tasks.length;

  return (
    <div className="bg-[#13162a] border border-[#1e2240] rounded-xl p-5 flex flex-col gap-3 hover:border-[#2e3460] transition-colors">
      {/* Title row */}
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-white font-semibold text-base leading-tight">{feature.name}</h3>
        <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
          {feature.meegoUrl && (
            <>
              <a href={feature.meegoUrl} target="_blank" rel="noreferrer"
                className="text-gray-500 hover:text-blue-400 transition-colors" title="Open in Meego">
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
              <button onClick={() => onSync(feature)} disabled={syncing}
                className="text-gray-500 hover:text-blue-400 transition-colors disabled:opacity-40" title="Sync status from Meego">
                <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
              </button>
            </>
          )}
          <button onClick={() => onEdit(feature)}
            className="text-gray-500 hover:text-white transition-colors" title="Edit feature">
            <Pencil className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Description */}
      {feature.description && (
        <p className="text-gray-400 text-sm leading-relaxed line-clamp-3">{feature.description}</p>
      )}

      {/* Badges */}
      <div className="flex items-center gap-2 flex-wrap">
        <StatusBadge status={feature.status} />
        <PriorityBadge priority={feature.priority} />
      </div>

      {/* Owner + Date */}
      <div className="flex items-center gap-4 text-xs text-gray-500">
        {feature.owner && (
          <span className="flex items-center gap-1">
            <User className="w-3 h-3" />
            {feature.owner}
          </span>
        )}
        <span className="flex items-center gap-1">
          <Calendar className="w-3 h-3" />
          {new Date(feature.lastUpdated).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </span>
      </div>

      {/* Tasks */}
      {totalTasks > 0 && (
        <div className="border-t border-[#1e2240] pt-3">
          <div className="flex items-center justify-between text-xs text-gray-400 mb-2">
            <span className="font-medium">Tasks</span>
            <span>{completedTasks}/{totalTasks}</span>
          </div>
          <div className="flex flex-col gap-1.5">
            {feature.tasks.map(task => (
              <div key={task.id} className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded border shrink-0 flex items-center justify-center ${task.completed ? 'bg-emerald-600 border-emerald-600' : 'border-gray-600'}`}>
                  {task.completed && <span className="text-white text-[8px]">✓</span>}
                </div>
                <span className={`text-xs ${task.completed ? 'line-through text-gray-600' : 'text-gray-300'}`}>
                  {task.text}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
