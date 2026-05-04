'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Feature } from './types';

// Per-user "I've seen this update" memory. Stored in localStorage so the
// blue unread dot survives page reloads. Each entry is the ISO date the
// user last opened the feature drawer; a feature is considered "unread"
// when its latest Junior-flagged update (PRD edit / risk worsening) is
// newer than that timestamp, OR the feature has flagged updates and the
// user has never opened it.

const STORAGE_KEY = 'hamlet:viewedFeatures';
const WINDOW_DAYS = 7;
// The dot stays visible for at least this long after the update lands,
// even if the user opens the drawer immediately. Past that floor, a
// click-after-update dismisses it.
const MIN_VISIBLE_MS = 24 * 60 * 60 * 1000;

type ViewedMap = Record<string, string>; // featureId → ISO datetime

function readMap(): ViewedMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed ? parsed : {};
  } catch {
    return {};
  }
}

function writeMap(map: ViewedMap) {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map)); } catch {}
}

// Return the most recent flagged-update ISO datetime for the feature,
// limited to the last WINDOW_DAYS. Returns null when nothing qualifies.
function latestUpdateIso(feature: Feature): string | null {
  const cutoff = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);
  const dates: string[] = [];
  for (const p of feature.prdUpdates ?? []) {
    if (p.date >= cutoff) dates.push(p.date);
  }
  for (const r of feature.riskHistory ?? []) {
    if (r.date >= cutoff && (r.to === 'red' || r.to === 'yellow')) dates.push(r.date);
  }
  // Outstanding @-mention questions Junior surfaced in the Q&A digest
  // count as a Junior-flagged update — same drawer callout, same
  // unread cue.
  for (const q of feature.unansweredQuestions ?? []) {
    if (q.date >= cutoff) dates.push(q.date);
  }
  if (dates.length === 0) return null;
  return dates.sort().slice(-1)[0];
}

export function useViewedFeatures() {
  const [map, setMap] = useState<ViewedMap>({});
  const mapRef = useRef<ViewedMap>({});

  useEffect(() => {
    const m = readMap();
    setMap(m);
    mapRef.current = m;
  }, []);

  const markViewed = useCallback((featureId: string) => {
    const next = { ...mapRef.current, [featureId]: new Date().toISOString() };
    mapRef.current = next;
    setMap(next);
    writeMap(next);
  }, []);

  const hasUnread = useCallback((feature: Feature): boolean => {
    const latest = latestUpdateIso(feature);
    if (!latest) return false;
    // Anchor "update happened at" to start-of-day SGT (digests.ts records
    // dates in SGT). Anything earlier than this can't be a "view since
    // the update", so the click won't dismiss the dot.
    const updateMs = Date.parse(`${latest}T00:00:00+08:00`);
    if (!Number.isFinite(updateMs)) return true;

    // Mandatory floor — keep the pill for at least 24h regardless of
    // whether the user has clicked.
    if (Date.now() - updateMs < MIN_VISIBLE_MS) return true;

    // Past the floor: a click made after the update dismisses it.
    const viewed = map[feature.id];
    if (!viewed) return true;
    const viewedMs = Date.parse(viewed);
    if (!Number.isFinite(viewedMs)) return true;
    return viewedMs < updateMs;
  }, [map]);

  return { hasUnread, markViewed };
}
