'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Feature } from '@/lib/types';
import Image from 'next/image';

interface LinkDef {
  key: string;
  label: string;
  icon: string;
  /** If true, icon is a dynamic URL (QR code) — use <img> instead of next/image */
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
    links.push({ key: 'android-pkg', label: 'Android Package', icon: feature.packageQrUrl, dynamicIcon: true, iconW: 20, iconH: 20, color: '#A3E635', onClick: () => onPackageClick?.(false) });
  if (feature.iosPackageQrUrl)
    links.push({ key: 'ios-pkg', label: 'iOS Package', icon: feature.iosPackageQrUrl, dynamicIcon: true, iconW: 20, iconH: 20, color: '#94A3B8', onClick: () => onPackageClick?.(true) });
  if (feature.abReportUrl)
    links.push({ key: 'ab', label: 'AB Report', icon: '/ab.png', iconW: 14, iconH: 14, color: '#F59E0B', url: feature.abReportUrl });
  return links;
}

const ICON_SIZE = 24;
const OVERLAP   = 5;
const SLOT_W    = ICON_SIZE - OVERLAP;

interface BubbleProps {
  link: LinkDef;
  anchor: { top: number; left: number; width: number };
  onEnter: () => void;
  onLeave: () => void;
}

function Bubble({ link, anchor, onEnter, onLeave }: BubbleProps) {
  const inner = (
    <span className="text-[11px] font-semibold whitespace-nowrap" style={{ color: link.color }}>
      {link.label}
    </span>
  );

  const cls = "fixed flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#1a1d32] border border-[#2e3460] shadow-xl cursor-pointer hover:brightness-125 transition-colors";
  const style = {
    top:       anchor.top - 6,
    left:      anchor.left + anchor.width / 2,
    transform: 'translate(-50%, -100%)',
    zIndex:    9999,
  };

  const el = link.url ? (
    <a href={link.url} target="_blank" rel="noreferrer" className={cls} style={style}
      onMouseEnter={onEnter} onMouseLeave={onLeave}>
      {inner}
      <div className="absolute top-full left-1/2 -translate-x-1/2 border-l-[5px] border-r-[5px] border-t-[5px] border-l-transparent border-r-transparent border-t-[#2e3460]" />
    </a>
  ) : (
    <button className={cls} style={style}
      onMouseEnter={onEnter} onMouseLeave={onLeave} onClick={link.onClick}>
      {inner}
      <div className="absolute top-full left-1/2 -translate-x-1/2 border-l-[5px] border-r-[5px] border-t-[5px] border-l-transparent border-r-transparent border-t-[#2e3460]" />
    </button>
  );

  return createPortal(el, document.body);
}

function LinkChip({ link, index, total, ringColor }: { link: LinkDef; index: number; total: number; ringColor: string }) {
  const [showBubble, setShowBubble] = useState(false);
  const [anchor, setAnchor] = useState({ top: 0, left: 0, width: 0 });
  const [mounted, setMounted] = useState(false);
  const ref = useRef<HTMLElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(null);
  const isLast = index === total - 1;

  useEffect(() => { setMounted(true); }, []);

  const show = useCallback(() => {
    if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; }
    if (ref.current) {
      const r = ref.current.getBoundingClientRect();
      setAnchor({ top: r.top, left: r.left, width: r.width });
    }
    setShowBubble(true);
  }, []);

  const scheduleHide = useCallback(() => {
    hideTimer.current = setTimeout(() => setShowBubble(false), 100);
  }, []);

  const iconEl = link.dynamicIcon ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={link.icon} alt={link.label} className="w-[18px] h-[18px] rounded-sm shrink-0" />
  ) : (
    <Image src={link.icon} alt={link.label} width={Math.min(link.iconW, 15)} height={Math.min(link.iconH, 15)} className="shrink-0" />
  );

  const chipCls = "flex items-center justify-center w-6 h-6 rounded-full bg-[#1a1d32] cursor-pointer hover:brightness-125 relative";
  const chipStyle = {
    outline: `2px solid ${ringColor}`,
    outlineOffset: '-1px',
    zIndex: showBubble ? 30 : total - index,
  };

  const chip = link.url ? (
    <a ref={ref as React.Ref<HTMLAnchorElement>} href={link.url} target="_blank" rel="noreferrer"
      className={chipCls} style={chipStyle} onMouseEnter={show} onMouseLeave={scheduleHide}>
      {iconEl}
    </a>
  ) : (
    <button ref={ref as React.Ref<HTMLButtonElement>}
      className={chipCls} style={chipStyle} onMouseEnter={show} onMouseLeave={scheduleHide} onClick={link.onClick}>
      {iconEl}
    </button>
  );

  return (
    <div className="shrink-0" style={{ width: isLast ? ICON_SIZE : SLOT_W }}>
      {chip}
      {showBubble && mounted && (
        <Bubble link={link} anchor={anchor} onEnter={show} onLeave={scheduleHide} />
      )}
    </div>
  );
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

  return (
    <div className="flex items-center">
      {links.map((link, i) => (
        <LinkChip key={link.key} link={link} index={i} total={links.length} ringColor={ringColor} />
      ))}
    </div>
  );
}
