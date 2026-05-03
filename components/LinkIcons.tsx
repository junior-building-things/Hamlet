'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Feature } from '@/lib/types';
import Image from 'next/image';
import { Pencil, Copy, Check, Plus } from 'lucide-react';
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
  invertInDark?: boolean;
}

// Hook to track current theme (light/dark) from document.documentElement.
function useTheme(): 'light' | 'dark' {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  useEffect(() => {
    const update = () => {
      const t = document.documentElement.getAttribute('data-theme');
      setTheme(t === 'dark' ? 'dark' : 'light');
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  return theme;
}

function buildLinks(feature: Feature, onPackageClick?: (ios: boolean) => void, theme: 'light' | 'dark' = 'light'): LinkDef[] {
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
    links.push({
      key: 'package',
      label: 'Packages',
      icon: '/qr.svg',
      iconW: 14,
      iconH: 14,
      color: 'var(--foreground)',
      invertInDark: true,
      onClick: () => onPackageClick?.(hasAndroid ? false : true),
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

  const inner = (
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
  const theme = useTheme();
  const invertStyle = link.invertInDark && theme === 'dark' ? { filter: 'invert(1)' } : undefined;

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
    <img src={link.icon} alt={link.label} className="w-[14px] h-[14px] shrink-0" style={invertStyle} />
  ) : (
    <Image src={link.icon} alt={link.label} width={Math.min(link.iconW, 15)} height={Math.min(link.iconH, 15)} className="shrink-0" style={invertStyle} />
  );

  // Design spec: 22×22 rounded-square tiles, 1.5px bg-elev-1 border with
  // an outer 0.5px hairline shadow (so neighbouring tiles don't blur into
  // each other), -7px overlap (about a third per icon, like the team
  // avatars), and a hover lift. Matches `.link-icon` from the redesign CSS.
  const tileCls =
    'inline-flex items-center justify-center w-[22px] h-[22px] rounded-[6px] bg-[var(--bg-elev-1)] cursor-pointer relative transition-transform duration-150 hover:-translate-y-[2px]';
  const tileStyle: React.CSSProperties = {
    zIndex: showBubble ? 30 : total - index,
    marginLeft: index === 0 ? 0 : -7,
    border: '1.5px solid var(--bg-elev-1)',
    boxShadow: '0 0 0 0.5px var(--hairline)',
  };

  const chip = link.url ? (
    <a ref={ref as React.Ref<HTMLAnchorElement>} href={link.url} target="_blank" rel="noreferrer"
      className={tileCls} style={tileStyle}
      onMouseEnter={show} onMouseLeave={scheduleHide}>
      {iconEl}
    </a>
  ) : (
    <button ref={ref as React.Ref<HTMLButtonElement>}
      className={tileCls} style={tileStyle}
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

// ─── Add-link button (shown after icons when figma/libra/ab is missing) ─────

const ADDABLE_LINKS: Array<{ key: string; label: string; color: string; icon: string; iconW: number; iconH: number }> = [
  { key: 'figma', label: 'Figma', color: '#FF7362', icon: '/figma.svg', iconW: 10, iconH: 14 },
  { key: 'libra', label: 'Libra', color: '#0073F0', icon: '/libra.png', iconW: 14, iconH: 14 },
  { key: 'ab', label: 'AB Report', color: '#108453', icon: '/abreport.png', iconW: 14, iconH: 14 },
];

function AddLinkButton({ feature, onLinkUpdate }: {
  feature: Feature;
  onLinkUpdate: (linkKey: string, newUrl: string) => void;
}) {
  const [showMenu, setShowMenu] = useState(false);
  const [pickedKey, setPickedKey] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [anchor, setAnchor] = useState({ top: 0, left: 0, width: 0 });
  const [mounted, setMounted] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setMounted(true); }, []);

  // Filter to only links the feature is missing
  const missingLinks = ADDABLE_LINKS.filter(l => {
    if (l.key === 'figma') return !feature.figmaUrl;
    if (l.key === 'libra') return !feature.libraUrl;
    if (l.key === 'ab') return !feature.abReportUrl;
    return false;
  });

  useEffect(() => {
    if (pickedKey && inputRef.current) inputRef.current.focus();
  }, [pickedKey]);

  // Click-outside to close — robust against re-renders, search filter changes,
  // and other hover/mouseleave timing issues.
  useEffect(() => {
    if (!showMenu) return;
    function handleDocClick(e: MouseEvent) {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || ref.current?.contains(target)) return;
      setShowMenu(false);
      setPickedKey(null);
      setDraft('');
    }
    document.addEventListener('mousedown', handleDocClick);
    return () => document.removeEventListener('mousedown', handleDocClick);
  }, [showMenu]);

  if (missingLinks.length === 0) return null;

  function toggle() {
    if (showMenu) {
      setShowMenu(false);
      setPickedKey(null);
      setDraft('');
      return;
    }
    if (ref.current) {
      const r = ref.current.getBoundingClientRect();
      setAnchor({ top: r.top, left: r.left, width: r.width });
    }
    setShowMenu(true);
  }
  function commit() {
    const trimmed = draft.trim();
    if (trimmed && pickedKey) onLinkUpdate(pickedKey, trimmed);
    setShowMenu(false);
    setPickedKey(null);
    setDraft('');
  }

  return (
    <>
      <button
        ref={ref}
        onClick={toggle}
        className="inline-flex items-center justify-center w-[22px] h-[22px] rounded-[6px] bg-transparent text-[var(--text-dim)] hover:text-[var(--text)] cursor-pointer relative transition-transform duration-150 hover:-translate-y-[2px]"
        style={{
          zIndex: 0,
          marginLeft: -7,
          border: '1.5px dashed var(--hairline-strong)',
        }}
        title="Add link"
      >
        <Plus className="w-3 h-3" />
      </button>
      {showMenu && mounted && createPortal(
        <div
          ref={menuRef}
          className="fixed bg-[var(--card)] border border-[var(--border)] rounded-xl shadow-2xl py-2 px-2 min-w-[140px]"
          style={{
            top: anchor.top - 8,
            left: anchor.left + anchor.width / 2,
            transform: 'translate(-50%, -100%)',
            zIndex: 9999,
          }}
        >
          {pickedKey ? (
            <input
              ref={inputRef}
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); commit(); }
                if (e.key === 'Escape') { setPickedKey(null); setDraft(''); }
              }}
              className="w-[280px] text-xs bg-transparent border-none outline-none text-[var(--foreground)] px-1.5 py-1"
              placeholder="Paste URL…"
            />
          ) : (
            <div className="flex flex-col gap-0.5">
              {missingLinks.map(l => (
                <button
                  key={l.key}
                  onClick={() => setPickedKey(l.key)}
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium text-[var(--foreground)] hover:bg-[var(--card-hover)] transition-colors"
                >
                  <Image src={l.icon} alt="" width={l.iconW} height={l.iconH} className="shrink-0" />
                  <span>{l.label}</span>
                </button>
              ))}
            </div>
          )}
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-l-[5px] border-r-[5px] border-t-[5px] border-l-transparent border-r-transparent border-t-[var(--card)]" />
        </div>,
        document.body,
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
  const theme = useTheme();
  const links = buildLinks(feature, onPackageClick, theme);
  if (links.length === 0 && !onLinkUpdate) return <span className="text-gray-600 text-xs">—</span>;

  return (
    <div className="flex items-center">
      {links.map((link, i) => (
        <LinkChip key={link.key} link={link} index={i} total={links.length} onLinkUpdate={onLinkUpdate} />
      ))}
      {onLinkUpdate && <AddLinkButton feature={feature} onLinkUpdate={onLinkUpdate} />}
    </div>
  );
}
