'use client';

/** Small on/off switch with an inline label, matching the modal's form styling. */
export function Switch({ checked, onChange, label, disabled }: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2 w-fit py-1 text-[12.5px] text-[var(--text)] disabled:opacity-50"
    >
      <span className={`relative inline-flex w-8 h-[18px] shrink-0 rounded-full transition-colors ${checked ? 'bg-[var(--ai)]' : 'bg-[var(--hairline)]'}`}>
        <span className={`absolute top-[2px] left-[2px] w-[14px] h-[14px] rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-[14px]' : ''}`} />
      </span>
      {label}
    </button>
  );
}
