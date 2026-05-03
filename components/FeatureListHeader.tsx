'use client';

interface Props {
  hideStatus?: boolean;
  hidePriority?: boolean;
}

export function FeatureListHeader({ hideStatus, hidePriority }: Props) {
  // Mirror the row's column order (Feature, Status?, Version, Priority?,
  // Links, Team, Risk, Notes, Action, Sync). Hidden columns are simply
  // not rendered so the subgrid track count matches ProjectView's
  // dynamic gridTemplateColumns.
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
      className="hidden sm:grid sm:col-span-full sm:[grid-template-columns:subgrid] py-2.5 px-5 sticky top-0 bg-[var(--bg-elev-1)] border-b border-[var(--hairline)] z-10"
    >
      {labels.map((label, i) => (
        <span
          key={i}
          className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-dim)]"
          style={{ paddingLeft: i === 0 || label == null ? 0 : 4 }}
        >
          {label ?? ''}
        </span>
      ))}
    </div>
  );
}
