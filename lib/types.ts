export type Status =
  | 'Discovery'
  | 'Design'
  | 'Development'
  | 'AB Testing'
  | 'Launched'
  | 'On Hold';

export type Priority = 'Critical' | 'High' | 'Medium' | 'Low';

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
  // Meego integration
  meegoUrl?: string;
  meegoProjectKey?: string;
  meegoIssueId?: string;
}
