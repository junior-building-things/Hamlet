'use client';
import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';

// ─── Shared dropdown hook ─────────────────────────────────────────────────────

function useDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);
  return { open, setOpen, ref };
}

const triggerCls = 'w-full bg-[#13162a] border border-[#2e3460] text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-purple-500 flex items-center gap-2 min-w-0';
const listCls    = 'absolute z-20 top-full left-0 right-0 mt-1 bg-[#13162a] border border-[#2e3460] rounded-lg shadow-2xl overflow-hidden';
const itemBaseCls = 'px-3 py-2 flex items-center gap-2.5 cursor-pointer hover:bg-[#1e2240]';

// ─── UserAvatar ───────────────────────────────────────────────────────────────

export function UserAvatar({ name, url, size = 5 }: { name: string; url?: string; size?: number }) {
  const [imgFailed, setImgFailed] = useState(false);
  const initials = name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  const dim = `w-${size} h-${size}`;
  if (url && !imgFailed) {
    return <img src={url} alt={name} className={`${dim} rounded-full object-cover flex-shrink-0`} onError={() => setImgFailed(true)} />;
  }
  return (
    <div className={`${dim} rounded-full bg-purple-800 flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0`}>
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
}

export function AvatarSelect({ options, value, onChange, placeholder = '—', locked = false }: AvatarSelectProps) {
  const { open, setOpen, ref } = useDropdown();
  const selected = options.find(o => o.value === value);

  return (
    <div ref={ref} className="relative w-full">
      <button type="button" onClick={() => { if (!locked) setOpen(o => !o); }}
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
        <div className={listCls}>
          {options.map(opt => (
            <div key={opt.value}
              className={`${itemBaseCls} ${value === opt.value ? 'bg-[#1e2240]' : ''}`}
              onClick={() => { onChange(opt.value); setOpen(false); }}>
              <UserAvatar name={opt.label} url={opt.avatarUrl} size={5} />
              <span className="text-sm text-white flex-1">{opt.label}</span>
              {value === opt.value && <Check className="w-3.5 h-3.5 text-purple-400 flex-shrink-0" />}
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
}

export function CustomSelect({ options, value, onChange }: CustomSelectProps) {
  const { open, setOpen, ref } = useDropdown();
  const selected = options.find(o => o.value === value);

  return (
    <div ref={ref} className="relative w-full">
      <button type="button" onClick={() => setOpen(o => !o)} className={triggerCls}>
        <span className="flex-1 text-left truncate">{selected?.label ?? '—'}</span>
        <ChevronDown className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
      </button>

      {open && (
        <div className={listCls}>
          {options.map(opt => (
            <div key={opt.value}
              className={`${itemBaseCls} ${value === opt.value ? 'bg-[#1e2240]' : ''}`}
              onClick={() => { onChange(opt.value); setOpen(false); }}>
              <span className="text-sm text-white flex-1">{opt.label}</span>
              {value === opt.value && <Check className="w-3.5 h-3.5 text-purple-400 flex-shrink-0" />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
