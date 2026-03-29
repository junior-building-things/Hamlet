'use client';
import { Priority } from '@/lib/types';
import { Search, Filter, LayoutGrid, List, Plus, Layers, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';

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

const selectCls = 'bg-transparent text-sm text-white outline-none cursor-pointer';
const cellCls   = 'flex items-center gap-2 bg-[#13162a] border border-[#1e2240] rounded-lg px-3 py-2';

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
        <select value={statusFilter} onChange={e => onStatusChange(e.target.value)} className={selectCls}>
          <option value="All" className="bg-[#13162a]">All Status</option>
          {statuses.map(s => <option key={s} value={s} className="bg-[#13162a]">{s}</option>)}
        </select>
      </div>

      {/* Priority filter */}
      <div className={cellCls}>
        <Filter className="w-4 h-4 text-gray-500 shrink-0" />
        <select value={priorityFilter} onChange={e => onPriorityChange(e.target.value as Priority | 'All')} className={selectCls}>
          {priorities.map(p => (
            <option key={p} value={p} className="bg-[#13162a]">{p === 'All' ? 'All Priority' : p}</option>
          ))}
        </select>
      </div>

      {/* Divider */}
      <div className="w-px h-6 bg-[#1e2240]" />

      {/* Group By */}
      <div className={cellCls}>
        <Layers className="w-4 h-4 text-gray-500 shrink-0" />
        <select value={groupBy} onChange={e => onGroupByChange(e.target.value as GroupBy)} className={selectCls}>
          <option value="none"            className="bg-[#13162a]">No Grouping</option>
          <option value="priority"        className="bg-[#13162a]">Priority</option>
          <option value="status"          className="bg-[#13162a]">Current Status</option>
          <option value="businessLine"    className="bg-[#13162a]">Business Line</option>
          <option value="socialComponent" className="bg-[#13162a]">Social Component</option>
        </select>
      </div>

      {/* Sort By + direction */}
      <div className="flex items-center">
        <div className="flex items-center gap-2 bg-[#13162a] border border-[#1e2240] rounded-l-lg px-3 py-2 border-r-0">
          <ArrowUpDown className="w-4 h-4 text-gray-500 shrink-0" />
          <select value={sortBy} onChange={e => onSortByChange(e.target.value as SortBy)} className={selectCls}>
            <option value="none"        className="bg-[#13162a]">No Sort</option>
            <option value="priority"    className="bg-[#13162a]">Priority</option>
            <option value="status"      className="bg-[#13162a]">Current Status</option>
            <option value="lastUpdated" className="bg-[#13162a]">Last Updated</option>
          </select>
        </div>
        <button
          onClick={onSortDirToggle}
          disabled={sortBy === 'none'}
          title={sortDir === 'asc' ? 'Ascending (click to reverse)' : 'Descending (click to reverse)'}
          className="bg-[#13162a] border border-[#1e2240] rounded-r-lg px-2.5 py-2 text-gray-400 hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
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
