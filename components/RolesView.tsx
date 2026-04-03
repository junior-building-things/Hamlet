'use client';

import { Bot, User } from 'lucide-react';

interface Role {
  key: string;
  title: string;
  shortName: string;
  description: string;
  responsibilities: string[];
  isAgent?: boolean;
  icon?: string;
}

const ROLES: Role[] = [
  {
    key: 'pm',
    title: 'Product Manager',
    shortName: 'PM',
    description: 'Owns the feature end-to-end from ideation to launch. Defines requirements, writes the PRD, and coordinates cross-functional stakeholders.',
    responsibilities: [
      'Write and maintain the PRD',
      'Define acceptance criteria and success metrics',
      'Coordinate timelines across engineering, design, and QA',
      'Run feature reviews and sign off on launch readiness',
      'Track AB experiment results and make go/no-go decisions',
    ],
  },
  {
    key: 'tpm',
    title: 'Technical Program Manager',
    shortName: 'TPM',
    description: 'Manages cross-team dependencies, schedules, and risk tracking. Ensures the feature ships on time across all workstreams.',
    responsibilities: [
      'Build and maintain the project timeline',
      'Identify and escalate cross-team blockers',
      'Run weekly syncs and publish status updates',
      'Coordinate launch readiness across platform teams',
      'Track dependency deliverables from partner teams',
    ],
  },
  {
    key: 'tech',
    title: 'Tech Owner',
    shortName: 'Tech Owner',
    description: 'Leads the technical design and architecture. Makes key engineering decisions and ensures code quality across client and server.',
    responsibilities: [
      'Author the technical design document',
      'Review and approve all pull requests for the feature',
      'Define the AB experiment setup and feature flags',
      'Coordinate between iOS, Android, and Server engineers',
      'Identify technical risks and propose mitigations',
    ],
  },
  {
    key: 'ios',
    title: 'iOS Engineer',
    shortName: 'iOS',
    description: 'Implements the feature on the iOS TikTok client. Handles UI, business logic, and platform-specific integration.',
    responsibilities: [
      'Implement the feature per the technical design',
      'Write unit and UI tests for iOS',
      'Handle iOS-specific edge cases (permissions, lifecycle)',
      'Submit code for review and address feedback',
      'Support QA with test builds and bug fixes',
    ],
  },
  {
    key: 'android',
    title: 'Android Engineer',
    shortName: 'Android',
    description: 'Implements the feature on the Android TikTok client. Handles UI, business logic, and platform-specific integration.',
    responsibilities: [
      'Implement the feature per the technical design',
      'Write unit and UI tests for Android',
      'Handle Android-specific edge cases (fragmentation, permissions)',
      'Submit code for review and address feedback',
      'Support QA with test builds and bug fixes',
    ],
  },
  {
    key: 'server',
    title: 'Server Engineer',
    shortName: 'Server',
    description: 'Builds and maintains the backend services, APIs, and data pipelines required by the feature.',
    responsibilities: [
      'Design and implement API endpoints',
      'Set up data storage, caching, and indexing',
      'Ensure service reliability, monitoring, and alerting',
      'Deploy server changes and manage rollout',
      'Support client engineers with API integration',
    ],
  },
  {
    key: 'qa',
    title: 'QA Engineer',
    shortName: 'QA',
    description: 'Validates the feature meets requirements through manual and automated testing. Owns the test plan and regression coverage.',
    responsibilities: [
      'Write and execute the test plan',
      'Perform regression testing before launch',
      'File and track bugs with reproduction steps',
      'Verify bug fixes and sign off on build quality',
      'Automate critical test paths',
    ],
  },
  {
    key: 'uiux',
    title: 'UX Designer',
    shortName: 'UX Designer',
    description: 'Designs the user interface and interaction flow. Delivers specs, prototypes, and final assets for engineering.',
    responsibilities: [
      'Create wireframes and high-fidelity mockups',
      'Define interaction patterns and micro-animations',
      'Conduct design reviews with PM and engineering',
      'Deliver final assets and redline specs',
      'Perform UI/UX acceptance on the built feature',
    ],
  },
  {
    key: 'da',
    title: 'Data Scientist',
    shortName: 'DS',
    description: 'Defines event tracking, sets up dashboards, and analyzes experiment data to inform feature decisions.',
    responsibilities: [
      'Define the event tracking plan',
      'Validate tracking implementation with engineering',
      'Set up experiment dashboards and metrics',
      'Analyze AB test results and provide recommendations',
      'Monitor post-launch metrics and flag anomalies',
    ],
  },
  {
    key: 'content',
    title: 'Content Designer',
    shortName: 'Content Designer',
    description: 'Crafts all user-facing copy including UI strings, error messages, tooltips, and localization-ready text.',
    responsibilities: [
      'Write UI copy, labels, and error messages',
      'Ensure copy is consistent with product voice and tone',
      'Provide localization-ready strings',
      'Review copy in context during UI/UX acceptance',
      'Collaborate with legal on compliance-sensitive wording',
    ],
  },
  {
    key: 'rd-assistant',
    title: 'RD Assistant',
    shortName: 'RD Agent',
    description: 'An AI agent that monitors the Meego group chat for the project. Follows up on unanswered questions from engineering POCs to QA or PM — for example, if a PM doesn\'t respond to a question, the agent will tag them again later.',
    isAgent: true,
    icon: '/rd_assistant.png',
    responsibilities: [
      'Monitor the feature group chat for unanswered questions',
      'Follow up with PM or QA if they haven\'t responded',
      'Escalate blocked threads after repeated non-response',
      'Summarize daily engineering blockers for the PM',
      'Track action items mentioned in chat and flag overdue ones',
    ],
  },
  {
    key: 'pm-assistant',
    title: 'PM Assistant',
    shortName: 'PM Agent',
    description: 'An AI agent that assists the PM by monitoring project progress from the PM perspective. Flags when milestones are missed — for example, if a feature was supposed to merge today but the Meego status hasn\'t been updated.',
    isAgent: true,
    icon: '/pm_assistant.png',
    responsibilities: [
      'Monitor Meego workflow nodes for stale or overdue transitions',
      'Alert PM when expected milestones are missed',
      'Flag features stuck in a workflow node too long',
      'Nudge engineers to update Meego status after code merges',
      'Generate weekly progress summaries for the PM',
    ],
  },
];

