'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Feature } from '@/lib/types';
import { StatusBadge } from './StatusBadge';
import { PriorityBadge } from './PriorityBadge';
import { VersionBadge } from './VersionBadge';
import { TeamAvatars } from './TeamAvatars';
import { LinkIcons } from './LinkIcons';
import { PackageModal } from './PackageModal';
import Image from 'next/image';
import { RefreshCw, CheckCircle2, Loader2 } from 'lucide-react';

interface Props {
  feature: Feature;
  syncing: boolean;
  onEdit: (feature: Feature) => void;
  onSync: (feature: Feature) => void;
  completing?: boolean;
  onComplete?: (feature: Feature) => void;
  pinned?: boolean;
  onToggleAgent?: (featureId: string, agentKey: string) => void;
  onFieldUpdate?: (featureId: string, updates: Partial<Feature>) => void;
}

// ─── Inline editable text field ─────────────────────────────────────────────

function EditableText({ value, onSave, className, placeholder, allowEmpty, showTooltipIfTruncated }: {
  value: string;
  onSave: (v: string) => void;
  className?: string;
  placeholder?: string;
  allowEmpty?: boolean;
  showTooltipIfTruncated?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [showTip, setShowTip] = useState(false);
  const [tipAnchor, setTipAnchor] = useState({ top: 0, left: 0, width: 0 });
  const [mounted, setMounted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const spanRef = useRef<HTMLSpanElement>(null);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.setSelectionRange(draft.length, draft.length);
    }
  }, [editing, draft.length]);

  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);

  function commit() {
    setEditing(false);
    const trimmed = draft.trim();
    if (allowEmpty ? trimmed !== value : trimmed && trimmed !== value) onSave(trimmed);
    else setDraft(value);
  }

  const handleMouseEnter = useCallback(() => {
    if (!showTooltipIfTruncated || !spanRef.current) return;
    const el = spanRef.current;
    if (el.scrollWidth > el.clientWidth && value) {
      const r = el.getBoundingClientRect();
      setTipAnchor({ top: r.top, left: r.left, width: r.width });
      setShowTip(true);
    }
  }, [showTooltipIfTruncated, value]);

  const handleMouseLeave = useCallback(() => setShowTip(false), []);

  if (editing) {
    return (
      <input
        ref={inputRef}
        className={`${className} w-full min-w-0 bg-transparent border-none outline-none`}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          if (e.key === 'Escape') { setDraft(value); setEditing(false); }
        }}
        placeholder={placeholder}
      />
    );
  }

  return (
    <>
      <div
        className="editable-cell w-full min-w-0"
        onClick={() => setEditing(true)}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <span ref={spanRef} className={className}>{value || placeholder}</span>
      </div>
      {showTip && mounted && value && createPortal(
        <div
          className="fixed bg-[var(--card)] border border-[var(--border)] rounded-xl shadow-2xl py-2 px-3 text-xs text-[var(--foreground)] max-w-[400px] pointer-events-none"
          style={{
            top: tipAnchor.top - 8,
            left: tipAnchor.left + tipAnchor.width / 2,
            transform: 'translate(-50%, -100%)',
            zIndex: 9999,
          }}
        >
          {value}
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-l-[5px] border-r-[5px] border-t-[5px] border-l-transparent border-r-transparent border-t-[var(--card)]" />
        </div>,
        document.body,
      )}
    </>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

export function FeatureListItem({ feature, syncing, onEdit, onSync, completing, onComplete, pinned, onToggleAgent, onFieldUpdate }: Props) {
  const [showPackage, setShowPackage] = useState(false);
  const [showIos, setShowIos] = useState(false);

  function handleLinkUpdate(linkKey: string, newUrl: string) {
    if (!onFieldUpdate) return;
    const fieldMap: Record<string, keyof Feature> = {
      meego: 'meegoUrl', prd: 'prd', figma: 'figmaUrl',
      compliance: 'complianceUrl', libra: 'libraUrl', ab: 'abReportUrl',
    };
    const field = fieldMap[linkKey];
    if (field) onFieldUpdate(feature.id, { [field]: newUrl });
  }

  return (
    <div className={`bg-[var(--card)] border rounded-xl hover:border-[var(--border)] transition-colors
                    sm:col-span-full sm:grid sm:[grid-template-columns:subgrid] sm:items-center
                    ${pinned ? 'border-blue-500/60 ring-1 ring-blue-500/30' : 'border-[var(--border)]'}`}>

      {/* Mobile layout */}
      <div className="sm:hidden px-4 py-3 flex flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <button
            onClick={() => onEdit(feature)}
            className="text-[var(--foreground)] text-sm font-semibold leading-tight text-left hover:text-blue-300 transition-colors cursor-pointer"
          >
            {feature.name}
          </button>
          {feature.meegoUrl && (
            <button onClick={() => onSync(feature)} disabled={syncing} className="text-gray-500 hover:text-blue-400 disabled:opacity-40 shrink-0">
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <StatusBadge status={feature.status} />
          <VersionBadge version={feature.iosVersion} versionHistory={feature.versionHistory} />
          <PriorityBadge priority={feature.priority} />
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {feature.meegoUrl && (
            <a href={feature.meegoUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs hover:brightness-125 transition-all" style={{ color: '#B291F7' }}>
              <Image src="/meego.png" alt="" width={16} height={16} className="shrink-0" /> Meego
            </a>
          )}
          {feature.prd && (
            <a href={feature.prd} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors">
              <Image src="/prd.png" alt="" width={14} height={14} className="shrink-0" /> PRD
            </a>
          )}
          {feature.complianceUrl && (
            <a href={feature.complianceUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs hover:brightness-125 transition-all" style={{ color: '#88DBDD' }}>
              <Image src="/compliance.png" alt="" width={14} height={14} className="shrink-0" /> Compliance
            </a>
          )}
          {feature.figmaUrl && (
            <a href={feature.figmaUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs hover:brightness-125 transition-all" style={{ color: '#FF7362' }}>
              <Image src="/figma.svg" alt="" width={10} height={14} className="shrink-0" /> Figma
            </a>
          )}
          {feature.abReportUrl && (
            <a href={feature.abReportUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs hover:brightness-125 transition-all" style={{ color: '#F59E0B' }}>
              <Image src="/ab.png" alt="" width={14} height={14} className="shrink-0" /> AB
            </a>
          )}
        </div>
        {feature.canCompleteNode && onComplete && (
          <button
            onClick={() => onComplete(feature)}
            disabled={completing}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors self-start"
          >
            {completing ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
            Complete: {feature.status}
          </button>
        )}
      </div>

      {/* Desktop cells — direct subgrid children */}

      {/* Name (editable) */}
      <div className="hidden sm:flex items-center pl-4 py-1.5 w-full min-w-0">
        {onFieldUpdate ? (
          <div className="flex items-center gap-2 w-full min-w-0">
            <EditableText
              value={feature.name}
              onSave={v => onFieldUpdate(feature.id, { name: v })}
              className="text-[var(--foreground)] text-xs font-medium truncate"
            />
            {pinned && <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-600/30 text-blue-400 border border-blue-500/40">NEW</span>}
          </div>
        ) : (
          <button
            onClick={() => onEdit(feature)}
            className="flex items-center gap-2 w-full min-w-0 text-left text-[var(--foreground)] text-xs font-medium hover:text-blue-300 transition-colors cursor-pointer"
          >
            <span className="truncate">{feature.name}</span>
            {pinned && <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-600/30 text-blue-400 border border-blue-500/40">NEW</span>}
          </button>
        )}
      </div>

      <div className="hidden sm:flex py-1.5 pl-4 cursor-pointer" onClick={() => onEdit(feature)}>
        <StatusBadge status={feature.status} />
      </div>

      <div className="hidden sm:flex items-center py-1.5 pl-4 cursor-pointer" onClick={() => onEdit(feature)}>
        <VersionBadge version={feature.iosVersion} versionHistory={feature.versionHistory} />
      </div>

      <div className="hidden sm:flex py-1.5 cursor-pointer" onClick={() => onEdit(feature)}>
        <PriorityBadge priority={feature.priority} />
      </div>

      <div className="hidden sm:flex items-center py-1.5 pl-4 overflow-visible relative">
        <LinkIcons feature={feature} ringColor="var(--card)"
          onPackageClick={(ios) => { setShowPackage(true); if (ios) setShowIos(true); }}
          onLinkUpdate={onFieldUpdate ? handleLinkUpdate : undefined} />
      </div>

      {/* Team avatars */}
      <div className="hidden sm:flex items-center py-1.5 pl-4 cursor-pointer" onClick={() => onEdit(feature)}>
        <TeamAvatars feature={feature} ringColor="var(--card)" onToggleAgent={onToggleAgent} />
      </div>

      {/* Risk */}
      <div className="hidden sm:flex items-center py-1.5 pl-4 cursor-pointer" onClick={() => onEdit(feature)}>
        {feature.riskLevel && (
          <span className={`inline-flex items-center gap-1 text-xs font-medium whitespace-nowrap ${
            feature.riskLevel === 'red' ? 'text-red-600' :
            feature.riskLevel === 'yellow' ? 'text-amber-600' :
            'text-emerald-600'
          }`}>
            {feature.riskLevel === 'red' ? '🔴' : feature.riskLevel === 'yellow' ? '🟡' : '🟢'}
            {feature.riskLevel === 'red' ? 'High' : feature.riskLevel === 'yellow' ? 'Medium' : 'Low'}
          </span>
        )}
      </div>

      {/* Notes (editable) */}
      <div className="hidden sm:flex items-center py-1.5 pl-4 max-w-[200px]">
        {onFieldUpdate ? (
          <EditableText
            value={(feature.riskNotes && feature.riskNotes.length > 0 && feature.riskLevel !== 'green') ? feature.riskNotes.join(', ') : ''}
            onSave={v => onFieldUpdate(feature.id, { riskNotes: v.split(', ').map(s => s.trim()).filter(Boolean) })}
            className="text-xs text-[var(--muted)] truncate"
            placeholder="—"
            allowEmpty
            showTooltipIfTruncated
          />
        ) : (
          feature.riskNotes && feature.riskNotes.length > 0 && feature.riskLevel !== 'green' && (
            <span className="text-xs text-[var(--muted)] truncate" title={feature.riskNotes.join(', ')}>
              {feature.riskNotes.join(', ')}
            </span>
          )
        )}
      </div>

      {/* Action */}
      <div className="hidden sm:flex items-center pr-4 py-1.5 pl-4">
        {feature.canCompleteNode && onComplete && (
          <button
            onClick={(e) => { e.stopPropagation(); onComplete(feature); }}
            disabled={completing}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors"
          >
            {completing
              ? <Loader2 className="w-3 h-3 animate-spin" />
              : <CheckCircle2 className="w-3 h-3" />}
            Complete
          </button>
        )}
      </div>

      {/* Sync button */}
      <div className="hidden sm:flex items-center pr-4 py-1.5">
        {feature.meegoUrl && (
          <button
            onClick={(e) => { e.stopPropagation(); onSync(feature); }}
            disabled={syncing}
            className="text-gray-500 hover:text-blue-400 disabled:opacity-40 transition-colors"
            title="Sync this feature"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
          </button>
        )}
      </div>

      {/* Package modal */}
      {showPackage && (feature.packageQrUrl || feature.iosPackageQrUrl) && (
        <PackageModal
          androidQrUrl={feature.packageQrUrl}
          androidDownloadUrl={feature.packageDownloadUrl}
          iosQrUrl={feature.iosPackageQrUrl}
          iosDownloadUrl={feature.iosPackageDownloadUrl}
          featureName={feature.name}
          defaultTab={showIos ? 'ios' : 'android'}
          onClose={() => { setShowPackage(false); setShowIos(false); }}
        />
      )}
    </div>
  );
}
