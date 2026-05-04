export type Status = string;

export type Priority = 'P0' | 'P1' | 'P2' | 'P3';

export interface Task {
  id: string;
  text: string;
  completed: boolean;
}

/** Comment on a Meego ticket (from list_workitem_comments). */
export interface MeegoComment {
  /** Author display name. */
  author: string;
  /** Plain-text content (HTML/markdown stripped). */
  content: string;
  /** ISO date string (YYYY-MM-DD) of the comment's creation time. */
  createdAt: string;
}

export interface Feature {
  id: string;
  name: string;
  description: string;
  status: Status;
  priority: Priority;
  owner: string;
  tasks: Task[];
  lastUpdated: string;
  prd?: string;
  figmaUrl?: string;
  complianceUrl?: string;
  canCompleteNode?: boolean;
  // Meego integration
  meegoUrl?: string;
  meegoProjectKey?: string;
  meegoIssueId?: string;
  meegoNodeKey?: string;
  // Detail fields (populated by per-card sync)
  quarterlyCycle?: string;
  businessLine?: string;
  socialComponent?: string;
  pmOwner?: string;
  tpmOwner?: string;
  techOwner?: string;
  iosOwner?: string;
  androidOwner?: string;
  serverOwner?: string;
  qaOwner?: string;
  daOwner?: string;
  uiuxOwner?: string;
  contentDesigner?: string;
  iosVersion?: string;
  versionHistory?: string[];
  abReportUrl?: string;
  libraUrl?: string;
  packageQrUrl?: string;
  packageDownloadUrl?: string;
  packageName?: string;
  packageBuildTime?: string;
  iosPackageQrUrl?: string;
  iosPackageDownloadUrl?: string;
  iosPackageName?: string;
  iosPackageBuildTime?: string;
  commentSummary?: string;
  /**
   * Latest page (up to ~20) of comments on the Meego ticket itself.
   * Populated by per-feature sync and Sync All. Surfaced to Junior via
   * the Hamlet GCS cache; not displayed in the Hamlet UI.
   */
  meegoComments?: MeegoComment[];
  chatId?: string;
  avatars?: Record<string, string>;
  pocEmails?: Record<string, string>;  // name → email (for Junior @mentions)
  agents?: string[];
  agentLastRun?: string;
  // Daily risk assessment data (populated by the digest cron)
  riskLevel?: 'red' | 'yellow' | 'green';
  riskNotes?: string[];
  /**
   * Full history of planned-version changes detected from the Meego op log.
   * Each entry: { date: 'YYYY-MM-DD', from: '44.9', to: '45.0' }.
   * If non-empty, the feature is rendered with a "🔴 Delayed" risk badge
   * and the list is shown on hover (formatted as "M/D: from → to").
   *
   * `reason` is a short clause Gemini infers from the feature's recent
   * chat at the time the slip was detected (e.g. "several UAT issues").
   * Optional — older entries written before this field existed have no
   * reason. Inferred once per slip and cached for the drawer to surface
   * without re-running Gemini on every load.
   */
  versionChanges?: Array<{ date: string; from: string; to: string; reason?: string }>;
  /**
   * Chronological log of risk-level transitions detected by the daily
   * digest. Each entry records the change Junior observed between two
   * consecutive runs. Capped to the last ~20 entries; older history is
   * dropped to keep the feature cache compact. Surfaced in the feature
   * drawer's Activity section.
   *
   *   { date: 'YYYY-MM-DD', from: 'green', to: 'yellow' }
   */
  riskHistory?: Array<{ date: string; from: 'red' | 'yellow' | 'green' | 'none'; to: 'red' | 'yellow' | 'green' | 'none' }>;
  /**
   * Chronological log of PRD content updates detected by the digest.
   * Each entry is the Gemini-summarised diff that was appended to the
   * PRD's Change Log section. Capped to the last ~20.
   *
   *   { date: 'YYYY-MM-DD', summary: 'Added migration plan…' }
   */
  prdUpdates?: Array<{ date: string; summary: string }>;
  /**
   * Outstanding @-mention questions Junior surfaced in the Q&A digest.
   * Capped to the last ~10. Source is either a chat message or a PRD
   * doc comment thread. The drawer reads this for the OPEN QUESTIONS
   * callout + activity feed.
   *
   *   { date: 'YYYY-MM-DD', sender: 'Kyle', text: '@Thomas can you…',
   *     source: 'chat', messageId: 'om_xxx' }
   */
  unansweredQuestions?: Array<{
    date: string;
    sender: string;
    text: string;
    source: 'chat' | 'prd_comment';
    messageId: string;
  }>;
  // Free-form user notes (manually entered in the Notes column)
  notes?: string;
  // Fields manually edited in the UI — protected from sync overwrites
  manualEdits?: string[];
}
