'use client';

export function FeatureListHeader() {
  return (
    <div className="hidden sm:grid grid-cols-[2fr_1fr_1fr_1fr_1fr_40px] gap-4 px-4 py-2 text-xs text-gray-500 font-medium border-b border-[#1e2240] mb-1">
      <span>Feature</span>
      <span>Current Status</span>
      <span>Risk</span>
      <span>POC</span>
      <span>Last Updated</span>
      <span></span>
    </div>
  );
}
