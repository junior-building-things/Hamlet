'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Feature } from '@/lib/types';
import Image from 'next/image';
import { Pencil } from 'lucide-react';

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
    links.push({ key: 'android-pkg', label: 'Android Package', icon: feature.packageQrUrl, dynamicIcon: true, iconW: 20, iconH: 20, color: 'var(--foreground)', onClick: () => onPackageClick?.(false) });
  if (feature.iosPackageQrUrl)
    links.push({ key: 'ios-pkg', label: 'iOS Package', icon: feature.iosPackageQrUrl, dynamicIcon: true, iconW: 20, iconH: 20, color: 'var(--foreground)', onClick: () => onPackageClick?.(true) });
  if (feature.libraUrl)
    links.push({ key: 'libra', label: 'Libra', icon: '/libra.png', iconW: 14, iconH: 14, color: '#0073F0', url: feature.libraUrl });
  if (feature.abReportUrl)
    links.push({ key: 'ab', label: 'AB Report', icon: '/abreport.png', iconW: 14, iconH: 14, color: '#108453', url: feature.abReportUrl });
  return links;
}

// ─── Per-icon tooltip bubble ────────────────────────────────────────────────

function Bubble({ link, anchor, onEnter, onLeave, onLinkUpdate }: {
  link: LinkDef;
  anchor: { top: number; left: number; width: number };
  onEnter: () => void;
  onLeave: () => void;
  onLinkUpdate?: (linkKey: string, newUrl: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(link.url ?? '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.setSelectionRange(draft.length, draft.length);
    }
  }, [editing, draft.length]);

  function commit() {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== link.url && onLinkUpdate) {
      onLinkUpdate(link.key, trimmed);
    } else {
      setDraft(link.url ?? '');
    }
  }

  const baseCls = "fixed flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[var(--background)] border border-[var(--border)] shadow-xl transition-colors";
  const style = {
    top: anchor.top - 6,
    left: anchor.left + anchor.width / 2,
    transform: 'translate(-50%, -100%)',
    zIndex: 9999,
    ...(editing ? { minWidth: 300 } : {}),
  };

  const arrow = (
    <div className="absolute top-full left-1/2 -translate-x-1/2 border-l-[5px] border-r-[5px] border-t-[5px] border-l-transparent border-r-transparent border-t-[var(--background)]" />
  );

  if (editing) {
    const el = (
      <div className={baseCls} style={style} onMouseEnter={onEnter} onMouseLeave={onLeave}>
        <input
          ref={inputRef}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            if (e.key === 'Escape') { setDraft(link.url ?? ''); setEditing(false); }
          }}
          className="flex-1 text-[11px] bg-transparent border-none outline-none text-[var(--foreground)] min-w-0"
          placeholder="Paste URL…"
        />
        {arrow}
      </div>
    );
    return createPortal(el, document.body);
  }

  const inner = (
    <>
      <span className="text-[11px] font-semibold whitespace-nowrap" style={{ color: link.color }}>
        {link.label}
      </span>
      {onLinkUpdate && link.url && (
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setEditing(true); }}
          className="text-[var(--muted)] hover:text-[var(--foreground)] transition-colors ml-0.5"
          title="Edit link"
        >
          <Pencil className="w-2.5 h-2.5" />
        </button>
      )}
    </>
  );

  const cls = `${baseCls} cursor-pointer hover:brightness-125`;

  const el = link.url ? (
    <a href={link.url} target="_blank" rel="noreferrer" className={cls} style={style}
      onMouseEnter={onEnter} onMouseLeave={onLeave}>
      {inner}
      {arrow}
    </a>
  ) : (
    <button className={cls} style={style}
      onMouseEnter={onEnter} onMouseLeave={onLeave} onClick={link.onClick}>
      {inner}
      {arrow}
    </button>
  );

  return createPortal(el, document.body);
}

// ─── Single stacked icon chip with its own hover tooltip ────────────────────

function LinkChip({ link, index, total, onLinkUpdate }: {
  link: LinkDef; index: number; total: number;
  onLinkUpdate?: (linkKey: string, newUrl: string) => void;
}) {
  const [showBubble, setShowBubble] = useState(false);
  const [anchor, setAnchor] = useState({ top: 0, left: 0, width: 0 });
  const [mounted, setMounted] = useState(false);
  const ref = useRef<HTMLElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(null);

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
    <img src={link.icon} alt={link.label} className="w-[14px] h-[14px] shrink-0" />
  ) : (
    <Image src={link.icon} alt={link.label} width={Math.min(link.iconW, 15)} height={Math.min(link.iconH, 15)} className="shrink-0" />
  );

  const chip = link.url ? (
    <a ref={ref as React.Ref<HTMLAnchorElement>} href={link.url} target="_blank" rel="noreferrer"
      className="flex items-center justify-center w-5 h-5 rounded-full bg-[var(--link-circle)] cursor-pointer hover:brightness-125 relative"
      style={{ zIndex: showBubble ? 30 : total - index, marginLeft: index === 0 ? 0 : -4 }}
      onMouseEnter={show} onMouseLeave={scheduleHide}>
      {iconEl}
    </a>
  ) : (
    <button ref={ref as React.Ref<HTMLButtonElement>}
      className="flex items-center justify-center w-5 h-5 rounded-full bg-[var(--link-circle)] cursor-pointer hover:brightness-125 relative"
      style={{ zIndex: showBubble ? 30 : total - index, marginLeft: index === 0 ? 0 : -4 }}
      onMouseEnter={show} onMouseLeave={scheduleHide} onClick={link.onClick}>
      {iconEl}
    </button>
  );

  return (
    <>
      {chip}
      {showBubble && mounted && (
        <Bubble link={link} anchor={anchor} onEnter={show} onLeave={scheduleHide} onLinkUpdate={onLinkUpdate} />
      )}
    </>
  );
}

// ─── Public component ────────────────────────────────────────────────────────

interface Props {
  feature: Feature;
  ringColor?: string;
  onPackageClick?: (ios: boolean) => void;
  onLinkUpdate?: (linkKey: string, newUrl: string) => void;
}

export function LinkIcons({ feature, onPackageClick, onLinkUpdate }: Props) {
  const links = buildLinks(feature, onPackageClick);
  if (links.length === 0) return <span className="text-gray-600 text-xs">—</span>;

  return (
    <div className="flex items-center">
      {links.map((link, i) => (
        <LinkChip key={link.key} link={link} index={i} total={links.length} onLinkUpdate={onLinkUpdate} />
      ))}
    </div>
  );
}
