import { Feature } from './types';
import { readChatMessages, resolveOpenIds, sendDmByEmail, ChatMessage } from './lark';
import { syncFeatureStatus, fetchUserStories } from './meego';
import { getAgentToken } from './agents';
import { getCodeFreezeDate } from './merge-calendar';

const TIKTOK_PROJECT_KEY = '5f105019a8b9a853da64767f';

// ─── Types ────────────────────────────────────────────────────────────────

export type RiskLevel = 'red' | 'yellow' | 'green';

export interface RiskFinding {
  level: RiskLevel;
  reasons: string[];
  feature: Feature;
}

export interface UnansweredQuestion {
  senderOpenId: string;
  mentionNames: string[];
  text: string;
  messageId: string;
  timestamp: number;
}

export interface UnansweredFinding {
  feature: Feature;
  questions: UnansweredQuestion[];
}

export interface DigestRunResult {
  featuresChecked: number;
  riskSent: boolean;
  unansweredSent: boolean;
  riskFindings: RiskFinding[];
  unansweredFindings: UnansweredFinding[];
}

// ─── Status sets ──────────────────────────────────────────────────────────

// Features NOT in these statuses are considered "in development" — i.e. the digest
// excludes pre-dev (requirements) and post-dev (acceptance / done) stages.
// Allow-list approach based on lib/meego.ts NODE_TRANSLATIONS.
const NON_DEV_STATUSES = new Set<string>([
  // Pre-dev
  'Requirements Prep',
  'Initial Review',
  'Dependency Check',
  'Compliance Review',
  '产品需求准备',
  '产品线内初评',
  '依赖判断',
  '合规评估',
  // Post-dev
  'PM Acceptance',
  'PM Walkthrough',
  'Done',
  'Launched',
  'PM验收',
  'PM走查',
  '结束',
  // Placeholder / unknown
  'Unknown',
  'Syncing…',
  '',
]);

function isInDev(status: string): boolean {
  if (!status) return false;
  return !NON_DEV_STATUSES.has(status);
}

// Statuses where QA has effectively started (used to scope "not in QA yet" risk checks)
const QA_OR_LATER_STATUSES = new Set<string>([
  'QA',
  'QA Testing',
  'AB Testing',
  'UI/UX Acceptance',
  'AB实验',
  'UI&UX验收',
  'Done',
  'Launched',
  '结束',
]);

// Role fields — used for the missing-owner risk check
const REQUIRED_ROLES: Array<{ key: keyof Feature; label: string }> = [
  { key: 'pmOwner', label: 'PM' },
  { key: 'techOwner', label: 'Tech Owner' },
  { key: 'iosOwner', label: 'iOS' },
  { key: 'androidOwner', label: 'Android' },
  { key: 'serverOwner', label: 'Server' },
  { key: 'qaOwner', label: 'QA' },
];

// Stakeholder role fields used for the unanswered Q&A scan — anyone in these roles whose
// @-mention goes unanswered is surfaced in the digest
const STAKEHOLDER_ROLES: Array<keyof Feature> = [
  'pmOwner',
  'uiuxOwner',
  'techOwner',
  'iosOwner',
  'androidOwner',
  'serverOwner',
  'qaOwner',
];

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Count whole business days strictly between today and a future date. */
function businessDaysUntil(target: Date): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(target);
  end.setHours(0, 0, 0, 0);
  if (end <= today) return 0;

  let days = 0;
  const cursor = new Date(today);
  while (cursor < end) {
    cursor.setDate(cursor.getDate() + 1);
    const dow = cursor.getDay();
    if (dow !== 0 && dow !== 6) days++;
  }
  return days;
}

/** Days since the given YYYY-MM-DD date string. Returns null if unparseable. */
function daysSinceIsoDate(iso: string): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

/** Pick the highest-severity level across a list. */
function maxLevel(levels: RiskLevel[]): RiskLevel {
  if (levels.includes('red')) return 'red';
  if (levels.includes('yellow')) return 'yellow';
  return 'green';
}

// ─── Risk evaluation (Task 4) ──────────────────────────────────────────────

/**
 * Evaluate all risk checks for a single feature.
 * Returns the highest severity level across all triggered reasons, plus the list of reasons.
 */
