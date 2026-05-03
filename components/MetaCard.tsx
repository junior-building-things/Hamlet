'use client';
import { ChevronDown } from 'lucide-react';

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
  return (
    <span className={`meta-select ${disabled ? 'disabled' : ''}`} title={title}>
      <span className="ms-label">{label}</span>
      <span className="ms-value">{value}</span>
      {isDefault && <span className="ms-default">(default)</span>}
      <ChevronDown className="w-2.5 h-2.5 text-[var(--text-dim)]" />
      {!disabled && (
        <select value={value} onChange={e => onChange(e.target.value)}>
          {!options.includes(value) && <option value={value}>{value}</option>}
          {options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      )}
    </span>
  );
}
