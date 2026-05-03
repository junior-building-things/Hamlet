'use client';

export function FeatureListHeader() {
  return (
    <div
      className="hidden sm:grid sm:col-span-full sm:[grid-template-columns:subgrid] py-2.5 px-5 sticky top-0 bg-[var(--bg-elev-1)] border-b border-[var(--hairline)] z-10"
    >
      {/* Mono uppercase column labels per the redesign */}
      {['Feature', 'Status', 'Version', 'Priority', 'Links', 'Team', 'Risk', 'Notes', 'Action'].map((label, i) => (
        <span
          key={label}
          className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-dim)]"
          style={{ paddingLeft: i === 0 ? 0 : 4 }}
        >
          {label}
        </span>
      ))}
      <span />
    </div>
  );
}
