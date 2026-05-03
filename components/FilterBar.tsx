'use client';
import { useState, useEffect } from 'react';
import { Priority } from '@/lib/types';
import { Search, Plus, ArrowUp, ArrowDown, Sun, Moon } from 'lucide-react';

// Inline SVG icons that match the design's distinct icon vocabulary.
// Filter (funnel) for filter chips, Group (2x2 grid) for grouping,
// Sort (up/down arrows) for sort, so the toolbar's chip purposes are
// readable at a glance.
const FilterIcon = ({ className = '' }: { className?: string }) => (
  <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 3.5h12M4 8h8M6 12.5h4" />
  </svg>
);
const GroupIcon = ({ className = '' }: { className?: string }) => (
  <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="2.5" width="5" height="5" rx="1" />
    <rect x="9" y="2.5" width="5" height="5" rx="1" />
    <rect x="2" y="9"   width="5" height="5" rx="1" />
    <rect x="9" y="9"   width="5" height="5" rx="1" />
  </svg>
);
const SortIcon = ({ className = '' }: { className?: string }) => (
  <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 3v10M5 13l-2-2M5 13l2-2M11 13V3M11 3 9 5M11 3l2 2" />
  </svg>
);
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
const selectCls = '';
// Chip-style trigger button — matches the design's `.chip` rule.
// 28px tall, mono-uppercase value with leading icon + chevron.
const chipCls = 'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-[var(--r-sm)] bg-[var(--bg-elev-2)] border border-[var(--hairline)] text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--hairline-strong)] text-[11.5px] font-mono uppercase tracking-[0.04em] transition-colors whitespace-nowrap';

export function FilterBar({
  search, statusFilter, statuses, priorityFilter,
  onSearchChange, onStatusChange, onPriorityChange, onAddFeature, hideAddButton,
  groupBy, onGroupByChange, sortBy, onSortByChange, sortDir, onSortDirToggle,
}: Props) {
  return (
    <div className="flex items-center gap-2 px-5 py-3 border-b border-[var(--hairline)] bg-[var(--bg-elev-1)] flex-wrap">

      {/* Search */}
      <div className="flex items-center gap-2 bg-[var(--bg-elev-2)] border border-[var(--hairline)] rounded-[var(--r-sm)] px-3 h-[30px] w-[240px] shrink-0">
        <Search className="w-3.5 h-3.5 text-[var(--text-dim)] shrink-0" />
        <input
          type="text"
          placeholder="Search features, owners, PRDs…"
          value={search}
          onChange={e => onSearchChange(e.target.value)}
          className="bg-transparent text-[12px] text-[var(--text)] placeholder-[var(--text-dim)] outline-none w-full"
        />
        <span className="font-mono text-[9.5px] text-[var(--text-dim)] px-1 py-px rounded border border-[var(--hairline)]">⌘K</span>
      </div>

      {/* Status filter */}
      <MultiSelect
        icon={<FilterIcon className="w-3 h-3" />}
        options={statuses.map(s => ({ value: s, label: s }))}
        value={statusFilter}
        onChange={onStatusChange}
        placeholder="Status"
        className={selectCls}
        triggerClassName={chipCls}
      />

      {/* Priority filter */}
      <MultiSelect
        icon={<FilterIcon className="w-3 h-3" />}
        options={priorities.map(p => ({ value: p, label: p }))}
        value={priorityFilter}
        onChange={onPriorityChange}
        placeholder="Priority"
        className={selectCls}
        triggerClassName={chipCls}
      />

      {/* Group By */}
      <CustomSelect
        icon={<GroupIcon className="w-3 h-3" />}
        options={[
          { value: 'priority',        label: 'Priority' },
          { value: 'status',          label: 'Current Status' },
          { value: 'businessLine',    label: 'Business Line' },
          { value: 'socialComponent', label: 'Social Component' },
        ]}
        value={groupBy === 'none' ? '' : groupBy}
        onChange={v => onGroupByChange((v || 'none') as GroupBy)}
        placeholder="Group"
        allowDeselect
        className={selectCls}
        triggerClassName={chipCls}
      />

      {/* Sort By + direction */}
      <div className="flex items-center gap-1">
        <CustomSelect
          icon={<SortIcon className="w-3 h-3" />}
          options={[
            { value: 'priority',    label: 'Priority' },
            { value: 'status',      label: 'Current Status' },
            { value: 'lastUpdated', label: 'Last Updated' },
          ]}
          value={sortBy === 'none' ? '' : sortBy}
          onChange={v => onSortByChange((v || 'none') as SortBy)}
          placeholder="Sort"
          allowDeselect
          className={selectCls}
          triggerClassName={chipCls}
        />
        <button
          onClick={onSortDirToggle}
          disabled={sortBy === 'none'}
          title={sortDir === 'asc' ? 'Ascending (click to reverse)' : 'Descending (click to reverse)'}
          className="inline-flex items-center justify-center w-7 h-7 rounded-[var(--r-sm)] bg-[var(--bg-elev-2)] border border-[var(--hairline)] text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--hairline-strong)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
        >
          {sortDir === 'asc'
            ? <ArrowUp   className="w-3 h-3" />
            : <ArrowDown className="w-3 h-3" />}
        </button>
      </div>

      {/* Add Feature */}
      {!hideAddButton && (
        <button
          onClick={onAddFeature}
          className="flex items-center gap-1.5 bg-[var(--text)] text-[var(--bg)] text-[12px] font-medium px-3 h-7 rounded-[var(--r-sm)] hover:opacity-90 transition-opacity whitespace-nowrap ml-auto"
        >
          <Plus className="w-3 h-3" />
          New Feature
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
      className="hm-icon-btn shrink-0"
      title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {theme === 'dark' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
    </button>
  );
}
