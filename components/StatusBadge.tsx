'use client';

function statusStyle(status: string): string {
  const s = status.toLowerCase();
  if (s.includes('上线') || s.includes('launch') || s.includes('灰度') || s.includes('已发布') || s.includes('已完成') || s.includes('验收'))
    return 'bg-[#0d2b1f] text-emerald-400 border border-emerald-900';
  if (s.includes('ab') || s.includes('测试') || s.includes('testing'))
    return 'bg-[#1e2240] text-yellow-300';
  if (s.includes('开发') || s.includes('dev') || s.includes('coding') || s.includes('impl'))
    return 'bg-[#1a2535] text-blue-300';
  if (s.includes('设计') || s.includes('design') || s.includes('走查'))
    return 'bg-[#1e2240] text-purple-300';
  if (s.includes('hold') || s.includes('暂停') || s.includes('搁置'))
    return 'bg-[#221a10] text-amber-400 border border-amber-900';
  return 'bg-[#1e2240] text-gray-300';
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium whitespace-nowrap ${statusStyle(status)}`}>
      {status}
    </span>
  );
}
