'use client';

interface Props {
  hideStatus?: boolean;
  hidePriority?: boolean;
  hideAction?: boolean;
  /** Same gridTemplateColumns the rows render with so headers and
   *  values share identical column tracks. */
  gridTemplateColumns: string;
}

export function FeatureListHeader({ hideStatus, hidePriority, hideAction, gridTemplateColumns }: Props) {
  // Mirror the row's column order (Feature, Status?, Version, Priority?,
  // Links, Team, Risk, Notes, Action, Sync). Each label uses the same
  // `pl-4` left padding the row cells use so headers sit flush above
  // their column values.
  // Conditionally drop hidden columns — the parent template + row cells
  // shrink to match, so the header MUST also drop them or its span count
  // exceeds the track count and labels drift to the wrong columns. The
  // Sync column has no label but still needs a span so the empty 10th
  // track is occupied (otherwise the previous span would fill it).
  const labels: string[] = [
    'Feature',
    ...(hideStatus   ? [] : ['Status']),
    'Version',
    ...(hidePriority ? [] : ['Priority']),
    'Links',
    'Team',
    'Risk',
    'Notes',
    ...(hideAction ? [] : ['Action']),
    '', // Sync (placeholder — keeps span count = column count)
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
          {label}
        </span>
      ))}
    </div>
  );
}
