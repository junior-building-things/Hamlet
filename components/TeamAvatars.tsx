'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Feature } from '@/lib/types';
import { AV } from '@/lib/avatars';
import { UserAvatar } from './AvatarSelect';

// Role order: exclude PM + TPM; show in this specific order, deduped
const ROLE_ORDER: Array<{ key: keyof Feature; label: string }> = [
  { key: 'techOwner',       label: 'Tech Owner' },
  { key: 'serverOwner',     label: 'Server' },
  { key: 'androidOwner',    label: 'Android' },
  { key: 'iosOwner',        label: 'iOS' },
  { key: 'qaOwner',         label: 'QA' },
  { key: 'uiuxOwner',       label: 'UX Designer' },
  { key: 'contentDesigner', label: 'Content Designer' },
  { key: 'daOwner',         label: 'DS' },
];

interface Poc { name: string; role: string; url?: string }

function buildPocs(feature: Feature): Poc[] {
  const seen = new Set<string>();
  const pocs: Poc[] = [];
  for (const { key, label } of ROLE_ORDER) {
    const val = feature[key] as string | undefined;
    if (!val) continue;
    for (const raw of val.split(',')) {
      const name = raw.trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      pocs.push({ name, role: label, url: AV[name] });
    }
  }
  return pocs;
}

// ─── Portal tooltip shared by every avatar/bubble ─────────────────────────────

interface TooltipPos { top: number; left: number }

function PocTooltip({ pocs, pos, mounted }: { pocs: Poc[]; pos: TooltipPos; mounted: boolean }) {
  if (!mounted) return null;
  return createPortal(
    <div
      className="fixed bg-[#0e1120] border border-[#1e2240] rounded-xl shadow-2xl py-2 px-3 min-w-[160px] pointer-events-none"
      style={{
        top:       pos.top - 8,
        left:      pos.left,
        zIndex:    9999,
        transform: 'translateX(-50%) translateY(-100%)',
      }}
    >
      {/* Arrow pointing downward */}
      <div
        className="absolute top-full left-1/2 -translate-x-1/2
                   border-l-[5px] border-r-[5px] border-t-[5px]
                   border-l-transparent border-r-transparent border-t-[#1e2240]"
      />
      <div className="flex flex-col gap-1.5">
        {pocs.map(poc => (
          <div key={poc.name} className="flex items-center gap-2">
            <UserAvatar name={poc.name} url={poc.url} size={5} />
            <div className="min-w-0">
              <p className="text-xs text-white leading-tight truncate">{poc.name}</p>
              <p className="text-[10px] text-gray-500 leading-tight">{poc.role}</p>
            </div>
          </div>
        ))}
      </div>
    </div>,
    document.body,
  );
}

// ─── Shared hover-position hook ───────────────────────────────────────────────

function useHoverTooltip() {
  const [open,    setOpen]    = useState(false);
  const [pos,     setPos]     = useState<TooltipPos>({ top: 0, left: 0 });
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

  return { open, pos, mounted, ref, onEnter, onLeave };
}

// ─── Single avatar with hover tooltip ────────────────────────────────────────

function RingAvatar({ poc, ringColor = '#13162a' }: { poc: Poc; ringColor?: string }) {
  const { open, pos, mounted, ref, onEnter, onLeave } = useHoverTooltip();

  return (
    <div
      ref={ref}
      className="rounded-full cursor-default"
      style={{ outline: `2px solid ${ringColor}`, outlineOffset: '-1px' }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <UserAvatar name={poc.name} url={poc.url} size={6} />
      {open && <PocTooltip pocs={[poc]} pos={pos} mounted={mounted} />}
    </div>
  );
}

// ─── "+N" overflow bubble with hover tooltip ──────────────────────────────────

function OverflowBubble({ rest, ringColor = '#13162a' }: { rest: Poc[]; ringColor?: string }) {
  const { open, pos, mounted, ref, onEnter, onLeave } = useHoverTooltip();

  return (
    <div
      ref={ref}
      style={{ marginLeft: '-5px', zIndex: 1 }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <div
        className="w-6 h-6 rounded-full bg-[#1e2240] flex items-center justify-center text-[9px] font-semibold text-gray-300 cursor-default select-none"
        style={{ outline: `2px solid ${ringColor}`, outlineOffset: '-1px' }}
      >
        +{rest.length}
      </div>
      {open && <PocTooltip pocs={rest} pos={pos} mounted={mounted} />}
    </div>
  );
}

// ─── Public component ─────────────────────────────────────────────────────────

interface Props {
  feature: Feature;
  /** Background colour of the card row — used for the avatar ring/separator. */
  ringColor?: string;
}

export function TeamAvatars({ feature, ringColor = '#13162a' }: Props) {
  const pocs  = buildPocs(feature);
  if (pocs.length === 0) return <span className="text-gray-600 text-xs">—</span>;

  const shown = pocs.slice(0, 2);
  const rest  = pocs.slice(2);

  return (
    <div className="flex items-center">
      {shown.map((poc, i) => (
        <div
          key={poc.name}
          style={{ marginLeft: i === 0 ? 0 : '-5px', zIndex: shown.length - i + 2 }}
        >
          <RingAvatar poc={poc} ringColor={ringColor} />
        </div>
      ))}
      {rest.length > 0 && (
        <OverflowBubble rest={rest} ringColor={ringColor} />
      )}
    </div>
  );
}
