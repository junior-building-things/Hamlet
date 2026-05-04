'use client';
import { useState, useEffect, useCallback } from 'react';
import { Loader2, Play, Pause, PlayCircle } from 'lucide-react';
import { toast } from 'sonner';
import { TIME_OPTIONS, FREQUENCY_OPTIONS } from '@/lib/cron-expr';
import { MetaSelect } from '@/components/MetaCard';

type CronKind = 'cloud_scheduler' | 'digest_section';
type CronDestinationKind = 'team_thomas' | 'progress_update' | 'feature_group' | 'compliance' | 'hamlet';
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

function DestinationBadge({ dest }: { dest: CronDestination }) {
  // Per the design: leading colored dot via ::before, no icon image.
  return <span className={`meta-tag tone-${dest.kind}`}>{dest.label}</span>;
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

  // Display order is hand-curated: refresh first, then sections roughly in
  // their workflow order (line review → AB → PRD changes → Q&A → risk),
  // with the legacy bundled run last. Ids not in this list fall through
  // alphabetically so a new job doesn't disappear silently.
  const ORDER: string[] = [
    'refresh-feature-cache',
    'digest.line_review',
    'poll-prd-ready',
    'digest.ab_open',
    'digest.ab_concluded',
    'digest.prd_changes',
    'digest.unanswered',
    'digest.risk',
    'hamlet-daily-digest',
  ];
  const orderIndex = (id: string) => {
    const i = ORDER.indexOf(id);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  const ordered = [...jobs].sort((a, b) => {
    const ai = orderIndex(a.id), bi = orderIndex(b.id);
    if (ai !== bi) return ai - bi;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="shrink-0 px-5 py-4 border-b border-[var(--hairline)]">
        <div className="text-[18px] font-semibold text-[var(--text)] tracking-[-0.02em]">Cron Jobs</div>
        <div className="text-[12px] text-[var(--text-muted)] mt-0.5">
          Scheduled jobs and digest sub-sections. Toggle pause to skip a job; trigger to fire it now.
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 pb-16">
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

  const editable = job.kind === 'cloud_scheduler';

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
    <div className={`meta-card ${job.paused ? 'paused' : ''}`}>
      {/* Head: name + tags + actions */}
      <div className="flex items-center gap-2.5 flex-wrap">
        <span className="text-[13px] font-medium text-[var(--text)]">{job.name}</span>
        {job.paused && <span className="meta-tag tone-paused">Paused</span>}
        {(job.destinations ?? []).map(d => (
          <DestinationBadge key={d.kind} dest={d} />
        ))}
        <div className="ml-auto flex items-center gap-1.5">
          <button onClick={togglePause} disabled={busy} className="hm-btn">
            {busy
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : (job.paused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />)}
            {job.paused ? 'Resume' : 'Pause'}
          </button>
          <button onClick={triggerOnce} disabled={busy} className="hm-btn hm-btn-ai">
            {busy
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <PlayCircle className="w-3.5 h-3.5" />}
            Trigger once
          </button>
        </div>
      </div>

      {/* Description */}
      <div className="text-[11.5px] text-[var(--text-muted)] leading-[1.45]">{job.description}</div>

      {/* Meta row: send time + frequency + last-run note */}
      <div className="meta-row">
        <MetaSelect
          label="Send time"
          value={job.scheduleTime}
          options={TIME_OPTIONS}
          disabled={!editable || busy}
          title={editable ? 'Change send time' : `Inherits from ${job.parentCronId}`}
          onChange={v => updateSchedule('scheduleTime', v)}
        />
        <MetaSelect
          label="Frequency"
          value={job.scheduleFrequency}
          options={FREQUENCY_OPTIONS}
          disabled={!editable || busy}
          title={editable ? 'Change frequency' : `Inherits from ${job.parentCronId}`}
          onChange={v => updateSchedule('scheduleFrequency', v)}
        />
        <span className="meta-note">Last run: {formatRelativeTime(job.lastAttemptTime)}</span>
      </div>
    </div>
  );
}
