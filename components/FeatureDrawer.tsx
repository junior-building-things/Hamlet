'use client';
import { useEffect } from 'react';
import { Feature } from '@/lib/types';
import { StatusBadge } from '@/components/StatusBadge';
import { useSync } from '@/components/SyncContext';
import { X, AlertTriangle, Activity, FileText } from 'lucide-react';
import Image from 'next/image';

/**
 * Slide-in detail drawer for a feature row. Replaces the immediate
 * "click row → open full edit modal" path; the modal is now reached
 * via the drawer's Edit button.
 *
 * Layout per the redesign:
 *   - Header: status pill + close button, then large feature name
 *     and FEATURE-XXXXX id below.
 *   - AI insight box ("Junior") with auto-summary (uses feature.riskNotes
 *     when present, otherwise a generic line).
 *   - Project Details meta-grid: Priority / Quarterly Cycle / Business
 *     Line / Social Component.
 *   - POC Details: every role with a non-empty owner.
 *   - Links: per-platform brand chips for the URLs we have.
 *   - Activity: versionChanges feed if present, else empty state.
 */

interface Props {
  feature: Feature | null;
  onClose: () => void;
  /** Optional — kept for callers that still want to wire a deeper edit
   *  modal. The drawer no longer renders an Edit button itself. */
  onEdit?: (f: Feature) => void;
}

const POC_ROLES: Array<{ key: keyof Feature; label: string }> = [
  { key: 'pmOwner',         label: 'PM' },
  { key: 'tpmOwner',        label: 'TPM' },
  { key: 'techOwner',       label: 'Tech Owner' },
  { key: 'iosOwner',        label: 'iOS' },
  { key: 'androidOwner',    label: 'Android' },
  { key: 'serverOwner',     label: 'Server' },
  { key: 'qaOwner',         label: 'QA' },
  { key: 'daOwner',         label: 'DA' },
  { key: 'uiuxOwner',       label: 'UI/UX' },
  { key: 'contentDesigner', label: 'Content' },
];

