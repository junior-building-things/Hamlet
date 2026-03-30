'use client';

export function FeatureListHeader() {
  return (
    <div className="hidden sm:grid sm:col-span-full sm:[grid-template-columns:subgrid] px-4 py-2 text-xs text-gray-500 font-medium border-b border-[#1e2240]">
      <span>Feature</span>
      <span className="pl-4">Status</span>
      <span className="pl-4">iOS Version</span>
      <span>Priority</span>
      <span className="pl-4">Links</span>
      <span className="pl-4">Team</span>
      <span className="pl-4">Last Updated</span>
      <span className="pl-4">Action</span>
    </div>
  );
}
