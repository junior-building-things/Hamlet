'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Feature } from '@/lib/types';
import Image from 'next/image';

interface LinkDef {
  key: string;
  label: string;
  icon: string;
  dynamicIcon?: boolean;
  iconW: number;
  iconH: number;
  color: string;
  url?: string;
  onClick?: () => void;
}

function buildLinks(feature: Feature, onPackageClick?: (ios: boolean) => void): LinkDef[] {
  const links: LinkDef[] = [];
  if (feature.meegoUrl)
    links.push({ key: 'meego', label: 'Meego', icon: '/meego.png', iconW: 16, iconH: 16, color: '#B291F7', url: feature.meegoUrl });
  if (feature.prd)
    links.push({ key: 'prd', label: 'PRD', icon: '/prd.png', iconW: 14, iconH: 14, color: '#60A5FA', url: feature.prd });
  if (feature.complianceUrl)
    links.push({ key: 'compliance', label: 'Compliance', icon: '/compliance.png', iconW: 14, iconH: 14, color: '#88DBDD', url: feature.complianceUrl });
  if (feature.figmaUrl)
    links.push({ key: 'figma', label: 'Figma', icon: '/figma.svg', iconW: 10, iconH: 14, color: '#FF7362', url: feature.figmaUrl });
  if (feature.packageQrUrl)
    links.push({ key: 'android-pkg', label: 'Android Package', icon: feature.packageQrUrl, dynamicIcon: true, iconW: 20, iconH: 20, color: '#ffffff', onClick: () => onPackageClick?.(false) });
  if (feature.iosPackageQrUrl)
    links.push({ key: 'ios-pkg', label: 'iOS Package', icon: feature.iosPackageQrUrl, dynamicIcon: true, iconW: 20, iconH: 20, color: '#ffffff', onClick: () => onPackageClick?.(true) });
  if (feature.libraUrl)
    links.push({ key: 'libra', label: 'Libra', icon: '/libra.png', iconW: 14, iconH: 14, color: '#0073F0', url: feature.libraUrl });
  if (feature.abReportUrl)
    links.push({ key: 'ab', label: 'AB Report', icon: '/abreport.png', iconW: 14, iconH: 14, color: '#108453', url: feature.abReportUrl });
  return links;
}

const ICON_SIZE = 24;
const OVERLAP   = 5;
const SLOT_W    = ICON_SIZE - OVERLAP;

// ─── Tooltip showing all links ──────────────────────────────────────────────

function LinksTooltip({ links, anchor, onEnter, onLeave }: {
  links: LinkDef[];
  anchor: { top: number; left: number; width: number };
  onEnter: () => void;
  onLeave: () => void;
}) {
  const el = (
    <div
      className="fixed flex flex-col gap-1 px-3 py-2 rounded-lg bg-[#1a1d32] border border-[#2e3460] shadow-xl"
      style={{
        top: anchor.top - 6,
        left: anchor.left + anchor.width / 2,
        transform: 'translate(-50%, -100%)',
        zIndex: 9999,
      }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      {links.map(link => {
        const icon = link.dynamicIcon ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={link.icon} alt={link.label} className="w-[14px] h-[14px] shrink-0" />
        ) : (
          <Image src={link.icon} alt={link.label} width={14} height={14} className="shrink-0" />
        );

        const inner = (
          <>
            {icon}
            <span className="text-[11px] font-semibold whitespace-nowrap" style={{ color: link.color }}>
              {link.label}
            </span>
          </>
        );

        const cls = "flex items-center gap-2 px-1 py-0.5 rounded hover:bg-[#252845] transition-colors cursor-pointer";

        return link.url ? (
          <a key={link.key} href={link.url} target="_blank" rel="noreferrer" className={cls}>
            {inner}
          </a>
        ) : (
          <button key={link.key} className={cls} onClick={link.onClick}>
            {inner}
          </button>
        );
      })}
      <div className="absolute top-full left-1/2 -translate-x-1/2 border-l-[5px] border-r-[5px] border-t-[5px] border-l-transparent border-r-transparent border-t-[#2e3460]" />
    </div>
  );

  return createPortal(el, document.body);
}

// ─── Public component ────────────────────────────────────────────────────────

interface Props {
  feature: Feature;
  ringColor?: string;
  onPackageClick?: (ios: boolean) => void;
}

export function LinkIcons({ feature, ringColor = '#13162a', onPackageClick }: Props) {
  const links = buildLinks(feature, onPackageClick);
  if (links.length === 0) return <span className="text-gray-600 text-xs">—</span>;

  const [showTooltip, setShowTooltip] = useState(false);
  const [anchor, setAnchor] = useState({ top: 0, left: 0, width: 0 });
  const [mounted, setMounted] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => { setMounted(true); }, []);

  const show = useCallback(() => {
    if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; }
    if (ref.current) {
      const r = ref.current.getBoundingClientRect();
      setAnchor({ top: r.top, left: r.left, width: r.width });
    }
    setShowTooltip(true);
  }, []);

  const scheduleHide = useCallback(() => {
    hideTimer.current = setTimeout(() => setShowTooltip(false), 150);
  }, []);

  return (
    <div
      ref={ref}
      className="flex items-center cursor-pointer"
      onMouseEnter={show}
      onMouseLeave={scheduleHide}
    >
      {links.map((link, i) => {
        const isLast = i === links.length - 1;
        const iconEl = link.dynamicIcon ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={link.icon} alt={link.label} className="w-[14px] h-[14px] shrink-0" />
        ) : (
          <Image src={link.icon} alt={link.label} width={Math.min(link.iconW, 15)} height={Math.min(link.iconH, 15)} className="shrink-0" />
        );

        return (
          <div
            key={link.key}
            className="flex items-center justify-center w-5 h-5 rounded-full bg-white relative"
            style={{ zIndex: links.length - i, marginLeft: i === 0 ? 0 : -4 }}
          >
            {iconEl}
          </div>
        );
      })}

      {showTooltip && mounted && (
        <LinksTooltip links={links} anchor={anchor} onEnter={show} onLeave={scheduleHide} />
      )}
    </div>
  );
}
