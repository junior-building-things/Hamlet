'use client';
import { useEffect, useMemo, useState } from 'react';
import { Feature } from '@/lib/types';
import { Sparkles, CheckCircle2, Loader2 } from 'lucide-react';
import { useSync } from '@/components/SyncContext';

/**
 * Top-of-tab "Junior" banner.
 *
 * Two modes:
 *   - mode='risk': counts at-risk features (red/yellow risk OR a
 *     version slip), summarises each in one sentence comma-joined.
 *   - mode='todos': counts features needing user action
 *     (canCompleteNode), groups by status, summarises as
 *     "1 requires PRD walkthrough and other 5 are pending PRD/Design Prep".
 *     Shows a "Complete all" button next to Dismiss.
 *
 * Dismissible per-day (Asia/Singapore) — banner reappears the next
 * day. Each mode uses a separate localStorage key.
 */

type Mode = 'risk' | 'todos';

interface Props {
  mode: Mode;
  features: Feature[];
  /** Required when mode='todos'. Triggers handleComplete for every
   *  todo in turn. */
  onCompleteAll?: () => Promise<void> | void;
  /** Disabled state for the "Complete all" action (e.g. while a
   *  bulk run is in flight). */
  completeAllRunning?: boolean;
}

const STORAGE_KEYS: Record<Mode, string> = {
  risk:  'hamlet_junior_brief_risk_dismissed_date',
  todos: 'hamlet_junior_brief_todos_dismissed_date',
};

function todayKey(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
}

