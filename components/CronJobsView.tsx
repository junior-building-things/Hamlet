'use client';
import { useState, useEffect, useCallback } from 'react';
import { Loader2, Play, Pause, PlayCircle, Search } from 'lucide-react';
import { toast } from 'sonner';
import { TIME_OPTIONS, FREQUENCY_OPTIONS } from '@/lib/cron-expr';
import { MetaSelect } from '@/components/MetaCard';
import { ServiceTag, stripServicePrefix } from '@/components/ServiceTag';

type CronKind = 'cloud_scheduler' | 'digest_section';
type CronService = 'hamlet' | 'junior' | 'rio' | 'mia';
type CronDestinationKind = 'team_thomas' | 'progress_update' | 'feature_group' | 'compliance' | 'hamlet';
interface CronDestination { kind: CronDestinationKind; label: string }
interface CronJob {
  id: string;
  name: string;
  service: CronService;
  description: string;
  schedule: string;
  scheduleTime: string;
  scheduleFrequency: string;
  target: string;
  kind: CronKind;
  runsInJob?: boolean;
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

export function CronJobsView() {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | CronService>('all');
  const [search, setSearch] = useState('');

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

  const filtered = ordered.filter(j => {
    if (filter !== 'all' && j.service !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!j.name.toLowerCase().includes(q) && !j.id.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="shrink-0 px-5 py-4 border-b border-[var(--hairline)]">
        <div className="text-[18px] font-semibold text-[var(--text)] tracking-[-0.02em]">Cron Jobs</div>
        <div className="text-[12px] text-[var(--text-muted)] mt-0.5">
          Scheduled jobs and digest sub-sections. Toggle pause to skip a job; trigger to fire it now.
        </div>
      </div>

      {/* Toolbar — search + service filter chips (mirrors System Prompts) */}
      <div className="shrink-0 px-5 py-3 border-b border-[var(--hairline)] flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-2 bg-[var(--bg-elev-2)] border border-[var(--hairline)] rounded-[var(--r-sm)] px-3 h-[30px] w-[240px] shrink-0">
          <Search className="w-3.5 h-3.5 text-[var(--text-dim)] shrink-0" />
          <input
            type="text"
            placeholder="Search cron jobs…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="bg-transparent text-[12px] text-[var(--text)] placeholder-[var(--text-dim)] outline-none w-full"
          />
          <span className="font-mono text-[9.5px] text-[var(--text-dim)] px-1 py-px rounded border border-[var(--hairline)]">⌘K</span>
        </div>
        {(['all', 'hamlet', 'junior', 'rio', 'mia'] as const).map(s => {
          const active = filter === s;
          return (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`inline-flex items-center h-7 px-2.5 rounded-[var(--r-sm)] border text-[11.5px] font-mono uppercase tracking-[0.04em] transition-colors ${
                active
                  ? 'bg-[var(--bg-elev-3)] border-[var(--hairline-strong)] text-[var(--text)]'
                  : 'bg-[var(--bg-elev-2)] border-[var(--hairline)] text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--hairline-strong)]'
              }`}
            >
              {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          );
        })}
        <span className="ml-auto font-mono text-[10.5px] uppercase tracking-[0.08em] text-[var(--text-dim)]">
          {filtered.length} job{filtered.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 pb-16">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3 text-gray-500">
            <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center text-[12px] text-[var(--text-muted)] py-12">
            {ordered.length === 0 ? 'No cron jobs registered.' : 'No jobs match.'}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {filtered.map(j => (
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
    // No confirm dialog, no success toast — the sidebar's "Junior is
    // working" status card now provides the visual feedback. We still
    // surface errors via toast.
    setBusy(true);
    // Tell JuniorStatusCard a manual run just kicked off so it can
    // refetch + fast-poll immediately. Dispatched BEFORE awaiting the
    // trigger response — fast cron handlers (queue drains) can finish
    // before the trigger fetch resolves, so we'd otherwise miss the
    // working window entirely.
    window.dispatchEvent(new CustomEvent('cron:triggered', { detail: { id: job.id } }));
    try {
      const res = await fetch(`/api/crons/${job.id}/trigger`, { method: 'POST' });
      const data = await res.json() as { ok?: boolean; status?: number; note?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Trigger failed');
      if (data.note) toast.success(data.note);
      onChange();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Trigger failed');
    } finally {
      setBusy(false);
    }
  }

  // Job-backed crons are dispatched by one Scheduler entry that runs the
  // whole batch pass, so an individual card's schedule isn't editable here
  // (the PUT route rejects it).
  const editable = job.kind === 'cloud_scheduler' && !job.runsInJob;

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
        <span className="text-[13px] font-medium text-[var(--text)]">{stripServicePrefix(job.name)}</span>
        <ServiceTag service={job.service} />
        {job.paused && <span className="meta-tag tone-paused">Paused</span>}
        {/* Destination badges removed per design — destinations are
            implicit from the job's name + description. */}
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
        {job.runsInJob ? (
          <span className="meta-note" style={{ marginLeft: 0 }} title="Runs in the hamlet-digests Cloud Run Job as part of one batch pass — schedule is set on the hamlet-daily-digest Scheduler entry">
            ☁ Batch job · {job.scheduleFrequency} · {job.scheduleTime}
          </span>
        ) : (
          <>
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
          </>
        )}
        <span className="meta-note">Last run: {formatRelativeTime(job.lastAttemptTime)}</span>
      </div>
    </div>
  );
}
