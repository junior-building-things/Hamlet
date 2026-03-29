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
  tpmOwner?: string;
  iosOwner?: string;
  androidOwner?: string;
  serverOwner?: string;
  qaOwner?: string;
  daOwner?: string;
  uiuxOwner?: string;
  contentDesigner?: string;
}
