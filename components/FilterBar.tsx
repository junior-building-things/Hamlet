'use client';
import { useState, useEffect } from 'react';
import { Priority } from '@/lib/types';
import { Search, Plus, Layers, ArrowUpDown, ArrowUp, ArrowDown, CircleDot, Tag, Sun, Moon } from 'lucide-react';
import { CustomSelect, MultiSelect } from './AvatarSelect';

export type GroupBy  = 'none' | 'priority' | 'status' | 'businessLine' | 'socialComponent';
export type SortBy   = 'none' | 'priority' | 'status' | 'lastUpdated';
export type SortDir  = 'asc' | 'desc';

interface Props {
  search: string;
  statusFilter: string[];
  statuses: string[];
  priorityFilter: string[];
  onSearchChange: (v: string) => void;
  onStatusChange: (v: string[]) => void;
  onPriorityChange: (v: string[]) => void;
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
const selectCls = 'min-w-[100px]';

export function FilterBar({
  search, statusFilter, statuses, priorityFilter,
  onSearchChange, onStatusChange, onPriorityChange, onAddFeature, hideAddButton,
  groupBy, onGroupByChange, sortBy, onSortByChange, sortDir, onSortDirToggle,
}: Props) {
  return (
    <div className="flex items-center gap-2 px-6 mt-5 flex-wrap">

      {/* Search */}
      <div className="flex items-center gap-2 bg-[var(--card)] border border-[var(--border)] rounded-lg px-3 py-2 min-w-[180px]">
        <Search className="w-4 h-4 text-gray-500 shrink-0" />
        <input
          type="text"
          placeholder="Search features..."
          value={search}
          onChange={e => onSearchChange(e.target.value)}
          className="bg-transparent text-sm text-[var(--foreground)] placeholder-gray-500 outline-none w-full"
        />
      </div>

      {/* Status filter (multi-select) */}
      <MultiSelect
        icon={<CircleDot className="w-4 h-4" />}
        options={statuses.map(s => ({ value: s, label: s }))}
        value={statusFilter}
        onChange={onStatusChange}
        placeholder="Status"
        className={selectCls}
      />

      {/* Priority filter (multi-select) */}
      <MultiSelect
        icon={<Tag className="w-4 h-4" />}
        options={priorities.map(p => ({ value: p, label: p }))}
        value={priorityFilter}
        onChange={onPriorityChange}
        placeholder="Priority"
        className={selectCls}
      />

      {/* Divider */}
      <div className="w-px h-6 bg-[var(--card-hover)]" />

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
          className="bg-[var(--card)] border border-[var(--border)] rounded-lg px-2.5 py-2 text-gray-400 hover:text-[var(--foreground)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
        >
          {sortDir === 'asc'
            ? <ArrowUp   className="w-4 h-4" />
            : <ArrowDown className="w-4 h-4" />}
        </button>
      </div>

      {/* Add Feature */}
      {!hideAddButton && (
        <button
          onClick={onAddFeature}
          className="flex items-center gap-1.5 bg-[var(--foreground)] text-[var(--background)] text-sm font-semibold px-4 py-2 rounded-lg hover:opacity-80 transition-colors whitespace-nowrap ml-auto"
        >
          <Plus className="w-4 h-4" />
          Create Feature
        </button>
      )}
    </div>
  );
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<'dark' | 'light'>('light');

  useEffect(() => {
    const stored = document.documentElement.getAttribute('data-theme') as 'dark' | 'light' | null;
    if (stored) setTheme(stored);
  }, []);

  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('hamlet_theme', next);
  }

  return (
    <button
      onClick={toggle}
      className="bg-[var(--card)] border border-[var(--border)] rounded-lg px-2.5 py-2 text-[var(--muted)] hover:text-[var(--foreground)] transition-colors shrink-0"
      title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  );
}
