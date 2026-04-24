'use client';

export function FeatureListHeader() {
  return (
    <div className="hidden sm:grid sm:col-span-full sm:[grid-template-columns:subgrid] py-2 text-xs text-[var(--muted)] font-medium border-b border-[var(--border)] sticky top-0 bg-[var(--background)] z-10">
      <span className="pl-4">Feature</span>
      <span className="pl-4">Status</span>
      <span className="pl-4">Version</span>
      <span>Priority</span>
      <span className="pl-4">Links</span>
      <span className="pl-4">Team</span>
      <span className="pl-4">Risk</span>
      <span className="pl-4">Action</span>
      <span></span>
    </div>
  );
}
