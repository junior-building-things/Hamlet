'use client';
import { useEffect, useMemo, useState } from 'react';
import { Feature } from '@/lib/types';
import { Sparkles } from 'lucide-react';
import { useSync } from '@/components/SyncContext';

/**
 * Top-of-tab "Junior · Daily Brief" banner.
 *
 * Composes a one-glance summary from the feature cache: counts the
 * features at risk this week (red/yellow risk OR an open version
 * slip), then for each one writes a one-sentence summary like
 * `"AI Self in Mix Studio — AB Brief invite slipped 2 days"` joined
 * by commas.
 *
 * The summary is built client-side from `feature.riskNotes` /
 * `versionChanges` (both already populated by the digest pipeline).
 * If you want a richer Gemini-written summary, the digest can persist
 * one to GCS and this component can prefer that — left as a follow-up.
 *
 * Dismissible: the user can hide the banner; the dismissal is per-day
 * (Asia/Singapore), so the banner reappears the next day.
 */

interface Props {
  features: Feature[];
}

const STORAGE_KEY = 'hamlet_junior_brief_dismissed_date';

/** YYYY-MM-DD in Asia/Singapore. */
function todayKey(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
}

export function JuniorBrief({ features }: Props) {
  const { refreshCronLastRunAt, lastSyncedAt } = useSync();

  const atRisk = useMemo(() => {
    return features
      .filter(f => f.status !== 'Done' && f.status !== '已完成')
      .filter(f => f.riskLevel === 'red'
        || f.riskLevel === 'yellow'
        || (f.versionChanges && f.versionChanges.length > 0));
  }, [features]);

  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setDismissed(localStorage.getItem(STORAGE_KEY) === todayKey());
  }, []);

  function dismiss() {
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, todayKey());
    }
    setDismissed(true);
  }

  if (atRisk.length === 0 || dismissed) return null;

  // One sentence per feature: "<name> <first risk note OR slip detail>"
  const lines = atRisk.map(f => {
    const note = (f.riskNotes ?? [])[0]?.trim();
    if (note) return `${f.name} ${note.toLowerCase()}`;
    const slip = (f.versionChanges ?? []).slice(-1)[0];
    if (slip) return `${f.name} planned version slipped ${slip.from} → ${slip.to}`;
    return `${f.name} flagged at risk`;
  });
  const summary = lines.join(', ') + '.';

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
          <span className="font-medium" style={{ color: 'var(--ai)' }}>
            {atRisk.length} feature{atRisk.length === 1 ? '' : 's'} at risk this week.
          </span>{' '}
          {summary}
        </div>
        {generatedIso && (
          <div className="font-mono text-[10px] text-[var(--text-muted)] mt-1">
            Generated {formatRel(generatedIso)}
          </div>
        )}
      </div>
      <div className="shrink-0">
        <button onClick={dismiss} className="hm-btn">
          Dismiss
        </button>
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
