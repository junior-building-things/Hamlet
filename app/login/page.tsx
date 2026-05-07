'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

const ERROR_MESSAGES: Record<string, string> = {
  invalid_state:  'Authentication failed — please try again.',
  token_exchange: 'Could not exchange login code — please try again.',
  no_token:       'No token received from Lark — please try again.',
  user_info:      'Could not fetch your user info — please try again.',
  no_user:        'Login failed — please try again.',
  access_limited: 'Sorry, access is currently limited. Stay tuned!',
};

function LoginContent() {
  const params = useSearchParams();
  const error  = params.get('error');

  return (
    // relative + z-10 so the card sits above the fixed .app-bg dot
    // pattern — same wrapper as /access-limited.
    <div className="min-h-screen flex items-center justify-center p-4 relative z-10">
      <div className="w-full max-w-xl">
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-2xl p-10 shadow-2xl text-center">

          {/* App icon + wordmark — hex/cube glyph from the design,
              rendered bare (no background, no border) inline left of
              the "Hamlet" pill. */}
          <div className="mb-6 flex justify-center items-center gap-2.5">
            <svg
              viewBox="0 0 24 24" width="22" height="22"
              fill="none" stroke="currentColor"
              strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
              style={{ color: 'var(--ai)' }}
              aria-hidden
            >
              <path d="M12 2 L20 7 L20 17 L12 22 L4 17 L4 7 Z" />
              <path d="M12 2 L12 12 M12 12 L20 7 M12 12 L4 7 M12 12 L12 22" />
            </svg>
            <span
              className="inline-flex items-baseline px-3 py-1 rounded-[8px] text-[24px]"
              style={{
                fontFamily: 'var(--font-mono)',
                background: 'var(--ai-soft)',
                color: 'var(--ai)',
                fontWeight: 500,
              }}
            >
              Hamlet
            </span>
          </div>

          {/* Body — same copy as /access-limited. */}
          <p className="mt-2 text-[14px] leading-[1.55] text-[var(--text-muted)]">
            Hamlet is an internal AI co-pilot for the product team — it<br />
            watches features, drafts updates, and keeps PMs unblocked.
          </p>

          {/* Divider — Continue with */}
          <div className="mt-7 flex items-center gap-3 max-w-[360px] mx-auto">
            <div className="flex-1 h-px bg-[var(--hairline)]" />
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--text-dim)]">Continue with</span>
            <div className="flex-1 h-px bg-[var(--hairline)]" />
          </div>

          {/* Error */}
          {error && (
            <p
              className="mt-5 mx-auto max-w-[360px] text-[12px] rounded-[8px] px-4 py-2"
              style={{
                color: 'var(--rose)',
                background: 'oklch(0.72 0.18 22 / 0.10)',
                border: '1px solid oklch(0.72 0.18 22 / 0.25)',
              }}
            >
              {ERROR_MESSAGES[error] ?? 'An error occurred — please try again.'}
            </p>
          )}

          {/* Login button — solid --text background, semibold label. */}
          <a
            href="/api/auth/login"
            className="mt-5 mx-auto max-w-[360px] flex items-center justify-center gap-2.5 px-5 py-3 rounded-[var(--r-md)] text-[13px] font-semibold tracking-[-0.01em] bg-[var(--text)] text-[var(--bg)] transition-transform hover:-translate-y-px"
            style={{ boxShadow: '0 0 0 1px var(--hairline-strong), var(--shadow-sm)' }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/lark.png" alt="" width={18} height={18} className="rounded-[4px]" />
            Log in with Lark
          </a>

          {/* Footer */}
          <p className="mt-6 text-[12px] text-[var(--text-muted)]">
            Access restricted to ByteDance employees.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  );
}