const GRADIENTS = [
  'linear-gradient(135deg,#6b8aff,#a86bff)',
  'linear-gradient(135deg,#ff8a6b,#ffaa6b)',
  'linear-gradient(135deg,#6bffaa,#6bb8ff)',
  'linear-gradient(135deg,#a86bff,#ff6b9a)',
  'linear-gradient(135deg,#ffd86b,#ff8a6b)',
  'linear-gradient(135deg,#6bd8ff,#6b8aff)',
];

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map(s => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function featureCode(f: Feature): string {
  const id = String(f.meegoIssueId ?? f.id ?? '').replace(/[^0-9]/g, '');
  return id ? `FEATURE-${id.padStart(5, '0').slice(-7)}` : `FEATURE-${(f.id ?? '').slice(-7).toUpperCase()}`;
}

export function FeatureDrawer({ feature, onClose }: Props) {
  const { lastSyncedAt, refreshCronLastRunAt } = useSync();

  // Close on Escape.
  useEffect(() => {
    if (!feature) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [feature, onClose]);

  if (!feature) return null;

  const pocs = POC_ROLES
    .map(r => ({ role: r.label, name: (feature[r.key] as string | undefined)?.trim() ?? '' }))
    .filter(p => p.name);

  const links: Array<{ kind: 'meego' | 'prd' | 'figma' | 'libra' | 'compliance' | 'ab'; label: string; url: string; icon: string }> = [];
  if (feature.meegoUrl)      links.push({ kind: 'meego',      label: 'Meego',     url: feature.meegoUrl,      icon: '/meego.png' });
  if (feature.prd)           links.push({ kind: 'prd',        label: 'PRD',       url: feature.prd,           icon: '/prd.png' });
  if (feature.figmaUrl)      links.push({ kind: 'figma',      label: 'Figma',     url: feature.figmaUrl,      icon: '/figma_round.png' });
  if (feature.libraUrl)      links.push({ kind: 'libra',      label: 'Libra',     url: feature.libraUrl,      icon: '/libra.png' });
  if (feature.complianceUrl) links.push({ kind: 'compliance', label: 'Compliance',url: feature.complianceUrl, icon: '/compliance.png' });
  if (feature.abReportUrl)   links.push({ kind: 'ab',         label: 'AB Report', url: feature.abReportUrl,   icon: '/abreport.png' });

  // ── Freshness for "Updated Xh ago" ────────────────────────────────────────
  // Prefer the most recent of:
  //   (a) refresh-feature-cache cron's last run (only counts if within 24h)
  //   (b) the user's last manual Sync All / individual sync (lastSyncedAt)
  //   (c) the feature's own lastUpdated (Meego sync timestamp)
  const cronWithin24h = (() => {
    if (!refreshCronLastRunAt) return null;
    const ms = Date.now() - new Date(refreshCronLastRunAt).getTime();
    return Number.isFinite(ms) && ms < 24 * 60 * 60 * 1000 ? refreshCronLastRunAt : null;
  })();
  const updatedAtIso = [cronWithin24h, lastSyncedAt, feature.lastUpdated]
    .filter((s): s is string => !!s && Number.isFinite(new Date(s).getTime()))
    .sort()
    .pop() ?? null;

  // ── Junior insight: important vs idle ──────────────────────────────────────
  // "Important" if Junior has anything worth surfacing — risk flagged red /
  // yellow, explicit risk reasons, a recent version slip, a recent risk
  // worsening, or a PRD update in the last 7 days.
  const hasRiskFlag      = feature.riskLevel === 'red' || feature.riskLevel === 'yellow';
  const hasRiskNotes     = !!feature.riskNotes && feature.riskNotes.length > 0;
  const hasVersionSlip   = !!feature.versionChanges && feature.versionChanges.length > 0;
  const sevenDaysAgo     = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const recentPrdUpdate  = (feature.prdUpdates ?? []).find(p => p.date >= sevenDaysAgo);
  const recentRiskChange = (feature.riskHistory ?? []).find(r => r.date >= sevenDaysAgo && (r.to === 'red' || r.to === 'yellow'));
  const isImportant      = hasRiskFlag || hasRiskNotes || hasVersionSlip || !!recentPrdUpdate || !!recentRiskChange;

  // Each callout = a tagged line in the insight body. The tag is rendered
  // in the matching tone (rose for High risk + Delayed, amber for Medium
  // / PRD changes, blue for Low risk) followed by the Junior note.
  // Multiple callouts stack as separate lines.
  type Callout = { tag: string; tone: 'rose' | 'amber' | 'blue'; note: string };
  const callouts: Callout[] = [];
  // Higher-priority callouts first (risk reasons, delays, PRD changes).
  if (hasRiskNotes) {
    const tag = feature.riskLevel === 'red'
      ? 'High risk'
      : feature.riskLevel === 'yellow' ? 'Medium risk' : 'Risk';
    const tone: Callout['tone'] = feature.riskLevel === 'red' ? 'rose' : 'amber';
    callouts.push({ tag, tone, note: feature.riskNotes!.join(' · ') });
  }
  if (hasVersionSlip) {
    const latest = feature.versionChanges!.slice(-1)[0];
    callouts.push({
      tag: 'Delayed',
      tone: 'rose',
      note: `Planned version slipped ${latest.from} → ${latest.to}.`,
    });
  }
  if (recentPrdUpdate) {
    callouts.push({
      tag: 'PRD changes',
      tone: 'amber',
      note: recentPrdUpdate.summary,
    });
  }
  // Low-risk fallback — only show when nothing higher-priority fired
  // AND the feature actually reports green. Keeps the banner from
  // double-tagging "Low risk + PRD changes" when there are real updates.
  if (callouts.length === 0 && feature.riskLevel === 'green') {
    callouts.push({
      tag: 'Low risk',
      tone: 'blue',
      note: 'No active blockers detected.',
    });
  }

  // ── Activity feed: merge version slips, risk transitions, and PRD
  // updates (all populated by the digest pipeline), then sort newest-first
  // and cap to the last 12. Last sync time is appended as a tail entry.
  type ActivityEntry =
    | { kind: 'version_slip';   date: string; from: string; to: string }
    | { kind: 'risk_change';    date: string; from: string; to: string }
    | { kind: 'prd_update';     date: string; summary: string }
    | { kind: 'sync';           iso: string };

  type DatedEntry = Exclude<ActivityEntry, { kind: 'sync' }>;
  const dated: DatedEntry[] = [
    ...(feature.versionChanges ?? []).map((c): DatedEntry => ({
      kind: 'version_slip', date: c.date, from: c.from, to: c.to,
    })),
    ...(feature.riskHistory ?? []).map((r): DatedEntry => ({
      kind: 'risk_change', date: r.date, from: r.from, to: r.to,
    })),
    ...(feature.prdUpdates ?? []).map((p): DatedEntry => ({
      kind: 'prd_update', date: p.date, summary: p.summary,
    })),
  ];
  // Sort newest first by ISO date.
  dated.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const activity: ActivityEntry[] = dated.slice(0, 12);
  if (updatedAtIso) {
    activity.push({ kind: 'sync', iso: updatedAtIso });
  }

  return (
    <>
      {/* Backdrop — fixed so it covers the sidebar too */}
      <div
        onClick={onClose}
        className="fixed inset-0 z-[90] bg-black/60 transition-opacity"
        aria-hidden
      />

      {/* Drawer pinned to the right edge of the viewport */}
      <aside
        className="fixed top-0 right-0 bottom-0 w-[460px] max-w-[100vw] z-[91] flex flex-col bg-[var(--bg-elev-1)] border-l border-[var(--hairline-strong)]"
        style={{ boxShadow: '-16px 0 48px rgba(0,0,0,0.4)' }}
        role="dialog"
        aria-label={`Detail for ${feature.name}`}
      >
        {/* Head */}
        <div className="px-[22px] pt-[18px] pb-[14px] border-b border-[var(--hairline)] shrink-0">
          <div className="flex items-center gap-2.5 mb-2.5">
            <StatusBadge status={feature.status} />
            <button
              onClick={onClose}
              className="ml-auto grid place-items-center w-8 h-8 rounded-[var(--r-sm)] border border-[var(--hairline)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-elev-2)] hover:border-[var(--hairline-strong)] transition-colors"
              title="Close"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="text-[18px] font-semibold leading-[1.3] tracking-[-0.02em] text-[var(--text)]">
            {feature.name}
          </div>
          <div className="font-mono text-[10.5px] text-[var(--text-dim)] mt-1.5 uppercase tracking-[0.06em]">
            {featureCode(feature)}
          </div>
        </div>

        {/* Body (scrolls) */}
        <div className="px-[22px] py-[18px] overflow-y-auto flex-1 flex flex-col gap-[18px]">

          {/* Junior insight — blue gradient + blue stroke for all states.
              Heavy glow only when there's a non-Low-risk callout (i.e.
              something actually needs attention). */}
          {(() => {
            const heavyGlow = callouts.some(c => c.tone !== 'blue');
            return (
              <div
                className="px-4 py-3.5 rounded-[var(--r-lg)] border flex gap-3.5 items-start transition-shadow"
                style={{
                  background: 'linear-gradient(135deg, var(--ai-soft), oklch(0.74 0.14 295 / 0.06))',
                  borderColor: heavyGlow
                    ? 'oklch(0.55 0.13 var(--ai-h) / 0.4)'
                    : 'oklch(0.55 0.13 var(--ai-h) / 0.25)',
                  boxShadow: heavyGlow ? '0 0 0 3px var(--ai-soft), 0 0 24px var(--ai-glow)' : 'none',
                }}
              >
                <div className="flex-1 min-w-0">
                  {callouts.length > 0 ? (
                    <div className="flex flex-col gap-1.5">
                      {callouts.map((c, i) => (
                        <div key={i} className="text-[12.5px] leading-[1.5] text-[var(--text)]">
                          <CalloutTag tone={c.tone}>{c.tag}</CalloutTag>{' '}
                          {c.note}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-[12.5px] leading-[1.5] text-[var(--text)]">
                      Nothing to callout. I&apos;m monitoring this feature for risk, PRD edits, and unresolved questions.
                    </div>
                  )}
                  <div className="font-mono text-[10px] text-[var(--text-muted)] mt-1">
                    From Junior · {updatedAtIso ? `Updated ${formatRel(updatedAtIso)}` : 'Never updated'}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Project Details */}
          <Section title="Project Details">
            <div className="grid grid-cols-[140px_1fr] gap-y-2 gap-x-3.5 text-[12px]">
              <Key>Priority</Key>           <Val>{feature.priority}</Val>
              <Key>Quarterly Cycle</Key>    <Val>{feature.quarterlyCycle ?? '—'}</Val>
              <Key>Business Line</Key>      <Val>{feature.businessLine ?? '—'}</Val>
              <Key>Social Component</Key>   <Val>{feature.socialComponent ?? '—'}</Val>
            </div>
          </Section>

          {/* POC Details */}
          {pocs.length > 0 && (
            <Section title="POC Details">
              <div className="grid grid-cols-[140px_1fr] gap-y-2 gap-x-3.5 text-[12px]">
                {pocs.map((p, i) => (
                  <PocRow key={p.role} role={p.role} name={p.name} grad={GRADIENTS[i % GRADIENTS.length]} />
                ))}
              </div>
            </Section>
          )}

          {/* Links */}
          {links.length > 0 && (
            <Section title="Links">
              <div className="flex flex-wrap gap-1.5">
                {links.map(l => (
                  <a
                    key={l.kind}
                    href={l.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-[var(--r-sm)] bg-[var(--bg-elev-2)] border border-[var(--hairline)] text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--hairline-strong)] text-[11.5px] transition-colors"
                  >
                    <Image src={l.icon} alt="" width={12} height={12} className="shrink-0" />
                    {l.label}
                  </a>
                ))}
              </div>
            </Section>
          )}

          {/* Activity feed: version slips (= delays) + last sync. Risk
              transition history + per-PRD edit events aren't tracked yet —
              extending here is a backend follow-up. */}
          <Section title="Activity">
            {activity.length === 0 ? (
              <div className="text-[12px] text-[var(--text-muted)]">No activity yet.</div>
            ) : (
              <div className="flex flex-col gap-2.5">
                {activity.map((a, i) => (
                  <ActivityItem key={i} entry={a} />
                ))}
              </div>
            )}
          </Section>
        </div>
      </aside>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-[var(--text-dim)] mb-2">
        {title}
      </div>
      {children}
    </div>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-[var(--text-muted)]">
      {children}
    </div>
  );
}

function Val({ children }: { children: React.ReactNode }) {
  return <div className="font-semibold text-[var(--text)]">{children}</div>;
}

function CalloutTag({ tone, children }: { tone: 'rose' | 'amber' | 'blue'; children: React.ReactNode }) {
  const styles: Record<typeof tone, { bg: string; fg: string }> = {
    rose:  { bg: 'oklch(0.72 0.18 22 / 0.14)',           fg: 'var(--rose)'  },
    amber: { bg: 'oklch(0.82 0.14 75 / 0.16)',           fg: 'var(--amber)' },
    blue:  { bg: 'oklch(0.55 0.13 var(--ai-h) / 0.14)',  fg: 'var(--ai)'    },
  };
  const s = styles[tone];
  return (
    <span
      className="inline-flex items-center font-mono text-[9.5px] uppercase tracking-[0.06em] px-1.5 py-[1px] rounded mr-1 align-middle"
      style={{ background: s.bg, color: s.fg }}
    >
      {children}
    </span>
  );
}

function PocRow({ role, name, grad }: { role: string; name: string; grad: string }) {
  return (
    <>
      <Key>{role}</Key>
      <div className="flex items-center gap-2 font-semibold text-[var(--text)]">
        <span
          className="w-5 h-5 rounded-full grid place-items-center font-mono text-[8.5px] text-white shrink-0"
          style={{ background: grad }}
        >
          {initials(name)}
        </span>
        <span>{name}</span>
      </div>
    </>
  );
}

function formatRel(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return iso;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

type ActivityEntryT =
  | { kind: 'version_slip'; date: string; from: string; to: string }
  | { kind: 'risk_change';  date: string; from: string; to: string }
  | { kind: 'prd_update';   date: string; summary: string }
  | { kind: 'sync';         iso: string };

const RISK_COLOR: Record<string, { bg: string; fg: string; border: string }> = {
  red:    { bg: 'oklch(0.72 0.18 22 / 0.12)',  fg: 'var(--rose)',       border: 'oklch(0.62 0.20 22 / 0.3)'  },
  yellow: { bg: 'oklch(0.82 0.14 75 / 0.14)',  fg: 'var(--amber)',      border: 'oklch(0.55 0.16 75 / 0.3)'  },
  green:  { bg: 'oklch(0.78 0.14 155 / 0.12)', fg: 'var(--green)',      border: 'oklch(0.50 0.16 155 / 0.3)' },
  none:   { bg: 'var(--bg-elev-2)',             fg: 'var(--text-muted)', border: 'var(--hairline-strong)'    },
};

function riskLabel(level: string): string {
  if (level === 'red')    return 'High';
  if (level === 'yellow') return 'Medium';
  if (level === 'green')  return 'Low';
  return 'None';
}

function ActivityItem({ entry }: { entry: ActivityEntryT }) {
  if (entry.kind === 'version_slip') {
    return (
      <ActivityRow
        iconBg="var(--ai-soft)"
        iconFg="var(--ai)"
        iconBorder="oklch(0.78 0.16 var(--ai-h) / 0.3)"
        icon={<AlertTriangle className="w-2.5 h-2.5" />}
        actor="Junior"
        actorColor="var(--ai)"
        body={`flagged version slip ${entry.from} → ${entry.to}`}
        meta={entry.date}
      />
    );
  }
  if (entry.kind === 'risk_change') {
    const tone = RISK_COLOR[entry.to] ?? RISK_COLOR.none;
    return (
      <ActivityRow
        iconBg={tone.bg}
        iconFg={tone.fg}
        iconBorder={tone.border}
        icon={<AlertTriangle className="w-2.5 h-2.5" />}
        actor="Junior"
        actorColor="var(--ai)"
        body={
          <>
            risk changed{' '}
            <strong style={{ color: 'var(--text)', fontWeight: 500 }}>
              {riskLabel(entry.from)} → {riskLabel(entry.to)}
            </strong>
          </>
        }
        meta={entry.date}
      />
    );
  }
  if (entry.kind === 'prd_update') {
    return (
      <ActivityRow
        iconBg="oklch(0.74 0.14 295 / 0.14)"
        iconFg="var(--violet)"
        iconBorder="oklch(0.55 0.18 295 / 0.3)"
        icon={<FileText className="w-2.5 h-2.5" />}
        actor="Junior"
        actorColor="var(--ai)"
        body={
          <>
            updated PRD — <span style={{ color: 'var(--text-muted)' }}>{entry.summary}</span>
          </>
        }
        meta={entry.date}
      />
    );
  }
  // Sync entry
  return (
    <ActivityRow
      iconBg="var(--bg-elev-2)"
      iconFg="var(--text-muted)"
      iconBorder="var(--hairline-strong)"
      icon={<Activity className="w-2.5 h-2.5" />}
      actor="Updated"
      actorColor="var(--text)"
      body="latest sync"
      meta={formatRel(entry.iso)}
    />
  );
}

function ActivityRow({
  iconBg, iconFg, iconBorder, icon, actor, actorColor, body, meta,
}: {
  iconBg: string;
  iconFg: string;
  iconBorder: string;
  icon: React.ReactNode;
  actor: string;
  actorColor: string;
  body: React.ReactNode;
  meta: string;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <div
        className="w-5 h-5 rounded-full grid place-items-center shrink-0 border"
        style={{ background: iconBg, color: iconFg, borderColor: iconBorder }}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[12px]">
          <span className="font-medium" style={{ color: actorColor }}>{actor}</span>{' '}
          <span className="text-[var(--text-muted)]">{body}</span>
        </div>
        <div className="font-mono text-[10px] text-[var(--text-dim)] mt-0.5">{meta}</div>
      </div>
    </div>
  );
}
