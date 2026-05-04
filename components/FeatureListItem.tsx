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
import { Tip } from './Tip';
import Image from 'next/image';
import { RefreshCw, CheckCircle2, Loader2 } from 'lucide-react';

interface Props {
  feature: Feature;
  syncing: boolean;
  onEdit: (feature: Feature) => void;
  /** Open the detail drawer (replaces immediate row → modal click).
   *  When omitted, row clicks fall back to onEdit. */
  onOpenDetail?: (feature: Feature) => void;
  onSync: (feature: Feature) => void;
  completing?: boolean;
  onComplete?: (feature: Feature) => void;
  pinned?: boolean;
  onToggleAgent?: (featureId: string, agentKey: string) => void;
  onFieldUpdate?: (featureId: string, updates: Partial<Feature>) => void;
  /** Skip the Status cell (used when the table is grouped by status). */
  hideStatus?: boolean;
  /** Skip the Priority cell (used when the table is grouped by priority). */
  hidePriority?: boolean;
  /** Skip the Action cell (Ongoing Features hides it; To Dos shows it). */
  hideAction?: boolean;
  /** Same gridTemplateColumns the header renders with so each row
   *  shares identical column tracks. */
  gridTemplateColumns?: string;
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

// ─── Risk badge with reasons tooltip ────────────────────────────────────────

function RiskBadge({ feature, onClick }: { feature: Feature; onClick: () => void }) {
  const [showTip, setShowTip] = useState(false);
  const [anchor, setAnchor] = useState({ top: 0, left: 0, width: 0 });
  const [mounted, setMounted] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => () => { if (showTimer.current) clearTimeout(showTimer.current); }, []);

  // Done / launched features should never display a risk badge — the
  // backend clears riskLevel for them on the next digest run, but this
  // guard hides any stale data immediately (and suppresses the Delayed
  // marker triggered by historical versionChanges).
  if (feature.status === 'Done' || feature.status === '已完成') return null;

  const versionChanges = feature.versionChanges && feature.versionChanges.length > 0
    ? feature.versionChanges
    : null;
  const isDelayed = !!versionChanges;
  const reasons = feature.riskNotes && feature.riskNotes.length > 0 ? feature.riskNotes : [];

  // Delayed → tooltip lists each version change formatted as "M/D: from → to".
  // Otherwise → reasons list (skip on green since no actionable info).
  const showTooltip = isDelayed || (reasons.length > 0 && feature.riskLevel !== 'green');

  function handleEnter() {
    if (!showTooltip || !ref.current) return;
    if (showTimer.current) clearTimeout(showTimer.current);
    showTimer.current = setTimeout(() => {
      const r = ref.current?.getBoundingClientRect();
      if (r) setAnchor({ top: r.top, left: r.left, width: r.width });
      setShowTip(true);
    }, 350);
  }
  function handleLeave() {
    if (showTimer.current) { clearTimeout(showTimer.current); showTimer.current = null; }
    setShowTip(false);
  }

  if (!feature.riskLevel && !isDelayed) return null;

  // When delayed, badge always renders red regardless of underlying riskLevel.
  const effectiveLevel = isDelayed ? 'red' : feature.riskLevel;
  const label = isDelayed
    ? 'Delayed'
    : (effectiveLevel === 'red' ? 'High' : effectiveLevel === 'yellow' ? 'Medium' : 'Low');

  // Design tokens: dot + colored text. Color matches `.risk-low / med / high`.
  const dotColor =
    effectiveLevel === 'red' ? 'var(--rose)' :
    effectiveLevel === 'yellow' ? 'var(--amber)' :
    'var(--green)';
  const textColor = dotColor;
  const dotShadow = effectiveLevel === 'red'
    ? '0 0 6px oklch(0.62 0.20 22 / 0.5)'
    : effectiveLevel === 'green'
      ? '0 0 6px oklch(0.65 0.16 155 / 0.5)'
      : 'none';

