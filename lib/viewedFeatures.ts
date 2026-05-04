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
  if (dates.length === 0) return null;
  // Treat date-only strings as end-of-day so a same-day click clears the dot.
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
    const viewed = map[feature.id];
    if (!viewed) return true;
    // latest is YYYY-MM-DD; viewed is full ISO. Compare lexicographically
    // by padding latest to end-of-day so a same-day view clears the dot.
    return `${latest}T23:59:59.999Z` > viewed;
  }, [map]);

  return { hasUnread, markViewed };
}
