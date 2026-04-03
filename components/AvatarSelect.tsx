'use client';
import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';

// ─── Shared dropdown hook ─────────────────────────────────────────────────────

/** Walk up the DOM to find the nearest scroll container's bottom edge. */
function getMaxHeight(triggerEl: Element): number {
  let el = triggerEl.parentElement;
  while (el) {
    const { overflowY } = window.getComputedStyle(el);
    if (overflowY === 'auto' || overflowY === 'scroll') {
      return el.getBoundingClientRect().bottom - triggerEl.getBoundingClientRect().bottom - 8;
    }
    el = el.parentElement;
  }
  return window.innerHeight - triggerEl.getBoundingClientRect().bottom - 8;
}

function useDropdown() {
  const [open, setOpen]       = useState(false);
  const [maxHeight, setMaxHeight] = useState(300);
  const ref = useRef<HTMLDivElement>(null);

  function openDropdown() {
    if (ref.current) {
      const trigger = ref.current.firstElementChild;
      if (trigger) setMaxHeight(Math.max(getMaxHeight(trigger), 80));
    }
    setOpen(true);
  }

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  return { open, setOpen, openDropdown, maxHeight, ref };
}

const triggerCls  = 'w-full bg-[#13162a] border border-[#2e3460] text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500 flex items-center gap-2 min-w-0';
const listDownCls = 'absolute z-20 top-full left-0 right-0 mt-1 bg-[#13162a] border border-[#2e3460] rounded-lg shadow-2xl overflow-y-auto';
const listUpCls   = 'absolute z-20 bottom-full left-0 right-0 mb-1 bg-[#13162a] border border-[#2e3460] rounded-lg shadow-2xl overflow-y-auto';
const itemBaseCls = 'px-3 py-2 flex items-center gap-2.5 cursor-pointer hover:bg-[#1e2240]';

// ─── UserAvatar ───────────────────────────────────────────────────────────────

export function UserAvatar({ name, url, size = 5 }: { name: string; url?: string; size?: number }) {
  const [imgFailed, setImgFailed] = useState(false);
  const initials = name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  const dim = `w-${size} h-${size}`;
  if (url && !imgFailed) {
    const isAgent = url.includes('_assistant.png');
    return <img src={url} alt={name} className={`${dim} rounded-full object-cover flex-shrink-0`} style={isAgent ? { objectPosition: 'center 30%' } : undefined} onError={() => setImgFailed(true)} />;
  }
  return (
    <div className={`${dim} rounded-full bg-blue-800 flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0`}>
      {initials}
    </div>
  );
}

// ─── AvatarSelect — for people fields ────────────────────────────────────────

export interface AvatarOption {
  value: string;
  label: string;
  avatarUrl?: string;
}

interface AvatarSelectProps {
  options: AvatarOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  locked?: boolean;
  dropUp?: boolean;
}

export function AvatarSelect({ options, value, onChange, placeholder = '—', locked = false, dropUp = false }: AvatarSelectProps) {
  const { open, setOpen, openDropdown, maxHeight, ref } = useDropdown();
  const selected = options.find(o => o.value === value);

  return (
    <div ref={ref} className="relative w-full">
      <button type="button" onClick={() => { if (!locked) { open ? setOpen(false) : openDropdown(); } }}
        className={triggerCls}>
        {selected ? (
          <>
            <UserAvatar name={selected.label} url={selected.avatarUrl} size={5} />
            <span className="flex-1 text-left truncate">{selected.label}</span>
          </>
        ) : (
          <span className="flex-1 text-left text-gray-500 italic">{placeholder}</span>
        )}
        {!locked && <ChevronDown className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />}
      </button>

      {open && (
        <div className={dropUp ? listUpCls : listDownCls} style={{ maxHeight }}>
          {options.map(opt => (
            <div key={opt.value}
              className={`${itemBaseCls} ${value === opt.value ? 'bg-[#1e2240]' : ''}`}
              onClick={() => { onChange(opt.value); setOpen(false); }}>
              <UserAvatar name={opt.label} url={opt.avatarUrl} size={5} />
              <span className="text-sm text-white flex-1">{opt.label}</span>
              {value === opt.value && <Check className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── CustomSelect — for non-people fields ────────────────────────────────────

interface SelectOption {
  value: string;
  label: string;
}

interface CustomSelectProps {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  allowDeselect?: boolean;
  icon?: React.ReactNode;
  className?: string;
}

export function CustomSelect({ options, value, onChange, placeholder, allowDeselect, icon, className = 'w-full' }: CustomSelectProps) {
  const { open, setOpen, openDropdown, maxHeight, ref } = useDropdown();
  const selected = options.find(o => o.value === value);

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button type="button" onClick={() => open ? setOpen(false) : openDropdown()} className={triggerCls}>
        {icon && <span className="text-gray-500 flex-shrink-0 flex items-center">{icon}</span>}
        <span className={`flex-1 text-left whitespace-nowrap ${!selected && placeholder ? 'text-gray-500' : ''}`}>
          {selected?.label ?? placeholder ?? '—'}
        </span>
        <ChevronDown className="w-3.5 h-3.5 text-gray-500 flex-shrink-0 ml-auto" />
      </button>

      {open && (
        <div className={listDownCls} style={{ maxHeight }}>
          {options.map(opt => (
            <div key={opt.value}
              className={`${itemBaseCls} ${value === opt.value ? 'bg-[#1e2240]' : ''}`}
              onClick={() => {
                onChange(allowDeselect && value === opt.value ? '' : opt.value);
                setOpen(false);
              }}>
              <span className="text-sm text-white flex-1">{opt.label}</span>
              {value === opt.value && <Check className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