export function JuniorBrief({ mode, features, onCompleteAll, completeAllRunning }: Props) {
  const { refreshCronLastRunAt, lastSyncedAt } = useSync();

  // Pick the right feature subset for the mode.
  const items = useMemo(() => {
    if (mode === 'risk') {
      return features
        .filter(f => f.status !== 'Done' && f.status !== '已完成')
        .filter(f => f.riskLevel === 'red'
          || f.riskLevel === 'yellow'
          || (f.versionChanges && f.versionChanges.length > 0));
    }
    // todos
    return features.filter(f =>
      f.canCompleteNode === true
      && f.status !== 'Done'
      && f.status !== '已完成'
    );
  }, [mode, features]);

  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setDismissed(localStorage.getItem(STORAGE_KEYS[mode]) === todayKey());
  }, [mode]);

  function dismiss() {
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEYS[mode], todayKey());
    }
    setDismissed(true);
  }

  if (items.length === 0 || dismissed) return null;

  // Lead text + body summary.
  let lead: string;
  let summary: string;
  if (mode === 'risk') {
    // Split items into "new since yesterday" (most-recent transition
    // into red/yellow OR a fresh version slip in the last 36h) vs
    // "ongoing" (already at-risk in earlier briefs). The 36h window
    // covers a Mon→Tue overnight gap and the 12h between the two
    // refresh-feature-cache cron runs.
    const NEW_WINDOW_MS = 36 * 60 * 60 * 1000;
    const cutoff = Date.now() - NEW_WINDOW_MS;
    const isNewlyFlagged = (f: Feature): boolean => {
      const lastRisk = (f.riskHistory ?? []).slice(-1)[0];
      if (lastRisk && (lastRisk.to === 'red' || lastRisk.to === 'yellow')) {
        const ts = lastRisk.iso ? Date.parse(lastRisk.iso) : Date.parse(`${lastRisk.date}T00:00:00+08:00`);
        if (Number.isFinite(ts) && ts >= cutoff) return true;
      }
      const lastSlip = (f.versionChanges ?? []).slice(-1)[0];
      if (lastSlip) {
        const ts = lastSlip.iso ? Date.parse(lastSlip.iso) : Date.parse(`${lastSlip.date}T00:00:00+08:00`);
        if (Number.isFinite(ts) && ts >= cutoff) return true;
      }
      return false;
    };
    const newItems = items.filter(isNewlyFlagged);
    const ongoingItems = items.filter(f => !isNewlyFlagged(f));

    // Per-feature one-liner — short cause without echoing the whole
    // banner verbatim. Drops the trailing period; sentence joining
    // adds them back.
    const oneLiner = (f: Feature): string => {
      const slip = (f.versionChanges ?? []).slice(-1)[0];
      if (slip) {
        const reason = slip.reason || (f.riskNotes ?? [])[0];
        return reason
          ? `${f.name} slipped ${slip.from} → ${slip.to} — ${reason.charAt(0).toLowerCase() + reason.slice(1)}`
          : `${f.name} slipped ${slip.from} → ${slip.to}`;
      }
      const note = (f.riskNotes ?? [])[0];
      if (note) return `${f.name} — ${note.charAt(0).toLowerCase() + note.slice(1)}`;
      return `${f.name} flagged at risk`;
    };

    if (newItems.length > 0) {
      // Lead with the count of new things since yesterday.
      lead = `${newItems.length} new since yesterday.`;
      const NEW_INLINE_CAP = 3;
      const shown = newItems.slice(0, NEW_INLINE_CAP).map(oneLiner);
      const overflow = newItems.length - shown.length;
      const newSentence = shown.join('. ') + (overflow > 0 ? `. +${overflow} more new` : '') + '.';
      summary = newSentence + (ongoingItems.length > 0
        ? ` ${ongoingItems.length} ongoing from earlier this week.`
        : '');
    } else {
      // No new escalations — the brief is just a "still active"
      // reminder. Keep it short; the user already knows the details.
      lead = `${ongoingItems.length} feature${ongoingItems.length === 1 ? '' : 's'} still at risk.`;
      summary = 'Same situations from earlier this week — no fresh activity.';
    }
  } else {
    lead = `${items.length} feature${items.length === 1 ? '' : 's'} need${items.length === 1 ? 's' : ''} your attention.`;
    // Group by current status, build one phrase per status.
    const byStatus = new Map<string, number>();
    for (const f of items) {
      const k = f.status || 'unknown';
      byStatus.set(k, (byStatus.get(k) ?? 0) + 1);
    }
    const phrases = [...byStatus.entries()].map(([status, count]) => {
      const verb = count === 1 ? 'requires' : 'are pending';
      return `${count} ${verb} ${status}`;
    });
    // Join: 1 phrase as-is, 2 phrases with " and ", 3+ with Oxford comma.
    if (phrases.length === 1) {
      summary = phrases[0] + '.';
    } else if (phrases.length === 2) {
      summary = `${phrases[0]} and ${phrases[1]}.`;
    } else {
      summary = `${phrases.slice(0, -1).join(', ')}, and ${phrases.at(-1)}.`;
    }
  }

  // "Generated Xm ago" — pick the freshest of the cron run + last sync.
  const generatedIso = [refreshCronLastRunAt, lastSyncedAt]
    .filter((s): s is string => !!s && Number.isFinite(new Date(s).getTime()))
    .sort()
    .pop() ?? null;

  return (
    <div
      className="mx-5 mt-4 px-4 py-3.5 rounded-[var(--r-lg)] border flex items-start gap-3.5"
      style={{
        background: 'linear-gradient(135deg, var(--ai-soft), oklch(0.74 0.14 295 / 0.06))',
        borderColor: 'oklch(0.55 0.13 var(--ai-h) / 0.25)',
      }}
    >
      <span
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-[var(--bg)] font-mono text-[9.5px] uppercase tracking-[0.1em] shrink-0 border"
        style={{ color: 'var(--ai)', borderColor: 'oklch(0.55 0.13 var(--ai-h) / 0.3)' }}
      >
        <Sparkles className="w-2.5 h-2.5" />
        Junior
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-[12.5px] leading-[1.5] text-[var(--text)]">
          <span className="font-medium" style={{ color: 'var(--ai)' }}>{lead}</span>{' '}
          {summary}
        </div>
        {generatedIso && (
          <div className="font-mono text-[10px] text-[var(--text-muted)] mt-1">
            Generated {formatRel(generatedIso)}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <button onClick={dismiss} className="hm-btn">Dismiss</button>
        {mode === 'todos' && onCompleteAll && (
          <button
            onClick={() => { void onCompleteAll(); }}
            disabled={completeAllRunning}
            className="hm-btn hm-btn-ai"
          >
            {completeAllRunning
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <CheckCircle2 className="w-3.5 h-3.5" />}
            Complete all
          </button>
        )}
      </div>
    </div>
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