export async function evaluateFeatureRisk(feature: Feature): Promise<RiskFinding> {
  const reasons: string[] = [];
  const levels: RiskLevel[] = [];

  const status = feature.status ?? '';
  const inQaOrLater = QA_OR_LATER_STATUSES.has(status);

  // Freeze pressure checks — only relevant when we know the target version
  if (feature.iosVersion) {
    const freezeDate = await getCodeFreezeDate(feature.iosVersion);
    if (freezeDate) {
      const days = businessDaysUntil(freezeDate);
      if (!inQaOrLater) {
        if (days <= 2) {
          reasons.push(`Code freeze in ${days} business day${days === 1 ? '' : 's'} but not yet in QA (target: v${feature.iosVersion})`);
          levels.push('red');
        } else if (days <= 5) {
          reasons.push(`Code freeze in ${days} business days and not yet in QA (target: v${feature.iosVersion})`);
          levels.push('yellow');
        }
      }
    }
  }

  // Stale check — no Meego updates in 7+ days
  const daysStale = feature.lastUpdated ? daysSinceIsoDate(feature.lastUpdated) : null;
  if (daysStale !== null && daysStale >= 7) {
    reasons.push(`No Meego updates in ${daysStale} days`);
    levels.push('red');
  }

  // Missing owner checks — only for roles that matter at the current stage
  const missingRoles: string[] = [];
  for (const { key, label } of REQUIRED_ROLES) {
    const val = (feature[key] as string | undefined)?.trim();
    if (!val) missingRoles.push(label);
  }
  if (missingRoles.length > 0) {
    reasons.push(`Missing ${missingRoles.join(', ')} owner${missingRoles.length === 1 ? '' : 's'}`);
    levels.push('yellow');
  }

  // Missing PRD
  if (!feature.prd) {
    reasons.push('PRD link not set');
    levels.push('yellow');
  }

  const level = reasons.length === 0 ? 'green' : maxLevel(levels);
  return { level, reasons, feature };
}

/** Format the risk digest as a plain-text message grouped by severity. */
export function formatRiskDigest(findings: RiskFinding[]): string {
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });

  const red = findings.filter(f => f.level === 'red');
  const yellow = findings.filter(f => f.level === 'yellow');
  const green = findings.filter(f => f.level === 'green');

  const lines: string[] = [];
  lines.push(`📊 Daily Risk Digest — ${today}`);
  lines.push('');

  if (red.length > 0) {
    lines.push(`🔴 High-risk (${red.length})`);
    for (const f of red) {
      const version = f.feature.iosVersion ? `, v${f.feature.iosVersion}` : '';
      lines.push(`• ${f.feature.name} (${f.feature.status}${version})`);
      for (const reason of f.reasons) {
        lines.push(`   · ${reason}`);
      }
    }
    lines.push('');
  }

  if (yellow.length > 0) {
    lines.push(`🟡 Watch (${yellow.length})`);
    for (const f of yellow) {
      const version = f.feature.iosVersion ? `, v${f.feature.iosVersion}` : '';
      lines.push(`• ${f.feature.name} (${f.feature.status}${version})`);
      for (const reason of f.reasons) {
        lines.push(`   · ${reason}`);
      }
    }
    lines.push('');
  }

  if (green.length > 0) {
    lines.push(`🟢 Healthy (${green.length})`);
    for (const f of green) {
      const version = f.feature.iosVersion ? `, v${f.feature.iosVersion}` : '';
      lines.push(`• ${f.feature.name} (${f.feature.status}${version}) — on track`);
    }
    lines.push('');
  }

  if (findings.length === 0) {
    lines.push('No features currently in development.');
  }

  return lines.join('\n').trim();
}

// ─── Unanswered Q&A check (Task 5) ─────────────────────────────────────────

/**
 * Scan a feature's group chat for recent stakeholder @-mentions with no reply.
 * Returns null if the feature has no chatId or no unanswered questions.
 */