export function RolesView() {
  const humanRoles = ROLES.filter(r => !r.isAgent);
  const agentRoles = ROLES.filter(r => r.isAgent);

  return (
    <div className="max-w-6xl mx-auto">
      <div className="px-6 pt-7 pb-2">
        <h1 className="text-2xl text-white" style={{ fontFamily: 'var(--font-newsreader)' }}>
          R&R
        </h1>
        <p className="text-sm text-gray-500 mt-1">Each feature involves the following roles</p>
      </div>

      <div className="px-6 pb-6">

      {/* Human roles */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-8">
        {humanRoles.map(role => (
          <RoleCard key={role.key} role={role} />
        ))}
      </div>

      {/* Agent roles */}
      <h2 className="text-lg font-semibold text-white mb-1 flex items-center gap-2">
        <Bot className="w-5 h-5 text-purple-400" />
        AI Agents
      </h2>
      <p className="text-sm text-gray-400 mb-4">
        Automated assistants that help keep the project on track.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {agentRoles.map(role => (
          <RoleCard key={role.key} role={role} />
        ))}
      </div>
      </div>
    </div>
  );
}

function RoleCard({ role }: { role: Role }) {
  return (
    <div className={`bg-[#13162a] border rounded-xl p-5 flex flex-col gap-3 ${
      role.isAgent ? 'border-purple-500/30' : 'border-[#1e2240]'
    }`}>
      <div className="flex items-center gap-2.5">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold ${
          role.isAgent
            ? 'bg-purple-500/20 text-purple-300'
            : 'bg-blue-500/20 text-blue-300'
        }`}>
          {role.icon
            ? <img src={role.icon} alt={role.title} className="w-6 h-6 object-contain" />
            : role.isAgent ? <Bot className="w-4 h-4" /> : <User className="w-4 h-4" />}
        </div>
        <div>
          <h3 className="text-sm font-semibold text-white">{role.title}</h3>
          <span className="text-[11px] text-gray-500">{role.shortName}</span>
        </div>
      </div>

      <p className="text-xs text-gray-400 leading-relaxed">{role.description}</p>

      <ul className="flex flex-col gap-1.5">
        {role.responsibilities.map((r, i) => (
          <li key={i} className="text-xs text-gray-300 flex items-start gap-2">
            <span className="text-gray-600 mt-0.5 shrink-0">•</span>
            {r}
          </li>
        ))}
      </ul>
    </div>
  );
}
