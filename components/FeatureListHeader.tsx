'use client';

export function FeatureListHeader() {
  return (
    <div className="hidden sm:grid grid-cols-[2fr_160px_52px_220px_1fr] gap-4 px-4 py-2 text-xs text-gray-500 font-medium border-b border-[#1e2240] mb-1">
      <span className="justify-self-start">Feature</span>
      <span className="justify-self-start">Status</span>
      <span className="justify-self-start">Priority</span>
      <span className="justify-self-start">Links</span>
      <span className="justify-self-start">Last Updated</span>
    </div>
  );
}
