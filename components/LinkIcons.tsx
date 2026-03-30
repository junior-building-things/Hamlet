'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink } from 'lucide-react';
import { Feature } from '@/lib/types';
import Image from 'next/image';

interface LinkDef {
  key: string;
  label: string;
  icon: string;
  /** Icon width — most are 14, Figma is narrower, Meego slightly bigger */
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

// ─── Hover tooltip (portal) ──────────────────────────────────────────────────

interface TooltipPos { top: number; left: number }

function LinkTooltip({ links, pos, mounted }: { links: LinkDef[]; pos: TooltipPos; mounted: boolean }) {
  if (!mounted) return null;
  return createPortal(
    <div
      className="fixed bg-[#0e1120] border border-[#1e2240] rounded-xl shadow-2xl py-2 px-2 min-w-[130px] z-[9999]"
      style={{
        top:       pos.top - 8,
        left:      pos.left,
        transform: 'translateX(-50%) translateY(-100%)',
        pointerEvents: 'auto',
      }}
    >
      {/* Arrow */}
      <div
        className="absolute top-full left-1/2 -translate-x-1/2
                   border-l-[5px] border-r-[5px] border-t-[5px]
                   border-l-transparent border-r-transparent border-t-[#1e2240]"
      />
      <div className="flex flex-col gap-0.5">
        {links.map(link => (
          <a
            key={link.key}
            href={link.url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[#1e2240] transition-colors group"
          >
            <Image src={link.icon} alt="" width={link.iconW} height={link.iconH} className="shrink-0" />
            <span className="text-xs font-medium flex-1" style={{ color: link.color }}>
              {link.label}
            </span>
            <ExternalLink className="w-3 h-3 text-gray-500 group-hover:text-gray-300 transition-colors shrink-0" />
          </a>
        ))}
      </div>
    </div>,
    document.body,
  );
}

// ─── Single icon circle ──────────────────────────────────────────────────────

function LinkIcon({ link, ringColor, offset }: { link: LinkDef; ringColor: string; offset: number }) {
  const [open, setOpen]     = useState(false);
  const [pos, setPos]       = useState<TooltipPos>({ top: 0, left: 0 });
  const [mounted, setMounted] = useState(false);
  const ref = useRef<HTMLAnchorElement>(null);

  useEffect(() => { setMounted(true); }, []);

  const onEnter = useCallback(() => {
    if (ref.current) {
      const r = ref.current.getBoundingClientRect();
      setPos({ top: r.top, left: r.left + r.width / 2 });
    }
    setOpen(true);
  }, []);
  const onLeave = useCallback(() => setOpen(false), []);

  return (
    <a
      ref={ref}
      href={link.url}
      target="_blank"
      rel="noreferrer"
      className="w-6 h-6 rounded-full bg-[#1a1d32] flex items-center justify-center cursor-pointer hover:brightness-125 transition-all"
      style={{
        marginLeft: offset === 0 ? 0 : '-5px',
        zIndex: 10 - offset,
        outline: `2px solid ${ringColor}`,
        outlineOffset: '-1px',
      }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <Image src={link.icon} alt={link.label} width={Math.min(link.iconW, 13)} height={Math.min(link.iconH, 13)} className="shrink-0" />
      {open && <LinkTooltip links={[link]} pos={pos} mounted={mounted} />}
    </a>
  );
}

// ─── Overflow "+N" bubble ────────────────────────────────────────────────────

function OverflowBubble({ links, ringColor }: { links: LinkDef[]; ringColor: string }) {
  const [open, setOpen]     = useState(false);
  const [pos, setPos]       = useState<TooltipPos>({ top: 0, left: 0 });
  const [mounted, setMounted] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { setMounted(true); }, []);

  const onEnter = useCallback(() => {
    if (ref.current) {
      const r = ref.current.getBoundingClientRect();
      setPos({ top: r.top, left: r.left + r.width / 2 });
    }
    setOpen(true);
  }, []);
  const onLeave = useCallback(() => setOpen(false), []);

  return (
    <div
      ref={ref}
      className="w-6 h-6 rounded-full bg-[#1e2240] flex items-center justify-center text-[9px] font-semibold text-gray-300 cursor-default select-none"
      style={{
        marginLeft: '-5px',
        zIndex: 1,
        outline: `2px solid ${ringColor}`,
        outlineOffset: '-1px',
      }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      +{links.length}
      {open && <LinkTooltip links={links} pos={pos} mounted={mounted} />}
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

  const shown = links.slice(0, 3);
  const rest  = links.slice(3);

  return (
    <div className="flex items-center">
      {shown.map((link, i) => (
        <LinkIcon key={link.key} link={link} ringColor={ringColor} offset={i} />
      ))}
      {rest.length > 0 && (
        <OverflowBubble links={rest} ringColor={ringColor} />
      )}
    </div>
  );
}
