'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Check } from 'lucide-react';
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

export const AVAILABLE_AGENTS = [
  { key: 'pm-assistant', label: 'Rio', shortName: 'PM Agent', icon: '/pm_assistant.png' },
  { key: 'rd-assistant', label: 'Mia', shortName: 'RD Agent', icon: '/rd_assistant.png' },
];

interface Poc { name: string; role: string; url?: string; isAgent?: boolean }

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
      pocs.push({ name, role: label, url: feature.avatars?.[name] || AV[name] });
    }
  }
  // Append assigned agents
  for (const agentKey of feature.agents ?? []) {
    const agent = AVAILABLE_AGENTS.find(a => a.key === agentKey);
    if (agent) {
      pocs.push({ name: agent.label, role: agent.shortName, url: agent.icon, isAgent: true });
    }
  }
  return pocs;
}

// ─── Portal tooltip shared by every avatar/bubble ─────────────────────────────

interface TooltipPos { top: number; left: number }

function PocTooltip({ pocs, pos, mounted, onEnter, onLeave, onAddClick }: {
  pocs: Poc[]; pos: TooltipPos; mounted: boolean;
  onEnter?: () => void; onLeave?: () => void;
  onAddClick?: (pos: TooltipPos) => void;
}) {
  if (!mounted) return null;
  return createPortal(
    <div
      className="fixed bg-[var(--background)] border border-[var(--border)] rounded-xl shadow-2xl py-2 px-3 min-w-[160px]"
      style={{
        top:       pos.top - 8,
        left:      pos.left,
        zIndex:    9999,
        transform: 'translateX(-50%) translateY(-100%)',
      }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      {/* Arrow pointing downward */}
      <div
        className="absolute top-full left-1/2 -translate-x-1/2
                   border-l-[5px] border-r-[5px] border-t-[5px]
                   border-l-transparent border-r-transparent border-t-[var(--background)]"
      />
      <div className="flex flex-col gap-1.5">
        {pocs.map(poc => (
          <div key={poc.name} className="flex items-center gap-2">
            <UserAvatar name={poc.name} url={poc.url} size={5} />
            <div className="min-w-0">
              <p className="text-xs text-[var(--foreground)] leading-tight truncate">{poc.name}</p>
              <p className="text-[10px] text-gray-500 leading-tight">{poc.role}</p>
            </div>
          </div>
        ))}
        {onAddClick && (
          <button
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              onAddClick({ top: r.top, left: r.left + r.width / 2 });
            }}
            className="flex items-center gap-2 py-1 px-1 -mx-1 rounded-lg hover:bg-[var(--card-hover)] transition-colors cursor-pointer"
          >
            <div className="w-5 h-5 rounded-full bg-purple-500/20 flex items-center justify-center">
              <Plus className="w-3 h-3 text-purple-400" />
            </div>
            <span className="text-xs text-purple-400 font-medium">Agent</span>
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}

// ─── Agent picker portal ─────────────────────────────────────────────────────

function AgentPicker({ pos, mounted, assignedAgents, onToggle, onClose }: {
  pos: TooltipPos; mounted: boolean;
  assignedAgents: string[];
  onToggle: (agentKey: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [onClose]);

  if (!mounted) return null;
  return createPortal(
    <div
      ref={ref}
      className="fixed bg-[var(--background)] border border-[var(--border)] rounded-xl shadow-2xl py-1.5 px-1.5 min-w-[180px]"
      style={{
        top:       pos.top - 8,
        left:      pos.left,
        zIndex:    10000,
        transform: 'translateX(-50%) translateY(-100%)',
      }}
    >
      <div
        className="absolute top-full left-1/2 -translate-x-1/2
                   border-l-[5px] border-r-[5px] border-t-[5px]
                   border-l-transparent border-r-transparent border-t-[var(--background)]"
      />
      {AVAILABLE_AGENTS.map(agent => {
        const assigned = assignedAgents.includes(agent.key);
        return (
          <button
            key={agent.key}
            onClick={() => onToggle(agent.key)}
            className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-[var(--card-hover)] transition-colors cursor-pointer"
          >
            <img src={agent.icon} alt="" className="w-6 h-6 object-contain shrink-0" />
            <div className="flex-1 text-left min-w-0">
              <p className="text-xs text-[var(--foreground)] leading-tight">{agent.label}</p>
              <p className="text-[10px] text-gray-500 leading-tight">{agent.shortName}</p>
            </div>
            {assigned && <Check className="w-3.5 h-3.5 text-purple-400 shrink-0" />}
          </button>
        );
      })}
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
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => { setMounted(true); }, []);

  const onEnter = useCallback(() => {
    if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; }
    if (ref.current) {
      const r = ref.current.getBoundingClientRect();
      setPos({ top: r.top, left: r.left + r.width / 2 });
    }
    setOpen(true);
  }, []);

  const onLeave = useCallback(() => {
    hideTimer.current = setTimeout(() => setOpen(false), 150);
  }, []);

  return { open, setOpen, pos, mounted, ref, onEnter, onLeave };
}

// ─── Single avatar with hover tooltip ────────────────────────────────────────

function RingAvatar({ poc, ringColor }: { poc: Poc; ringColor?: string }) {
  const { open, pos, mounted, ref, onEnter, onLeave } = useHoverTooltip();

  return (
    <div
      ref={ref}
      className="rounded-full cursor-default"
      style={{ outline: `2px solid ${ringColor || 'var(--card)'}`, outlineOffset: '-1px' }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <UserAvatar name={poc.name} url={poc.url} size={6} />
      {open && <PocTooltip pocs={[poc]} pos={pos} mounted={mounted} onEnter={onEnter} onLeave={onLeave} />}
    </div>
  );
}

// ─── "+N" overflow bubble with hover tooltip ──────────────────────────────────

function OverflowBubble({ rest, ringColor, onAddClick }: {
  rest: Poc[]; ringColor?: string; onAddClick?: (pos: TooltipPos) => void;
}) {
  const { open, pos, mounted, ref, onEnter, onLeave } = useHoverTooltip();

  return (
    <div
      ref={ref}
      style={{ marginLeft: '-5px', zIndex: 1 }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <div
        className="w-6 h-6 rounded-full bg-[var(--card-hover)] flex items-center justify-center text-[9px] font-semibold text-[var(--muted)] cursor-default select-none"
        style={{ outline: `2px solid ${ringColor || 'var(--card)'}`, outlineOffset: '-1px' }}
      >
        +{rest.length}
      </div>
      {open && <PocTooltip pocs={rest} pos={pos} mounted={mounted} onEnter={onEnter} onLeave={onLeave} onAddClick={onAddClick} />}
    </div>
  );
}

// ─── "+" add agent circle ────────────────────────────────────────────────────

function AddAgentCircle({ ringColor, onClick }: { ringColor?: string; onClick: () => void }) {
  return (
    <div style={{ marginLeft: '-5px', zIndex: 0 }}>
      <button
        onClick={onClick}
        className="w-6 h-6 rounded-full bg-[var(--card-hover)] flex items-center justify-center cursor-pointer hover:bg-[#252a4a] transition-colors"
        style={{ outline: `2px solid ${ringColor || 'var(--card)'}`, outlineOffset: '-1px' }}
      >
        <Plus className="w-3 h-3 text-gray-400" />
      </button>
    </div>
  );
}

// ─── Public component ─────────────────────────────────────────────────────────

interface Props {
  feature: Feature;
  ringColor?: string;
  onToggleAgent?: (featureId: string, agentKey: string) => void;
}

export function TeamAvatars({ feature, ringColor, onToggleAgent }: Props) {
  const [showPicker, setShowPicker] = useState(false);
  const [pickerPos, setPickerPos]   = useState<TooltipPos>({ top: 0, left: 0 });
  const [mounted, setMounted]       = useState(false);
  const addRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setMounted(true); }, []);

  const pocs  = buildPocs(feature);
  if (pocs.length === 0 && !onToggleAgent) return <span className="text-gray-600 text-xs">—</span>;

  const shown = pocs.slice(0, 2);
  const rest  = pocs.slice(2);

  function openPicker(fromPos?: TooltipPos) {
    if (fromPos) {
      setPickerPos(fromPos);
    } else if (addRef.current) {
      const r = addRef.current.getBoundingClientRect();
      setPickerPos({ top: r.top, left: r.left + r.width / 2 });
    }
    setShowPicker(true);
  }

  function handleToggle(agentKey: string) {
    onToggleAgent?.(feature.id, agentKey);
  }

  return (
    <div ref={addRef} className="flex items-center">
      {shown.map((poc, i) => (
        <div
          key={poc.name}
          style={{ marginLeft: i === 0 ? 0 : '-5px', zIndex: shown.length - i + 2 }}
        >
          <RingAvatar poc={poc} ringColor={ringColor} />
        </div>
      ))}
      {rest.length > 0 ? (
        <OverflowBubble rest={rest} ringColor={ringColor} onAddClick={onToggleAgent ? openPicker : undefined} />
      ) : onToggleAgent ? (
        <AddAgentCircle ringColor={ringColor} onClick={openPicker} />
      ) : null}
      {showPicker && mounted && (
        <AgentPicker
          pos={pickerPos}
          mounted={mounted}
          assignedAgents={feature.agents ?? []}
          onToggle={handleToggle}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  );
}
