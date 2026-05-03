'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

/**
 * Hover tooltip — fixed-position floating bubble triggered by hover
 * with a 350ms delay (so quick mouse-overs don't trigger). The bubble
 * itself is hover-tolerant (you can move the cursor onto it without
 * dismissing) so embedded buttons (Copy / Edit) are interactive.
 *
 * Usage:
 *   <Tip content={<>...</>}>
 *     <span>...trigger element...</span>
 *   </Tip>
 *
 * The wrapper is an inline-flex span. Click events inside the trigger
 * still propagate; if you need to swallow clicks, do it on the trigger.
 */
export function Tip({
  children,
  content,
  delay = 350,
  wrapClassName,
}: {
  children: React.ReactNode;
  content: React.ReactNode;
  delay?: number;
  /** Optional class composed onto the .tip-wrap span. Useful when the
   *  wrapper needs to participate in flex layout (e.g. flex-1 min-w-0
   *  so its truncating child has a real width to overflow against). */
  wrapClassName?: string;
}) {
  const [shown, setShown]   = useState(false);
  const [pos, setPos]       = useState({ x: 0, y: 0 });
  const [mounted, setMounted] = useState(false);
  const timerRef            = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapRef             = useRef<HTMLSpanElement>(null);

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const show = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const r = wrapRef.current?.getBoundingClientRect();
      if (r) setPos({ x: r.left + r.width / 2, y: r.top });
      setShown(true);
    }, delay);
  }, [delay]);

  const hide = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setShown(false), 100);
  }, []);

  return (
    <span
      ref={wrapRef}
      className={`tip-wrap ${wrapClassName ?? ''}`.trim()}
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      {children}
      {shown && mounted && createPortal(
        <div
          className="tip shown"
          style={{
            left: pos.x,
            top: pos.y,
            transform: 'translate(-50%, calc(-100% - 8px))',
          }}
          onMouseEnter={() => {
            if (timerRef.current) clearTimeout(timerRef.current);
            setShown(true);
          }}
          onMouseLeave={hide}
        >
          {content}
        </div>,
        document.body,
      )}
    </span>
  );
}
