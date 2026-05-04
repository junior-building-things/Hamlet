import { Feature } from './types';

/**
 * Notes-cell content logic for the feature row.
 *
 * The cell is editable AND auto-fills from Junior signals.
 * Behaviour:
 *   - If the user manually edited within the last 5 business days,
 *     show their text verbatim (manual override wins).
 *   - Otherwise, derive a short note from the highest-priority
 *     Junior signal: Delayed → High risk → Medium risk → Open
 *     questions. Low risk and PRD updates are intentionally NOT
 *     surfaced here — they don't represent something the PM
 *     needs to act on at-a-glance.
 *   - If no signal AND no manual note → empty (renders as "—").
 *
 * Returns a tagged result so the caller can distinguish "auto"
 * (suggestion that should be replaced if the user types) from
 * "manual" (the user's pinned text).
 */
export type NoteSource = 'manual' | 'auto' | 'empty';

export interface DisplayNote {
  text: string;
  source: NoteSource;
  /** True when the cell currently respects a recent manual edit. */
  manualPinned: boolean;
}

const MANUAL_COOLDOWN_BUSINESS_DAYS = 5;

/** Number of weekdays (Mon–Fri) between two dates, inclusive of neither. */
function businessDaysSince(iso: string): number {
  const fromMs = Date.parse(iso);
  if (!Number.isFinite(fromMs)) return Infinity;
  const cursor = new Date(fromMs);
  cursor.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (cursor >= today) return 0;
  let count = 0;
  while (cursor < today) {
    cursor.setDate(cursor.getDate() + 1);
    const day = cursor.getDay(); // 0=Sun, 6=Sat
    if (day !== 0 && day !== 6) count++;
  }
  return count;
}

function isManualNoteFresh(notesEditedAt: string | undefined): boolean {
  if (!notesEditedAt) return false;
  return businessDaysSince(notesEditedAt) < MANUAL_COOLDOWN_BUSINESS_DAYS;
}

/** Compute the auto-prefill text per the priority order. Returns '' if no signal. */
export function computePrefilledNote(feature: Feature): string {
  // 1. Delayed → version transition + reason if known.
  const slips = feature.versionChanges ?? [];
  if (slips.length > 0) {
    const latest = slips[slips.length - 1];
    const reason = latest.reason || (feature.riskNotes ?? []).filter(n => n !== `${latest.from} → ${latest.to}`)[0];
    return reason
      ? `${latest.from} → ${latest.to} due to ${reason}`
      : `Delayed ${latest.from} → ${latest.to}`;
  }
  // 2. High risk.
  if (feature.riskLevel === 'red' && feature.riskNotes && feature.riskNotes.length > 0) {
    return feature.riskNotes.join(' · ');
  }
  // 3. Medium risk.
  if (feature.riskLevel === 'yellow' && feature.riskNotes && feature.riskNotes.length > 0) {
    return feature.riskNotes.join(' · ');
  }
  // 4. Open questions in the last 7 days. Match the drawer's wording —
  //    minus the leading "the" + trailing period to save row space.
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const recent = (feature.unansweredQuestions ?? []).filter(q => q.date >= cutoff);
  if (recent.length > 0) {
    const chat = recent.filter(q => q.source === 'chat').length;
    const prd  = recent.filter(q => q.source === 'prd_comment').length;
    const phrase = (n: number) => `${n} open question${n === 1 ? '' : 's'}`;
    if (chat > 0 && prd > 0) return `${phrase(chat)} in lark group and ${phrase(prd)} in PRD`;
    if (prd > 0) return `${phrase(prd)} in PRD`;
    return `${phrase(chat)} in lark group`;
  }
  return '';
}

/** What to render in the Notes cell for this feature, with a flag describing the source. */
export function getDisplayNote(feature: Feature): DisplayNote {
  const manualFresh = isManualNoteFresh(feature.notesEditedAt);
  if (manualFresh && feature.notes && feature.notes.trim().length > 0) {
    return { text: feature.notes, source: 'manual', manualPinned: true };
  }
  const auto = computePrefilledNote(feature);
  if (auto) return { text: auto, source: 'auto', manualPinned: false };
  // No auto signal — fall back to whatever manual text exists (even if stale).
  if (feature.notes && feature.notes.trim().length > 0) {
    return { text: feature.notes, source: 'manual', manualPinned: false };
  }
  return { text: '', source: 'empty', manualPinned: false };
}
