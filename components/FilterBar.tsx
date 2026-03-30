'use client';
import { Priority } from '@/lib/types';
import { Search, Filter, LayoutGrid, List, Plus, Layers, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { CustomSelect } from './AvatarSelect';

export type GroupBy  = 'none' | 'priority' | 'status' | 'businessLine' | 'socialComponent';
export type SortBy   = 'none' | 'priority' | 'status' | 'lastUpdated';
export type SortDir  = 'asc' | 'desc';

interface Props {
  search: string;
  statusFilter: string;
  statuses: string[];
  priorityFilter: Priority | 'All';
  view: 'grid' | 'list';
  onSearchChange: (v: string) => void;
  onStatusChange: (v: string) => void;
  onPriorityChange: (v: Priority | 'All') => void;
  onViewChange: (v: 'grid' | 'list') => void;
  onAddFeature: () => void;
  hideAddButton?: boolean;
  // Group + Sort (list view only)
  groupBy: GroupBy;
  onGroupByChange: (v: GroupBy) => void;
  sortBy: SortBy;
  onSortByChange: (v: SortBy) => void;
  sortDir: SortDir;
  onSortDirToggle: () => void;
}

const priorities: (Priority | 'All')[] = ['All', 'P0', 'P1', 'P2', 'P3'];

const cellCls = 'flex items-center gap-2 bg-[#13162a] border border-[#1e2240] rounded-lg px-3 py-2';

export function FilterBar({
  search, statusFilter, statuses, priorityFilter, view,
  onSearchChange, onStatusChange, onPriorityChange, onViewChange, onAddFeature, hideAddButton,
  groupBy, onGroupByChange, sortBy, onSortByChange, sortDir, onSortDirToggle,
}: Props) {
  return (
    <div className="flex items-center gap-2 px-6 mt-5 flex-wrap">

      {/* Search */}
      <div className={`${cellCls} min-w-[180px]`}>
        <Search className="w-4 h-4 text-gray-500 shrink-0" />
        <input
          type="text"
          placeholder="Search features..."
          value={search}
          onChange={e => onSearchChange(e.target.value)}
          className="bg-transparent text-sm text-white placeholder-gray-500 outline-none w-full"
        />
      </div>

      {/* Status filter */}
      <div className={cellCls}>
        <Filter className="w-4 h-4 text-gray-500 shrink-0" />
        <select value={statusFilter} onChange={e => onStatusChange(e.target.value)} className="bg-transparent text-sm text-white outline-none cursor-pointer">
          <option value="All" className="bg-[#13162a]">All Status</option>
          {statuses.map(s => <option key={s} value={s} className="bg-[#13162a]">{s}</option>)}
        </select>
      </div>

      {/* Priority filter */}
      <div className={cellCls}>
        <Filter className="w-4 h-4 text-gray-500 shrink-0" />
        <select value={priorityFilter} onChange={e => onPriorityChange(e.target.value as Priority | 'All')} className="bg-transparent text-sm text-white outline-none cursor-pointer">
          {priorities.map(p => (
            <option key={p} value={p} className="bg-[#13162a]">{p === 'All' ? 'All Priority' : p}</option>
          ))}
        </select>
      </div>

      {/* Divider */}
      <div className="w-px h-6 bg-[#1e2240]" />

      {/* Group By */}
      <CustomSelect
        icon={<Layers className="w-4 h-4" />}
        options={[
          { value: 'priority',        label: 'Priority' },
          { value: 'status',          label: 'Current Status' },
          { value: 'businessLine',    label: 'Business Line' },
          { value: 'socialComponent', label: 'Social Component' },
        ]}
        value={groupBy === 'none' ? '' : groupBy}
        onChange={v => onGroupByChange((v || 'none') as GroupBy)}
        placeholder="Group By"
        allowDeselect
      />

      {/* Sort By + direction */}
      <div className="flex items-center gap-1">
        <CustomSelect
          icon={<ArrowUpDown className="w-4 h-4" />}
          options={[
            { value: 'priority',    label: 'Priority' },
            { value: 'status',      label: 'Current Status' },
            { value: 'lastUpdated', label: 'Last Updated' },
          ]}
          value={sortBy === 'none' ? '' : sortBy}
          onChange={v => onSortByChange((v || 'none') as SortBy)}
          placeholder="Sort By"
          allowDeselect
        />
        <button
          onClick={onSortDirToggle}
          disabled={sortBy === 'none'}
          title={sortDir === 'asc' ? 'Ascending (click to reverse)' : 'Descending (click to reverse)'}
          className="bg-[#13162a] border border-[#2e3460] rounded-lg px-2.5 py-2 text-gray-400 hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
        >
          {sortDir === 'asc'
            ? <ArrowUp   className="w-4 h-4" />
            : <ArrowDown className="w-4 h-4" />}
        </button>
      </div>

      {/* View toggle */}
      <div className="flex bg-[#13162a] border border-[#1e2240] rounded-lg overflow-hidden">
        <button
          onClick={() => onViewChange('grid')}
          className={`px-3 py-2 transition-colors ${view === 'grid' ? 'bg-[#1e2240] text-white' : 'text-gray-500 hover:text-white'}`}
          title="Grid view"
        >
          <LayoutGrid className="w-4 h-4" />
        </button>
        <button
          onClick={() => onViewChange('list')}
          className={`px-3 py-2 transition-colors ${view === 'list' ? 'bg-[#1e2240] text-white' : 'text-gray-500 hover:text-white'}`}
          title="List view"
        >
          <List className="w-4 h-4" />
        </button>
      </div>

      {/* Add Feature */}
      {!hideAddButton && (
        <button
          onClick={onAddFeature}
          className="flex items-center gap-1.5 bg-white text-black text-sm font-semibold px-4 py-2 rounded-lg hover:bg-gray-100 transition-colors whitespace-nowrap ml-auto"
        >
          <Plus className="w-4 h-4" />
          Create Feature
        </button>
      )}
    </div>
  );
}
