'use client';

export function FeatureListHeader() {
  return (
    <div className="hidden sm:grid grid-cols-[2fr_1fr_auto_1fr_1fr] gap-4 px-4 py-2 text-xs text-gray-500 font-medium border-b border-[#1e2240] mb-1 justify-items-start">
      <span>Feature</span>
      <span>Status</span>
      <span>Priority</span>
      <span>Links</span>
      <span>Last Updated</span>
    </div>
  );
}
