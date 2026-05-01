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
}

const HAMLET_DAILY = 'hamlet-daily-digest';

export const CRON_REGISTRY: CronJobDef[] = [
  // ── Cloud Scheduler jobs ──────────────────────────────────────────────────
  {
    id: HAMLET_DAILY,
    name: 'Hamlet — Daily digest run',
    description:
      'Master daily run: discovers all PM-owned features, fetches Meego state, evaluates risk, ' +
      'detects PRD changes + AB transitions, scans for unanswered questions, then sends every ' +
      'enabled sub-card below to the digest target chat.',
    schedule: '0 14 * * 1-5',
    scheduleTime: '10am SGT',
    scheduleFrequency: 'Weekdays',
    target: 'Personal digest chat (oc_d1f9b0ad…)',
    kind: 'cloud_scheduler',
    cloudSchedulerJobId: HAMLET_DAILY,
    cloudSchedulerService: 'hamlet',
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
  },

  // ── Sub-sections of the daily digest ──────────────────────────────────────
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
    kind: 'digest_section',
    sectionKey: 'risk',
    inheritsSchedule: true,
    parentCronId: HAMLET_DAILY,
  },
  {
    id: 'digest.prd_changes',
    name: 'PRD change-log digest',
    description:
      'Detects PRDs that have been edited since the last snapshot, summarises what changed via ' +
      'Gemini, appends a Change Log entry to each PRD, and aggregates today\'s changes into a card.',
    schedule: '0 14 * * 1-5',
    scheduleTime: '10am SGT',
    scheduleFrequency: 'Weekdays',
    target: 'Personal digest chat',
    kind: 'digest_section',
    sectionKey: 'prd_changes',
    inheritsSchedule: true,
    parentCronId: HAMLET_DAILY,
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
    kind: 'digest_section',
    sectionKey: 'unanswered',
    inheritsSchedule: true,
    parentCronId: HAMLET_DAILY,
  },
  {
    id: 'digest.ab_open',
    name: 'AB-open digest',
    description:
      'Notifies once per feature whose Meego status transitions to 实验中 (AB Testing). One card ' +
      'per run aggregating all transitions; per-feature Send-to-PM-Group + Edit buttons.',
    schedule: '0 14 * * 1-5',
    scheduleTime: '10am SGT',
    scheduleFrequency: 'Weekdays',
    target: 'Personal digest chat',
    kind: 'digest_section',
    sectionKey: 'ab_open',
    inheritsSchedule: true,
    parentCronId: HAMLET_DAILY,
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
    kind: 'digest_section',
    sectionKey: 'ab_concluded',
    inheritsSchedule: true,
    parentCronId: HAMLET_DAILY,
  },
  {
    id: 'digest.line_review',
    name: 'Line Review (PRD Ready) cards',
    description:
      'Fires once per feature whose status transitions into 待线内评审 (Line Review). One card per ' +
      'transition sent to the feature\'s group chat with the PRD link.',
    schedule: '0 14 * * 1-5',
    scheduleTime: '10am SGT',
    scheduleFrequency: 'Weekdays',
    target: 'Per-feature group chat',
    kind: 'digest_section',
    sectionKey: 'line_review',
    inheritsSchedule: true,
    parentCronId: HAMLET_DAILY,
  },
];

export function getCronById(id: string): CronJobDef | undefined {
  return CRON_REGISTRY.find(c => c.id === id);
}
