'use client';
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

// ─── Public component ────────────────────────────────────────────────────────

interface Props {
  feature: Feature;
  ringColor?: string;
}

export function LinkIcons({ feature, ringColor = '#13162a' }: Props) {
  const links = buildLinks(feature);
  if (links.length === 0) return <span className="text-gray-600 text-xs">—</span>;

  return (
    <div className="flex items-center">
      {links.map((link, i) => (
        <a
          key={link.key}
          href={link.url}
          target="_blank"
          rel="noreferrer"
          className="group/link flex items-center h-7 rounded-full bg-[#1a1d32] cursor-pointer hover:brightness-125 transition-all duration-200 hover:z-20 relative"
          style={{
            marginLeft: i === 0 ? 0 : '-4px',
            zIndex: links.length - i,
            outline: `2px solid ${ringColor}`,
            outlineOffset: '-1px',
            /* collapsed = icon only (28px circle), expanded = icon + text */
            width: '28px',
          }}
        >
          {/* Icon — always visible, centred in the circle */}
          <span className="w-7 h-7 flex items-center justify-center shrink-0">
            <Image
              src={link.icon}
              alt={link.label}
              width={Math.min(link.iconW, 15)}
              height={Math.min(link.iconH, 15)}
              className="shrink-0"
            />
          </span>

          {/* Label — hidden by default, slides in on hover */}
          <span
            className="overflow-hidden whitespace-nowrap text-[11px] font-semibold leading-none
                       max-w-0 opacity-0 group-hover/link:max-w-[80px] group-hover/link:opacity-100
                       group-hover/link:pr-2.5 transition-all duration-200 ease-out"
            style={{ color: link.color }}
          >
            {link.label}
          </span>
        </a>
      ))}
    </div>
  );
}
