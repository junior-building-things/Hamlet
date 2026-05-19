'use client';
import { ChevronDown, Check } from 'lucide-react';
import { useDropdown } from './AvatarSelect';

/**
 * Shared primitives for the unified Cron + Prompts card design.
 *
 * `MetaSelect` is the "LABEL · value · ⌃" inline picker used for
 *   Send time / Frequency on Cron cards
 *   Model / Thinking budget on Prompt cards
 *
 * `MetaTag` is the leading-dot mono pill with tone variants
 *   (hamlet, junior, rio, mia, team_thomas, progress_update,
 *    feature_group, compliance, paused).
 */

export type MetaTagTone =
  | 'hamlet' | 'junior' | 'rio' | 'mia'
  | 'team_thomas' | 'progress_update' | 'feature_group' | 'compliance'
  | 'paused';

export function MetaTag({
  tone, label, iconUrl, className = '',
}: {
  tone: MetaTagTone;
  label: string;
  iconUrl?: string;
  className?: string;
}) {
  return (
    <span className={`meta-tag tone-${tone} ${iconUrl ? 'has-icon' : ''} ${className}`}>
      {iconUrl && (
        <img
          src={iconUrl}
          alt=""
          className="meta-tag-icon"
          onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
        />
      )}
      {label}
    </span>
  );
}

export function MetaSelect({
  label, value, options, disabled, onChange, isDefault, title,
}: {
  label: string;
  value: string;
  options: readonly string[];
  disabled?: boolean;
  onChange: (v: string) => void;
  isDefault?: boolean;
  title?: string;
}) {
  const { open, setOpen, openDropdown, maxHeight, ref } = useDropdown();
  const allOptions = options.includes(value) ? options : [value, ...options];

  return (
    <span ref={ref} className={`meta-select relative ${disabled ? 'disabled' : ''}`} title={title}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => disabled ? undefined : (open ? setOpen(false) : openDropdown())}
        className="ms-trigger inline-flex items-center gap-1.5 bg-transparent border-0 p-0 cursor-pointer disabled:cursor-default"
      >
        <span className="ms-label">{label}</span>
        <span className="ms-value">{value}</span>
        {isDefault && <span className="ms-default">(default)</span>}
        <ChevronDown className="w-2.5 h-2.5 text-[var(--text-dim)]" />
      </button>

      {open && !disabled && (
        <div
          className="absolute z-20 top-full left-0 mt-1 min-w-full bg-[var(--card)] border border-[var(--border)] rounded-lg shadow-2xl overflow-y-auto whitespace-nowrap"
          style={{ maxHeight }}
        >
          {allOptions.map(opt => (
            <div
              key={opt}
              className="px-3 py-1.5 flex items-center gap-2.5 cursor-pointer hover:bg-[var(--card-hover)] text-[12px] text-[var(--foreground)]"
              onClick={() => { onChange(opt); setOpen(false); }}
            >
              <span className="flex-1">{opt}</span>
              {value === opt && <Check className="w-3 h-3 text-blue-400 flex-shrink-0" />}
            </div>
          ))}
        </div>
      )}
    </span>
  );
}