  return (
    <>
      <span
        ref={ref}
        onClick={onClick}
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        className="inline-flex items-center gap-1.5 text-[11.5px] whitespace-nowrap cursor-pointer"
        style={{ color: textColor }}
      >
        <span
          className="inline-block w-1.5 h-1.5 rounded-full"
          style={{ background: dotColor, boxShadow: dotShadow }}
        />
        <span>{label}</span>
      </span>
      {showTip && mounted && createPortal(
        <div
          className="tip shown"
          style={{
            top: anchor.top - 8,
            left: anchor.left + anchor.width / 2,
            transform: 'translate(-50%, -100%)',
            zIndex: 9999,
          }}
        >
          <div className="tip-label" style={{ marginBottom: 4 }}>{label} risk</div>
          {isDelayed ? (
            <ul className="list-none space-y-0.5">
              {versionChanges!.map((c, i) => {
                const [, mm, dd] = c.date.split('-');
                const short = `${parseInt(mm, 10)}/${parseInt(dd, 10)}`;
                return <li key={i} style={{ fontSize: 12, lineHeight: 1.45 }}>{short}: {c.from} → {c.to}</li>;
              })}
            </ul>
          ) : reasons.length === 1 ? (
            <div style={{ fontSize: 12, lineHeight: 1.45 }}>{reasons[0]}</div>
          ) : (
            <ul className="list-disc list-inside space-y-0.5">
              {reasons.map((r, i) => <li key={i} style={{ fontSize: 12, lineHeight: 1.45 }}>{r}</li>)}
            </ul>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}

// ─── Feature-name span with delayed hover tooltip ──────────────────────────
// Hover handlers go on the <span> directly so the trigger area matches
// the visible text, not the whole grid track. The span shrinks-to-fit
// when the name is short, and stretches with truncate when long — so
// the cursor only fires the tip when over actual text.

function FeatureNameTip({ feature }: { feature: Feature }) {
  const [shown, setShown] = useState(false);
  const [pos, setPos]     = useState({ x: 0, y: 0 });
  const [mounted, setMounted] = useState(false);
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ref       = useRef<HTMLSpanElement>(null);
  const SHOW_DELAY = 350;

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => () => {
    if (showTimer.current) clearTimeout(showTimer.current);
    if (hideTimer.current) clearTimeout(hideTimer.current);
  }, []);

  function show() {
    if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; }
    if (showTimer.current) clearTimeout(showTimer.current);
    showTimer.current = setTimeout(() => {
      const r = ref.current?.getBoundingClientRect();
      if (r) setPos({ x: r.left + r.width / 2, y: r.top });
      setShown(true);
    }, SHOW_DELAY);
  }
  function hide() {
    if (showTimer.current) { clearTimeout(showTimer.current); showTimer.current = null; }
    hideTimer.current = setTimeout(() => setShown(false), 100);
  }

  return (
    <>
      <span
        ref={ref}
        className="text-[var(--text)] text-xs truncate min-w-0"
        onMouseEnter={show}
        onMouseLeave={hide}
      >
        {feature.name}
      </span>
      {shown && mounted && createPortal(
        <div
          className="tip shown"
          style={{
            left: pos.x,
            top: pos.y,
            transform: 'translate(-50%, calc(-100% - 8px))',
          }}
          onMouseEnter={() => {
            if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; }
            setShown(true);
          }}
          onMouseLeave={hide}
        >
          <div className="tip-label" style={{ marginBottom: 4 }}>Feature</div>
          <div style={{ fontSize: 12.5, lineHeight: 1.4 }}>{feature.name}</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-dim)', marginTop: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            FEATURE-{(feature.meegoIssueId ?? feature.id).slice(-7)}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

export function FeatureListItem({ feature, syncing, onEdit, onOpenDetail, onSync, completing, onComplete, pinned, onToggleAgent, onFieldUpdate, hideStatus, hidePriority, hideAction, gridTemplateColumns }: Props) {
  const [showPackage, setShowPackage] = useState(false);
  const [showIos, setShowIos] = useState(false);
  // Row clicks open the drawer (Phase C). Falls back to onEdit when no
  // drawer handler was provided (e.g. TodoView reuse without wiring it).
  const openRow = (f: Feature) => (onOpenDetail ?? onEdit)(f);

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
    <div
      onClick={() => openRow(feature)}
      className={`bg-transparent border-b border-[var(--hairline)] hover:bg-[var(--bg-elev-2)] transition-colors cursor-pointer
                    sm:grid sm:items-center
                    ${pinned ? 'bg-[var(--ai-soft)] shadow-[inset_2px_0_0_var(--ai)]' : ''}`}
      style={{ gridTemplateColumns, columnGap: '0.75rem' }}
    >

      {/* Mobile layout */}
      <div className="sm:hidden px-4 py-3 flex flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <button
            onClick={() => openRow(feature)}
            className="text-[var(--text)] text-sm leading-tight text-left hover:text-blue-300 transition-colors cursor-pointer"
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
            className="hm-btn hm-btn-ai self-start"
          >
            {completing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
            Complete: {feature.status}
          </button>
        )}
      </div>

      {/* Desktop cells — direct subgrid children. The whole row is the
          click target (handled by the parent <div onClick>); cells just
          inherit unless they explicitly stop propagation (Links, Notes,
          Action, Sync). */}

      {/* Name (read-only — click anywhere on the row opens the drawer).
          Hover handlers go on the <FeatureNameTip> span itself so the
          tooltip only fires when the cursor is over the visible text,
          not the empty right-hand side of the column. */}
      <div className="hidden sm:flex items-center pl-4 py-2.5 w-full min-w-0">
        <FeatureNameTip feature={feature} />
        {pinned && <span className="ml-2 shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-600/30 text-blue-400 border border-blue-500/40">NEW</span>}
      </div>

      {!hideStatus && (
        <div className="hidden sm:flex py-2.5 pl-4">
          <StatusBadge status={feature.status} />
        </div>
      )}

      <div className="hidden sm:flex items-center py-2.5 pl-4">
        <VersionBadge version={feature.iosVersion} versionHistory={feature.versionHistory} />
      </div>

      {!hidePriority && (
        <div className="hidden sm:flex py-2.5 pl-4">
          <PriorityBadge priority={feature.priority} />
        </div>
      )}

      <div
        className="hidden sm:flex items-center py-2.5 pl-4 overflow-visible relative"
        onClick={e => e.stopPropagation()}
      >
        <LinkIcons feature={feature} ringColor="var(--card)"
          onPackageClick={(ios) => { setShowPackage(true); if (ios) setShowIos(true); }}
          onLinkUpdate={onFieldUpdate ? handleLinkUpdate : undefined} />
      </div>

      {/* Team avatars */}
      <div className="hidden sm:flex items-center py-2.5 pl-4">
        <TeamAvatars feature={feature} ringColor="var(--card)" onToggleAgent={onToggleAgent} />
      </div>

      {/* Risk (with reasons tooltip on hover) */}
      <div className="hidden sm:flex items-center py-2.5 pl-4">
        <RiskBadge feature={feature} onClick={() => openRow(feature)} />
      </div>

      {/* Notes (editable, manual user input) — stop propagation so the
          click → enter-edit-mode doesn't bubble up to the row's
          open-drawer handler. */}
      <div
        className="hidden sm:flex items-center py-2.5 pl-4 min-w-0"
        onClick={e => e.stopPropagation()}
      >
        {onFieldUpdate ? (
          <EditableText
            value={feature.notes ?? ''}
            onSave={v => onFieldUpdate(feature.id, { notes: v })}
            className="text-xs text-[var(--muted)] truncate"
            placeholder="—"
            allowEmpty
            showTooltipIfTruncated
          />
        ) : (
          feature.notes && (
            <span className="text-xs text-[var(--muted)] truncate" title={feature.notes}>
              {feature.notes}
            </span>
          )
        )}
      </div>

      {/* Action */}
      {!hideAction && (
        <div className="hidden sm:flex items-center pr-4 py-2.5 pl-4">
          {feature.canCompleteNode && onComplete && (
            <button
              onClick={(e) => { e.stopPropagation(); onComplete(feature); }}
              disabled={completing}
              className="hm-btn hm-btn-ai"
            >
              {completing
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <CheckCircle2 className="w-3.5 h-3.5" />}
              Complete
            </button>
          )}
        </div>
      )}

      {/* Sync button */}
      <div className="hidden sm:flex items-center pr-4 py-2.5">
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
          androidPackageName={feature.packageName}
          androidBuildTime={feature.packageBuildTime}
          iosQrUrl={feature.iosPackageQrUrl}
          iosDownloadUrl={feature.iosPackageDownloadUrl}
          iosPackageName={feature.iosPackageName}
          iosBuildTime={feature.iosPackageBuildTime}
          featureName={feature.name}
          defaultTab={showIos ? 'ios' : 'android'}
          onClose={() => { setShowPackage(false); setShowIos(false); }}
        />
      )}
    </div>
  );
}
