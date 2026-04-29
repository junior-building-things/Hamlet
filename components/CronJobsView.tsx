'use client';
import { useState, useEffect, useCallback } from 'react';
import { Loader2, Play, Pause, PlayCircle, Clock, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';

type CronKind = 'cloud_scheduler' | 'digest_section';
interface CronJob {
  id: string;
  name: string;
  description: string;
  schedule: string;
  scheduleHuman: string;
  target: string;
  kind: CronKind;
  cloudSchedulerJobId?: string;
  cloudSchedulerService?: string;
  sectionKey?: string;
  inheritsSchedule?: boolean;
  parentCronId?: string;
  paused: boolean;
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

  const kindBadge = job.kind === 'cloud_scheduler'
    ? { label: 'Cloud Scheduler', cls: 'bg-blue-500/15 text-blue-700 border-blue-500/30' }
    : { label: 'Digest section', cls: 'bg-purple-500/15 text-purple-700 border-purple-500/30' };
  const stateBadge = job.paused
    ? { label: 'Paused', cls: 'bg-gray-500/15 text-gray-600 border-gray-500/30' }
    : { label: 'Active', cls: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30' };

  const consoleUrl = job.kind === 'cloud_scheduler' && job.cloudSchedulerJobId
    ? `https://console.cloud.google.com/cloudscheduler/jobs/edit/asia-southeast1/${job.cloudSchedulerJobId}?project=tiktok-im`
    : '';

  return (
    <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl">
      <div className="flex items-start justify-between gap-3 px-4 py-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide border ${kindBadge.cls}`}>
              {kindBadge.label}
            </span>
            <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide border ${stateBadge.cls}`}>
              {stateBadge.label}
            </span>
            <span className="text-sm font-medium text-[var(--foreground)]">{job.name}</span>
          </div>
          <div className="text-xs text-[var(--muted)] mb-2">{job.description}</div>
          <div className="text-[11px] text-gray-500 flex items-center gap-3 flex-wrap">
            <span className="inline-flex items-center gap-1">
              <Clock className="w-3 h-3" />
              <code className="font-mono">{job.schedule}</code>
              <span className="text-gray-400">({job.scheduleHuman})</span>
              {job.inheritsSchedule && (
                <span className="text-gray-400 ml-1">— inherited from {job.parentCronId}</span>
              )}
            </span>
            <span>→ {job.target}</span>
            {consoleUrl && (
              <a href={consoleUrl} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-400 inline-flex items-center gap-1">
                <ExternalLink className="w-3 h-3" /> Edit in Cloud Console
              </a>
            )}
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
