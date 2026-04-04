export type Status = string;

export type Priority = 'P0' | 'P1' | 'P2' | 'P3';

export interface Task {
  id: string;
  text: string;
  completed: boolean;
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
  iosPackageQrUrl?: string;
  iosPackageDownloadUrl?: string;
  commentSummary?: string;
  chatId?: string;
  avatars?: Record<string, string>;
  agents?: string[];
  agentLastRun?: string;
}
