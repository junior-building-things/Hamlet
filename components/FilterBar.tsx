'use client';
import { Priority } from '@/lib/types';
import { Search, LayoutGrid, List, Plus, Layers, ArrowUpDown, ArrowUp, ArrowDown, CircleDot, Tag } from 'lucide-react';
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
  groupBy: GroupBy;
  onGroupByChange: (v: GroupBy) => void;
  sortBy: SortBy;
  onSortByChange: (v: SortBy) => void;
  sortDir: SortDir;
  onSortDirToggle: () => void;
}

const priorities: Priority[] = ['P0', 'P1', 'P2', 'P3'];
const selectCls = 'min-w-[130px] max-w-[180px]';

export function FilterBar({
  search, statusFilter, statuses, priorityFilter, view,
  onSearchChange, onStatusChange, onPriorityChange, onViewChange, onAddFeature, hideAddButton,
  groupBy, onGroupByChange, sortBy, onSortByChange, sortDir, onSortDirToggle,
}: Props) {
  return (
    <div className="flex items-center gap-2 px-6 mt-5 flex-wrap">

      {/* Search */}
      <div className="flex items-center gap-2 bg-[#13162a] border border-[#2e3460] rounded-lg px-3 py-2 min-w-[180px]">
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
      <CustomSelect
        icon={<CircleDot className="w-4 h-4" />}
        options={statuses.map(s => ({ value: s, label: s }))}
        value={statusFilter === 'All' ? '' : statusFilter}
        onChange={v => onStatusChange(v || 'All')}
        placeholder="Status"
        allowDeselect
        className={selectCls}
      />

      {/* Priority filter */}
      <CustomSelect
        icon={<Tag className="w-4 h-4" />}
        options={priorities.map(p => ({ value: p, label: p }))}
        value={priorityFilter === 'All' ? '' : priorityFilter}
        onChange={v => onPriorityChange((v || 'All') as Priority | 'All')}
        placeholder="Priority"
        allowDeselect
        className={selectCls}
      />

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
        className={selectCls}
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
          className={selectCls}
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
      <div className="flex bg-[#13162a] border border-[#2e3460] rounded-lg overflow-hidden">
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
