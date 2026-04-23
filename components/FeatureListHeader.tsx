'use client';

export function FeatureListHeader({ gridCols, standalone }: { gridCols?: string; standalone?: boolean }) {
  const cls = standalone
    ? `hidden sm:grid ${gridCols} px-4 py-2 text-xs text-gray-500 font-medium border-b border-[var(--border)] gap-x-1.5`
    : 'hidden sm:grid sm:col-span-full sm:[grid-template-columns:subgrid] px-4 py-2 text-xs text-gray-500 font-medium border-b border-[var(--border)]';
  return (
    <div className={cls}>
      <span>Feature</span>
      <span className="pl-4">Status</span>
      <span className="pl-4">Version</span>
      <span>Priority</span>
      <span className="pl-4">Links</span>
      <span className="pl-4">Team</span>
      <span className="pl-4">Risk</span>
      <span className="pl-4">Notes</span>
      <span className="pl-4">Action</span>
      <span></span>
    </div>
  );
}
