'use client';
import { useState } from 'react';
import { Feature } from '@/lib/types';
import Image from 'next/image';

interface LinkDef {
  key: string;
  label: string;
  icon: string;
  iconW: number;
  iconH: number;
  color: string;
  url: string;
}

function buildLinks(feature: Feature): LinkDef[] {
  const links: LinkDef[] = [];
  if (feature.meegoUrl)
    links.push({ key: 'meego', label: 'Meego', icon: '/meego.png', iconW: 16, iconH: 16, color: '#B291F7', url: feature.meegoUrl });
  if (feature.prd)
    links.push({ key: 'prd', label: 'PRD', icon: '/prd.png', iconW: 14, iconH: 14, color: '#60A5FA', url: feature.prd });
  if (feature.complianceUrl)
    links.push({ key: 'compliance', label: 'Compliance', icon: '/compliance.png', iconW: 14, iconH: 14, color: '#88DBDD', url: feature.complianceUrl });
  if (feature.figmaUrl)
    links.push({ key: 'figma', label: 'Figma', icon: '/figma.svg', iconW: 10, iconH: 14, color: '#FF7362', url: feature.figmaUrl });
  if (feature.abReportUrl)
    links.push({ key: 'ab', label: 'AB Report', icon: '/ab.png', iconW: 14, iconH: 14, color: '#F59E0B', url: feature.abReportUrl });
  return links;
}

/* Each icon sits inside a fixed-width slot (24px collapsed, overlapping by 4px).
   On hover the slot widens to fit the label — the icon stays pinned at the left
   edge of its slot so it doesn't move; only slots to the right get pushed. */

const ICON_SIZE = 28;   // circle diameter
const OVERLAP   = 4;    // negative overlap between icons
const SLOT_W    = ICON_SIZE - OVERLAP; // 24px collapsed slot width

function LinkChip({ link, isLast }: { link: LinkDef; isLast: boolean; ringColor: string }) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className="relative flex items-center shrink-0"
      style={{ width: hovered ? undefined : isLast ? ICON_SIZE : SLOT_W, zIndex: hovered ? 20 : 1 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <a
        href={link.url}
        target="_blank"
        rel="noreferrer"
        className="flex items-center h-7 rounded-full bg-[#1a1d32] hover:brightness-125 cursor-pointer"
        style={{
          outline: '2px solid var(--ring-color)',
          outlineOffset: '-1px',
        }}
      >
        <span className="w-7 h-7 flex items-center justify-center shrink-0">
          <Image
            src={link.icon}
            alt={link.label}
            width={Math.min(link.iconW, 15)}
            height={Math.min(link.iconH, 15)}
            className="shrink-0"
          />
        </span>
        {hovered && (
          <span
            className="whitespace-nowrap text-[11px] font-semibold leading-none pr-2.5"
            style={{ color: link.color }}
          >
            {link.label}
          </span>
        )}
      </a>
    </div>
  );
}

// ─── Public component ────────────────────────────────────────────────────────

interface Props {
  feature: Feature;
  ringColor?: string;
}

export function LinkIcons({ feature, ringColor = '#13162a' }: Props) {
  const links = buildLinks(feature);
  if (links.length === 0) return <span className="text-gray-600 text-xs">—</span>;

  return (
    <div className="flex items-center" style={{ '--ring-color': ringColor } as React.CSSProperties}>
      {links.map((link, i) => (
        <LinkChip key={link.key} link={link} isLast={i === links.length - 1} ringColor={ringColor} />
      ))}
    </div>
  );
}
