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

export interface CronJobDef {
  id: string;
  name: string;
  description: string;
  /** Cron expression in the job's timezone (display + edit). */
  schedule: string;
  /** Time-of-day in the job's timezone, e.g. "10am SGT". */
  scheduleTime: string;
  /** Frequency, e.g. "Weekdays" / "Daily" / "Mondays". */
  scheduleFrequency: string;
  /** Where the message lands, in plain English. */
  target: string;
  kind: CronKind;
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
  | 'compliance';      // Compliance review chat

export interface CronDestination {
  kind: CronDestinationKind;
  label: string;
}

const HAMLET_DAILY = 'hamlet-daily-digest';
const REFRESH_FEATURE_CACHE = 'refresh-feature-cache';

export const CRON_REGISTRY: CronJobDef[] = [
  // ── Cloud Scheduler jobs ──────────────────────────────────────────────────
  {
    id: REFRESH_FEATURE_CACHE,
    name: 'Refresh feature cache',
    description:
      'Pulls Meego state for every PM-owned feature, detects status transitions + PRD changes, ' +
      'updates the GCS feature cache and writes feature-snapshots.json. Queues per-section cards ' +
      'into DigestState. Sends NO cards itself — the per-section crons below send.',
    schedule: '0 0,10 * * *',
    scheduleTime: '8am/6pm SGT',
    scheduleFrequency: 'Daily',
    target: 'GCS cache + DigestState queues',
    kind: 'cloud_scheduler',
    cloudSchedulerJobId: REFRESH_FEATURE_CACHE,
    cloudSchedulerService: 'hamlet',
    destinations: [],
  },
  {
    id: HAMLET_DAILY,
    name: 'Hamlet — Daily digest (legacy)',
    description:
      'Legacy bundled run kept for manual triggers. Sub-sections now have their own crons; ' +
      'this fires the unified pipeline (data fetch + every card) end-to-end.',
    schedule: '0 14 * * 1-5',
    scheduleTime: '10am SGT',
    scheduleFrequency: 'Weekdays',
    target: 'Personal digest chat (oc_d1f9b0ad…)',
    kind: 'cloud_scheduler',
    cloudSchedulerJobId: HAMLET_DAILY,
    cloudSchedulerService: 'hamlet',
    destinations: [{ kind: 'team_thomas', label: 'Team Thomas' }],
  },
  {
    id: 'poll-prd-ready',
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
    destinations: [
      { kind: 'team_thomas', label: 'Team Thomas' },
      { kind: 'compliance', label: 'Compliance' },
    ],
  },

  // ── Per-section digest crons ──────────────────────────────────────────────
  // Each is its own Cloud Scheduler job hitting POST /api/digests/section/<id>.
  // Refresh-feature-cache (above) populates queues / snapshots; these consume.
  {
    id: 'digest.risk',
    name: 'Daily risk digest',
    description:
      'For each in-flight feature, runs a Gemini risk evaluation over the last 24h of chat + ' +
      'Meego comments and surfaces anything flagged 🔴 / 🟡 in a single aggregate card.',
    schedule: '0 14 * * 1-5',
    scheduleTime: '10am SGT',
    scheduleFrequency: 'Weekdays',
    target: 'Personal digest chat',
    kind: 'cloud_scheduler',
    cloudSchedulerJobId: 'digest-risk',
    cloudSchedulerService: 'hamlet',
    sectionKey: 'risk',
    destinations: [{ kind: 'team_thomas', label: 'Team Thomas' }],
  },
  {
    id: 'digest.prd_changes',
    name: 'PRD change-log digest',
    description:
      'Sends the queue of PRD changes detected by the refresh job (Gemini-summarised diffs ' +
      'appended to each PRD\'s Change Log section).',
    schedule: '0 14 * * 1-5',
    scheduleTime: '10am SGT',
    scheduleFrequency: 'Weekdays',
    target: 'Personal digest chat',
    kind: 'cloud_scheduler',
    cloudSchedulerJobId: 'digest-prd-changes',
    cloudSchedulerService: 'hamlet',
    sectionKey: 'prd_changes',
    destinations: [
      { kind: 'team_thomas', label: 'Team Thomas' },
      { kind: 'feature_group', label: 'Feature group' },
    ],
  },
  {
    id: 'digest.unanswered',
    name: 'Outstanding Q&A digest',
    description:
      'Scans chat @-mentions of the owner + open PRD comment threads for questions Thomas hasn\'t ' +
      'addressed yet. Asks Gemini to gate "is this actually a question?" and surfaces only the real ones.',
    schedule: '0 14 * * 1-5',
    scheduleTime: '10am SGT',
    scheduleFrequency: 'Weekdays',
    target: 'Personal digest chat',
    kind: 'cloud_scheduler',
    cloudSchedulerJobId: 'digest-unanswered',
    cloudSchedulerService: 'hamlet',
    sectionKey: 'unanswered',
    destinations: [
      { kind: 'team_thomas', label: 'Team Thomas' },
      { kind: 'feature_group', label: 'Feature group' },
    ],
  },
  {
    id: 'digest.ab_open',
    name: 'AB-open digest',
    description:
      'Sends the queue of features whose Meego status transitioned to 实验中 (AB Testing) ' +
      'since the last refresh. One aggregate card with per-feature Send-to-PM-Group + Edit buttons.',
    schedule: '0 14 * * 1-5',
    scheduleTime: '10am SGT',
    scheduleFrequency: 'Weekdays',
    target: 'Personal digest chat',
    kind: 'cloud_scheduler',
    cloudSchedulerJobId: 'digest-ab-open',
    cloudSchedulerService: 'hamlet',
    sectionKey: 'ab_open',
    destinations: [
      { kind: 'team_thomas', label: 'Team Thomas' },
      { kind: 'progress_update', label: 'Progress update' },
    ],
  },
  {
    id: 'digest.ab_concluded',
    name: 'AB-concluded digest',
    description:
      'For each feature chat where an "AB Brief" calendar invite has landed, drafts an AB-concluded ' +
      'card via Gemini (results summary + Next Steps from the AB report) for review + Send-to-PM-Group.',
    schedule: '0 14 * * 1-5',
    scheduleTime: '10am SGT',
    scheduleFrequency: 'Weekdays',
    target: 'Personal digest chat',
    kind: 'cloud_scheduler',
    cloudSchedulerJobId: 'digest-ab-concluded',
    cloudSchedulerService: 'hamlet',
    sectionKey: 'ab_concluded',
    destinations: [
      { kind: 'team_thomas', label: 'Team Thomas' },
      { kind: 'progress_update', label: 'Progress update' },
    ],
  },
  {
    id: 'digest.line_review',
    name: 'Line Review (PRD Ready) cards',
    description:
      'Sends the queue of features whose Meego status just transitioned to 待线内评审 ' +
      '(Line Review). One feature card per transition, sent to the feature\'s group chat.',
    schedule: '0 14 * * 1-5',
    scheduleTime: '10am SGT',
    scheduleFrequency: 'Weekdays',
    target: 'Per-feature group chat',
    kind: 'cloud_scheduler',
    cloudSchedulerJobId: 'digest-line-review',
    cloudSchedulerService: 'hamlet',
    sectionKey: 'line_review',
    destinations: [{ kind: 'feature_group', label: 'Feature group' }],
  },
];

export function getCronById(id: string): CronJobDef | undefined {
  return CRON_REGISTRY.find(c => c.id === id);
}
