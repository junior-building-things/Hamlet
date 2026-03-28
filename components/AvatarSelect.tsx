'use client';
import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';

export interface AvatarOption {
  value: string;
  label: string;
  avatarUrl?: string;
}

interface Props {
  options: AvatarOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** If true, no "—" blank option is shown and value can't be cleared */
  locked?: boolean;
}

export function UserAvatar({ name, url, size = 5 }: { name: string; url?: string; size?: number }) {
  const [imgFailed, setImgFailed] = useState(false);
  const initials = name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  const dim = `w-${size} h-${size}`;

  if (url && !imgFailed) {
    return (
      <img
        src={url}
        alt={name}
        className={`${dim} rounded-full object-cover flex-shrink-0`}
        onError={() => setImgFailed(true)}
      />
    );
  }
  return (
    <div className={`${dim} rounded-full bg-purple-800 flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0`}>
      {initials}
    </div>
  );
}

export function AvatarSelect({ options, value, onChange, placeholder = '—', locked = false }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const selected = options.find(o => o.value === value);

  return (
    <div ref={ref} className="relative w-full">
      <button
        type="button"
        onClick={() => { if (!locked || options.length > 1) setOpen(o => !o); }}
        className="w-full bg-[#13162a] border border-[#2e3460] text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-purple-500 flex items-center gap-2 min-w-0"
      >
        {selected ? (
          <>
            <UserAvatar name={selected.label} url={selected.avatarUrl} size={5} />
            <span className="flex-1 text-left truncate">{selected.label}</span>
          </>
        ) : (
          <span className="flex-1 text-left text-gray-600">{placeholder}</span>
        )}
        {(!locked || options.length > 1) && (
          <ChevronDown className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
        )}
      </button>

      {open && (
        <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-[#13162a] border border-[#2e3460] rounded-lg shadow-2xl overflow-hidden">
          {!locked && (
            <div
              className="px-3 py-2 text-sm text-gray-600 italic hover:bg-[#1e2240] cursor-pointer"
              onClick={() => { onChange(''); setOpen(false); }}
            >
              {placeholder}
            </div>
          )}
          {options.map(opt => (
            <div
              key={opt.value}
              className={`px-3 py-2 flex items-center gap-2.5 cursor-pointer hover:bg-[#1e2240] ${value === opt.value ? 'bg-[#1e2240]' : ''}`}
              onClick={() => { onChange(opt.value); setOpen(false); }}
            >
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
