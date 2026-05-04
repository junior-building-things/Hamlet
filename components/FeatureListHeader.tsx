'use client';

interface Props {
  hideStatus?: boolean;
  hidePriority?: boolean;
  /** Same gridTemplateColumns the rows render with so headers and
   *  values share identical column tracks. */
  gridTemplateColumns: string;
}

export function FeatureListHeader({ hideStatus, hidePriority, gridTemplateColumns }: Props) {
  // Mirror the row's column order (Feature, Status?, Version, Priority?,
  // Links, Team, Risk, Notes, Action, Sync). Each label uses the same
  // `pl-4` left padding the row cells use so headers sit flush above
  // their column values.
  const labels: Array<string | null> = [
    'Feature',
    hideStatus   ? null : 'Status',
    'Version',
    hidePriority ? null : 'Priority',
    'Links',
    'Team',
    'Risk',
    'Notes',
    'Action',
    null, // Sync — no header label
  ];

  return (
    <div
      className="hidden sm:grid py-2.5 sticky top-0 bg-[var(--bg-elev-1)] border-b border-[var(--hairline)] z-10"
      style={{ gridTemplateColumns, columnGap: '0.75rem' }}
    >
      {labels.map((label, i) => (
        <span
          key={i}
          className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-dim)] pl-4"
        >
          {label ?? ''}
        </span>
      ))}
    </div>
  );
}