export async function collectUnansweredForFeature(
  feature: Feature,
  sinceMs: number,
  token: string,
  pocEmails: Record<string, string>,
): Promise<UnansweredFinding | null> {
  if (!feature.chatId) return null;

  // Gather stakeholder emails from role fields
  const stakeholderEmails = new Set<string>();
  for (const role of STAKEHOLDER_ROLES) {
    const names = (feature[role] as string | undefined)?.split(',').map(n => n.trim()) ?? [];
    for (const name of names) {
      const email = pocEmails[name];
      if (email) stakeholderEmails.add(email);
    }
  }
  if (stakeholderEmails.size === 0) return null;

  // Resolve stakeholder emails to open_ids so we can match them against message sender IDs
  const emailToOpenId = await resolveOpenIds([...stakeholderEmails], token);
  const stakeholderOpenIds = new Set(Object.values(emailToOpenId));
  if (stakeholderOpenIds.size === 0) return null;

  // Read recent messages (newest first)
  let messages: ChatMessage[] = [];
  try {
    messages = await readChatMessages(feature.chatId, sinceMs, token);
  } catch (e) {
    console.warn(`[digests] failed to read messages for ${feature.name}:`, e);
    return null;
  }
  if (messages.length === 0) return null;

  // Keep only messages sent by stakeholders that contain @-mentions and are not thread replies
  const stakeholderMsgs = messages.filter(m => {
    const senderOpenId = m.sender?.sender_id?.open_id;
    if (!senderOpenId || !stakeholderOpenIds.has(senderOpenId)) return false;
    if (!m.mentions || m.mentions.length === 0) return false;
    if (m.parent_id) return false;
    return true;
  });
  if (stakeholderMsgs.length === 0) return null;

  // A message is "answered" if any later message in the thread references it as root/parent
  const unanswered: UnansweredQuestion[] = [];
  for (const msg of stakeholderMsgs) {
    const hasReply = messages.some(m =>
      m.root_id === msg.message_id || m.parent_id === msg.message_id
    );
    if (hasReply) continue;

    // Parse the text content (Lark wraps text in JSON)
    let text = '';
    try {
      const parsed = JSON.parse(msg.body?.content ?? '{}') as { text?: string };
      text = (parsed.text ?? '').trim();
    } catch {
      text = msg.body?.content ?? '';
    }

    // Strip @-mention placeholders from the preview (e.g. "@_user_1 how about...")
    for (const mention of msg.mentions ?? []) {
      text = text.replace(mention.key, '').trim();
    }

    unanswered.push({
      senderOpenId: msg.sender?.sender_id?.open_id ?? '',
      mentionNames: (msg.mentions ?? []).map(m => m.name),
      text: text.slice(0, 280),
      messageId: msg.message_id,
      timestamp: Number(msg.create_time ?? 0) * 1000,
    });
  }

  if (unanswered.length === 0) return null;

  // Cap to 5 per feature to keep the digest readable
  return { feature, questions: unanswered.slice(0, 5) };
}

