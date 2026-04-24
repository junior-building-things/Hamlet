'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Feature } from '@/lib/types';
import Image from 'next/image';
import { Pencil, Copy, Check } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface LinkDef {
  key: string;
  label: string;
  icon: string;
  dynamicIcon?: boolean;
  lucideIcon?: LucideIcon;
  iconW: number;
  iconH: number;
  color: string;
  url?: string;
  onClick?: () => void;
  /** Optional sub-actions shown inside the hover tooltip (replaces default label+copy). */
  subActions?: Array<{ label: string; onClick: () => void }>;
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
  if (feature.packageQrUrl || feature.iosPackageQrUrl) {
    const hasAndroid = !!feature.packageQrUrl;
    const hasIos = !!feature.iosPackageQrUrl;
    const subActions = [
      ...(hasAndroid ? [{ label: 'Android', onClick: () => onPackageClick?.(false) }] : []),
      ...(hasIos     ? [{ label: 'iOS',     onClick: () => onPackageClick?.(true)  }] : []),
    ];
    links.push({
      key: 'package',
      label: 'Package',
      icon: '/qr.svg',
      iconW: 14,
      iconH: 14,
      color: 'var(--foreground)',
      // Default click opens the modal on whichever tab exists first.
      onClick: () => onPackageClick?.(hasAndroid ? false : true),
      subActions,
    });
  }
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
  const [copied, setCopied] = useState(false);
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

  async function handleCopy(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!link.url) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch { /* ignore */ }
  }

  // Match POC avatar tooltip style: rounded-xl, shadow-2xl, py-2 px-3
  const baseCls = "fixed flex items-center gap-2 py-2 px-3 rounded-xl bg-[var(--card)] border border-[var(--border)] shadow-2xl";
  const style = {
    top: anchor.top - 8,
    left: anchor.left + anchor.width / 2,
    transform: 'translate(-50%, -100%)',
    zIndex: 9999,
    ...(editing ? { minWidth: 360 } : {}),
  };

  const arrow = (
    <div className="absolute top-full left-1/2 -translate-x-1/2 border-l-[5px] border-r-[5px] border-t-[5px] border-l-transparent border-r-transparent border-t-[var(--card)]" />
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
          className="flex-1 text-xs bg-transparent border-none outline-none text-[var(--foreground)] min-w-0"
          placeholder="Paste URL…"
        />
        {arrow}
      </div>
    );
    return createPortal(el, document.body);
  }

  const inner = link.subActions && link.subActions.length > 0 ? (
    <div className="flex items-center gap-1">
      {link.subActions.map(sa => (
        <button
          key={sa.label}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); sa.onClick(); }}
          className="text-xs font-medium text-[var(--foreground)] whitespace-nowrap px-2 py-0.5 rounded-md hover:bg-[var(--card-hover)] transition-colors"
        >
          {sa.label}
        </button>
      ))}
    </div>
  ) : (
    <>
      <span className="text-xs font-medium text-[var(--foreground)] whitespace-nowrap">
        {link.label}
      </span>
      {link.url && (
        <button
          onClick={handleCopy}
          className="text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
          title={copied ? 'Copied!' : 'Copy link'}
        >
          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
        </button>
      )}
      {onLinkUpdate && link.url && (
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setEditing(true); }}
          className="text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
          title="Edit link"
        >
          <Pencil className="w-3 h-3" />
        </button>
      )}
    </>
  );

  const cls = `${baseCls} cursor-pointer hover:bg-[var(--card-hover)] transition-colors`;

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

  const iconEl = link.lucideIcon ? (
    <link.lucideIcon className="w-[12px] h-[12px] shrink-0" style={{ color: link.color }} />
  ) : link.dynamicIcon ? (
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
