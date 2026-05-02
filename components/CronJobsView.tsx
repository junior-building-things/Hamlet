'use client';
import { useState, useEffect, useCallback } from 'react';
import { Loader2, Play, Pause, PlayCircle, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { TIME_OPTIONS, FREQUENCY_OPTIONS } from '@/lib/cron-expr';

type CronKind = 'cloud_scheduler' | 'digest_section';
type CronDestinationKind = 'team_thomas' | 'progress_update' | 'feature_group' | 'compliance';
interface CronDestination { kind: CronDestinationKind; label: string }
interface CronJob {
  id: string;
  name: string;
  description: string;
  schedule: string;
  scheduleTime: string;
  scheduleFrequency: string;
  target: string;
  kind: CronKind;
  cloudSchedulerJobId?: string;
  cloudSchedulerService?: string;
  sectionKey?: string;
  inheritsSchedule?: boolean;
  parentCronId?: string;
  destinations: CronDestination[];
  paused: boolean;
  lastAttemptTime?: string;
}

function formatRelativeTime(iso?: string): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '—';
  const diffMs = Date.now() - then;
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}

const DESTINATION_STYLES: Record<CronDestinationKind, string> = {
  team_thomas:     'bg-blue-500/15 text-blue-700 border-blue-500/30',
  progress_update: 'bg-pink-500/15 text-pink-700 border-pink-500/30',
  feature_group:   'bg-teal-500/15 text-teal-700 border-teal-500/30',
  compliance:      'bg-orange-500/15 text-orange-700 border-orange-500/30',
};

function DestinationBadge({ dest }: { dest: CronDestination }) {
  const cls = DESTINATION_STYLES[dest.kind];
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide border ${cls}`}>
      {dest.kind === 'team_thomas' && (
        <img
          src="/team_thomas.png"
          alt=""
          className="w-3 h-3 rounded-full object-cover"
          onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
        />
      )}
      {dest.label}
    </span>
  );
}

export function CronJobsView() {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/crons');
      const data = await res.json() as { jobs?: CronJob[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Failed to load');
      setJobs(data.jobs ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load cron jobs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Group: cloud_scheduler first (top-level), then digest_section.
  const ordered = [...jobs].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'cloud_scheduler' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <div className="shrink-0 px-6 pt-7 pb-2 flex items-center justify-between">
        <div>
          <h1 className="text-2xl text-[var(--foreground)]" style={{ fontFamily: 'var(--font-newsreader)' }}>
            Cron Jobs
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Scheduled jobs and digest sub-sections. Toggle pause to skip a job; trigger to fire it now.
          </p>
        </div>
        <div aria-hidden className="invisible" />
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-16 mt-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3 text-gray-500">
            <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
          </div>
        ) : ordered.length === 0 ? (
          <div className="text-center text-sm text-gray-500 py-12">No cron jobs registered.</div>
        ) : (
          <div className="flex flex-col gap-2">
            {ordered.map(j => (
              <CronCard key={j.id} job={j} onChange={refresh} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CronCard({ job, onChange }: { job: CronJob; onChange: () => void }) {
  const [busy, setBusy] = useState(false);

  async function togglePause() {
    setBusy(true);
    try {
      const res = await fetch(`/api/crons/${job.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paused: !job.paused }),
      });
      if (!res.ok) throw new Error('Toggle failed');
      toast.success(job.paused ? `${job.name} resumed` : `${job.name} paused`);
      onChange();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Toggle failed');
    } finally {
      setBusy(false);
    }
  }

  async function triggerOnce() {
    if (!confirm(`Trigger "${job.name}" once?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/crons/${job.id}/trigger`, { method: 'POST' });
      const data = await res.json() as { ok?: boolean; status?: number; note?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Trigger failed');
      toast.success(data.note ? `Triggered (${data.note})` : `Triggered ${job.name}`);
      onChange();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Trigger failed');
    } finally {
      setBusy(false);
    }
  }

  const pausedBadgeCls = 'bg-gray-500/15 text-gray-600 border-gray-500/30';
  const editable = job.kind === 'cloud_scheduler';
  const selectCls = `text-xs bg-[var(--card-hover)] border border-[var(--border)] rounded px-2 py-1 text-[var(--foreground)] focus:outline-none disabled:opacity-60 ${editable ? 'cursor-pointer' : 'cursor-not-allowed'}`;

  async function updateSchedule(field: 'scheduleTime' | 'scheduleFrequency', value: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/crons/${job.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Update failed');
      toast.success(`${job.name} → ${value}`);
      onChange();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl">
      <div className="flex items-start justify-between gap-3 px-4 py-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-sm font-medium text-[var(--foreground)]">{job.name}</span>
            {job.paused && (
              <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide border ${pausedBadgeCls}`}>
                Paused
              </span>
            )}
            {(job.destinations ?? []).map(d => (
              <DestinationBadge key={d.kind} dest={d} />
            ))}
          </div>
          <div className="text-xs text-[var(--muted)] mb-2">{job.description}</div>
          <div className="text-[11px] text-gray-500 mb-2">Last run: {formatRelativeTime(job.lastAttemptTime)}</div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="inline-flex items-center gap-1 text-[var(--muted)]">
              <Clock className="w-3 h-3" />
              <select
                value={job.scheduleTime}
                onChange={e => updateSchedule('scheduleTime', e.target.value)}
                disabled={!editable || busy}
                title={editable ? 'Change send time' : `Inherits from ${job.parentCronId}`}
                className={selectCls}
              >
                {!TIME_OPTIONS.includes(job.scheduleTime as typeof TIME_OPTIONS[number]) && (
                  <option value={job.scheduleTime}>{job.scheduleTime}</option>
                )}
                {TIME_OPTIONS.map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <select
              value={job.scheduleFrequency}
              onChange={e => updateSchedule('scheduleFrequency', e.target.value)}
              disabled={!editable || busy}
              title={editable ? 'Change frequency' : `Inherits from ${job.parentCronId}`}
              className={selectCls}
            >
              {!FREQUENCY_OPTIONS.includes(job.scheduleFrequency as typeof FREQUENCY_OPTIONS[number]) && (
                <option value={job.scheduleFrequency}>{job.scheduleFrequency}</option>
              )}
              {FREQUENCY_OPTIONS.map(f => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          <button
            onClick={togglePause}
            disabled={busy}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg disabled:opacity-50 transition-colors ${
              job.paused
                ? 'bg-emerald-700 hover:bg-emerald-600 text-white'
                : 'bg-[var(--card-hover)] border border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)]'
            }`}
          >
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : (job.paused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />)}
            {job.paused ? 'Resume' : 'Pause'}
          </button>
          <button
            onClick={triggerOnce}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-700 hover:bg-blue-600 text-white rounded-lg disabled:opacity-40 transition-colors"
          >
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <PlayCircle className="w-3 h-3" />}
            Trigger once
          </button>
        </div>
      </div>
    </div>
  );
}