/** Format the unanswered Q&A digest as a plain-text message grouped by feature. */
export function formatUnansweredDigest(findings: UnansweredFinding[]): string {
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
  const totalQs = findings.reduce((sum, f) => sum + f.questions.length, 0);

  const lines: string[] = [];
  lines.push(`💬 Daily Unanswered Questions — ${today}`);
  lines.push(`${totalQs} question${totalQs === 1 ? '' : 's'} across ${findings.length} feature${findings.length === 1 ? '' : 's'}`);
  lines.push('');

  for (const finding of findings) {
    lines.push(`${finding.feature.name} (${finding.feature.status})`);
    for (const q of finding.questions) {
      const time = q.timestamp > 0
        ? new Date(q.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
        : '';
      const mentioned = q.mentionNames.length > 0 ? ` → ${q.mentionNames.join(', ')}` : '';
      const preview = q.text || '(no text)';
      lines.push(`  • ${time}${mentioned}: "${preview}"`);
    }
    lines.push('');
  }

  return lines.join('\n').trim();
}

// ─── Main orchestrator ─────────────────────────────────────────────────────

/**
 * Run both daily digests against all PM-owned features.
 * Always sends the risk digest. Only sends the Q&A digest if there's content.
 */
export async function runDailyDigests(): Promise<DigestRunResult> {
  const ownerEmail = process.env.OWNER_EMAIL;
  if (!ownerEmail) throw new Error('OWNER_EMAIL not configured');

  // Fetch all PM-owned features (same path Hamlet uses on load)
  const allFeatures = await fetchUserStories(TIKTOK_PROJECT_KEY);
  console.log(`[digests] fetched ${allFeatures.length} features from Meego`);

  // Log the unique statuses we see so we can tune the allow/deny list
  const statusCounts = new Map<string, number>();
  for (const f of allFeatures) {
    statusCounts.set(f.status, (statusCounts.get(f.status) ?? 0) + 1);
  }
  const statusSummary = [...statusCounts.entries()].map(([s, n]) => `${s}:${n}`).join(', ');
  console.log(`[digests] status distribution: ${statusSummary}`);

  // Only evaluate features in an "in dev" status
  const inDevFeatures = allFeatures.filter(f => isInDev(f.status));
  console.log(`[digests] ${inDevFeatures.length} features in dev status`);

  // Enrich each feature with syncFeatureStatus() so we have owners, iosVersion, pocEmails, chatId
  const enriched: Array<{ feature: Feature; pocEmails: Record<string, string> }> = [];
  for (const feature of inDevFeatures) {
    if (!feature.meegoUrl) continue;
    try {
      const sync = await syncFeatureStatus(feature.meegoUrl, undefined, feature.chatId);
      const merged: Feature = {
        ...feature,
        status: sync.status || feature.status,
        pmOwner: sync.pmOwner,
        techOwner: sync.techOwner,
        iosOwner: sync.iosOwner,
        androidOwner: sync.androidOwner,
        serverOwner: sync.serverOwner,
        qaOwner: sync.qaOwner,
        uiuxOwner: sync.uiuxOwner,
        iosVersion: sync.iosVersion || feature.iosVersion,
        lastUpdated: sync.lastUpdated || feature.lastUpdated,
        chatId: sync.chatId || feature.chatId,
        prd: sync.prd || feature.prd,
      };
      enriched.push({ feature: merged, pocEmails: sync.pocEmails });
      // small delay to avoid hammering Meego MCP
      await new Promise(r => setTimeout(r, 500));
    } catch (e) {
      console.warn(`[digests] sync failed for ${feature.name}:`, e);
    }
  }
  console.log(`[digests] enriched ${enriched.length} features`);

  // Re-check the in-dev filter after sync (sync may update the status)
  const finalInDev = enriched.filter(e => isInDev(e.feature.status));
  console.log(`[digests] ${finalInDev.length} features still in dev after sync`);

  // Task 4: risk digest — always sent
  const riskFindings: RiskFinding[] = [];
  for (const { feature } of finalInDev) {
    try {
      const finding = await evaluateFeatureRisk(feature);
      riskFindings.push(finding);
    } catch (e) {
      console.warn(`[digests] risk eval failed for ${feature.name}:`, e);
    }
  }
  // Sort: red first, then yellow, then green; within each level keep stable order
  const severityOrder: Record<RiskLevel, number> = { red: 0, yellow: 1, green: 2 };
  riskFindings.sort((a, b) => severityOrder[a.level] - severityOrder[b.level]);

  // Task 5: unanswered Q&A — only send if any content
  const sinceMs = Date.now() - 24 * 60 * 60 * 1000;
  const unansweredFindings: UnansweredFinding[] = [];
  let rioToken = '';
  try {
    rioToken = await getAgentToken('rio');
  } catch (e) {
    console.warn('[digests] failed to get Rio token:', e);
  }

  if (rioToken) {
    for (const { feature, pocEmails } of finalInDev) {
      try {
        const finding = await collectUnansweredForFeature(feature, sinceMs, rioToken, pocEmails);
        if (finding) unansweredFindings.push(finding);
      } catch (e) {
        console.warn(`[digests] unanswered check failed for ${feature.name}:`, e);
      }
    }
  }

  // Send the risk digest (always)
  let riskSent = false;
  if (rioToken) {
    const riskText = formatRiskDigest(riskFindings);
    console.log('[digests] risk digest:\n' + riskText);
    const id = await sendDmByEmail(ownerEmail, riskText, rioToken);
    riskSent = id !== null;
  }

  // Send the unanswered digest (only if non-empty)
  let unansweredSent = false;
  if (rioToken && unansweredFindings.length > 0) {
    const text = formatUnansweredDigest(unansweredFindings);
    console.log('[digests] unanswered digest:\n' + text);
    const id = await sendDmByEmail(ownerEmail, text, rioToken);
    unansweredSent = id !== null;
  } else {
    console.log(`[digests] no unanswered questions — skipping Q&A digest`);
  }

  return {
    featuresChecked: finalInDev.length,
    riskSent,
    unansweredSent,
    riskFindings,
    unansweredFindings,
  };
}
