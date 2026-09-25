/**
 * Hamlet cron-jobs registry.
 *
 * Two flavours of "job":
 *  - cloud_scheduler: an actual Google Cloud Scheduler job.
 *    Schedule + target URL live in GCP. We can pause/resume + trigger
 *    by hitting Cloud Scheduler's API.
 *  - digest_section: a sub-section of the hamlet-daily-digest run.
 *    Shares the master cron's schedule. Pause is a flag stored in
 *    GCS state.cronPaused that lib/digests.ts consults at runtime.
 *    Trigger fires /api/digests/run with a section filter.
 *
 * Adding a new digest sub-section: add an entry here AND wire the
 * pause check + section filter at the corresponding spot in
 * lib/digests.ts (search for `isCronPaused`).
 */

export type CronKind = 'cloud_scheduler' | 'digest_section';
export type CronService = 'hamlet' | 'junior' | 'rio' | 'mia';

export interface CronJobDef {
  id: string;
  name: string;
  description: string;
  /** Which agent the job is *for* (drives the Cron Jobs tab filter).
   *  Distinct from cloudSchedulerService, which only describes the
   *  Cloud Run service hosting the cron. */
  service: CronService;
  /** Cron expression in the job's timezone (display + edit). */
  schedule: string;
  /** Time-of-day in the job's timezone, e.g. "10am SGT". */
  scheduleTime: string;
  /** Frequency, e.g. "Weekdays" / "Daily" / "Mondays". */
  scheduleFrequency: string;
  /** Where the message lands, in plain English. */
  target: string;
  kind: CronKind;
   /**
   * When true, this cron is one section of the single batch pass run by
   * the `hamlet-digests` Cloud Run Job (tools/run-digests.ts), rather than
   * something Cloud Scheduler invokes over HTTP. Only the
   * `hamlet-daily-digest` Scheduler entry is ENABLED (it starts the Job);
   * every per-section Scheduler job stays PAUSED to avoid double-runs.
   *
   * So the Cron Jobs tab must NOT read pause/last-run from Cloud Scheduler
   * for these — it reads state.cronPaused / state.cronLastRun instead, and
   * "Trigger once" writes a state.cronTriggerRequests entry that the Job's
   * watch-trigger mode consumes. See app/api/crons/route.ts.
   */
  runsInJob?: boolean;
  /** For kind='cloud_scheduler': the GCP scheduler job id. */
  cloudSchedulerJobId?: string;
  /** For kind='cloud_scheduler': the Cloud Run service this fires (display). */
  cloudSchedulerService?: string;
  /** Section key used by /api/digests/run?section=<key> for kind='digest_section'. */
  sectionKey?: string;
  /** When true, the schedule is inherited from a parent and not directly editable. */
  inheritsSchedule?: boolean;
  /** The parent cron's id, when inheritsSchedule is true. */
  parentCronId?: string;
  /** Destinations the job's output ends up in. First entry is the
   *  primary (cron fires here). Additional entries indicate downstream
   *  user-action sends (Send-to-PM-Group button, Let me Reply, etc.). */
  destinations: CronDestination[];
}

export type CronDestinationKind =
  | 'team_thomas'      // Personal digest chat
  | 'progress_update'  // PM group via Send-to-PM-Group button
  | 'feature_group'    // Per-feature group chat
  | 'compliance'       // Compliance review chat
  | 'hamlet';          // Internal — writes to Hamlet's GCS state, not a chat

export interface CronDestination {
  kind: CronDestinationKind;
  label: string;
}

const HAMLET_DAILY = 'hamlet-daily-digest';

export const CRON_REGISTRY: CronJobDef[] = [
  // ── Cloud Scheduler jobs ──────────────────────────────────────────────────
  {
    id: HAMLET_DAILY,
    service: 'hamlet',
    name: 'Hamlet — Daily digest',
    description:
      'The daily batch pass: pulls Meego live and records risk, version slips and PRD change ' +
      'logs for Hamlet and Proactive updates. Sends no cards. Pausing it skips the whole pass.',
    schedule: '30 9 * * 1-5',
    scheduleTime: '9:30am SGT',
    scheduleFrequency: 'Weekdays',
    target: 'Hamlet (feature risk, version slips, PRD change logs)',
    kind: 'cloud_scheduler',
    runsInJob: true,
    cloudSchedulerJobId: HAMLET_DAILY,
    cloudSchedulerService: 'hamlet',
    destinations: [{ kind: 'hamlet', label: 'Hamlet' }],
  },
  {
    id: 'poll-prd-ready',
    service: 'junior',
    name: 'Junior — Daily PRD-ready compliance poll',
    description:
      'Polls Meego for features that just transitioned into Line Review and posts a compliance ' +
      'card asking the PM to confirm the PRD is ready for the cross-functional review.',
    schedule: '0 23 * * *',
    scheduleTime: '7am SGT',
    scheduleFrequency: 'Daily',
    target: 'Compliance review chat',
    kind: 'cloud_scheduler',
    cloudSchedulerJobId: 'poll-prd-ready',
    cloudSchedulerService: 'junior',
    destinations: [{ kind: 'team_thomas', label: 'Team Thomas' }],
  },

  // ── Per-section digest crons ──────────────────────────────────────────────
  // Each is its own Cloud Scheduler job hitting POST /api/digests/section/<id>.
  // Refresh-feature-cache (above) populates queues / snapshots; these consume.
];

export function getCronById(id: string): CronJobDef | undefined {
  return CRON_REGISTRY.find(c => c.id === id);
}

/** Ids of all crons that run inside the hamlet-digests batch Job pass. */
export const JOB_CRON_IDS: string[] = CRON_REGISTRY.filter(c => c.runsInJob).map(c => c.id);

/** The master cron. Pausing it stops the whole pass. */
export const JOB_MASTER_CRON_IDS: string[] = [HAMLET_DAILY];
