'use client';
import { useEffect, useRef, useState } from 'react';

/**
 * Sidebar status card — "Junior is working" when a cron is in flight,
 * "Junior is active" when idle. Polls /api/crons/active every 5s.
 *
 * Working state animates a snake-border sweep along the card's top edge
 * (CSS class `.junior-status.is-working` in app/globals.css).
 */

interface ActiveRun {
  id: string;
  label: string;
  startedAt: string;
  source: 'manual' | 'scheduled';
  elapsedSeconds: number;
}

function formatElapsed(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem === 0 ? `${m}m` : `${m}m ${rem}s`;
}

export function JuniorStatusCard() {
  const [runs, setRuns] = useState<ActiveRun[]>([]);
  // Tick every second so the elapsed-time label updates without
  // re-fetching from the server every second.
  const [tick, setTick] = useState(0);
  // When a manual trigger fires, we want to fast-poll for ~10s so the
  // card catches the in-flight entry even for very short cron runs.
  // This ref holds the deadline (ms since epoch) until which we poll
  // every 1s instead of 3/8s.
  const fastPollUntilRef = useRef<number>(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function fetchOnce() {
      try {
        const r = await fetch('/api/crons/active', { cache: 'no-store' });
        if (!r.ok) return;
        const data = await r.json() as { runs?: ActiveRun[] };
        if (!cancelled) setRuns(Array.isArray(data.runs) ? data.runs : []);
      } catch { /* swallow — UI just stays in last state */ }
    }

    function loop() {
      fetchOnce().finally(() => {
        if (cancelled) return;
        // Three modes:
        //  - fast (1s)  for ~10s after a manual trigger, to catch quick
        //               runs that finish before the normal poll interval
        //  - working (3s) while a run is in flight
        //  - idle (8s)    otherwise
        const fast = Date.now() < fastPollUntilRef.current;
        const delay = fast ? 1000 : runs.length > 0 ? 3000 : 8000;
        timer = setTimeout(loop, delay);
      });
    }
    loop();

    // CronJobsView dispatches this immediately when the user clicks
    // Trigger once. Refetch right away + enter fast-poll mode.
    function onTriggered() {
      fastPollUntilRef.current = Date.now() + 10_000;
      fetchOnce();
    }
    window.addEventListener('cron:triggered', onTriggered);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener('cron:triggered', onTriggered);
    };
    // Re-arm the loop when transition between idle/working happens
    // so the polling interval matches the new state.
  }, [runs.length]);

  // 1Hz tick for the elapsed-seconds counter while a run is active.
  useEffect(() => {
    if (runs.length === 0) return;
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [runs.length]);
  void tick; // referenced solely to force re-render

  const working = runs.length > 0;
  const top = runs[0];

  return (
    <div className={`junior-status ${working ? 'is-working' : ''}`}>
      <div className="js-title">
        <span className="js-dot" />
        <span>Junior is {working ? 'working' : 'active'}</span>
      </div>
      {working ? (
        <>
          <div className="js-body">{top.label}</div>
          <div className="js-meta">
            {top.source === 'manual' ? 'manually triggered' : 'on schedule'}
            {' · '}
            {formatElapsed(Math.max(0, Math.round((Date.now() - Date.parse(top.startedAt)) / 1000)))}
            {runs.length > 1 ? ` · +${runs.length - 1} more` : ''}
          </div>
        </>
      ) : (
        <div className="js-body">Monitoring feature risk and updates</div>
      )}
    </div>
  );
}
