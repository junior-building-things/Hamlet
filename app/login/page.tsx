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

          {/* — SINGLE SIGN-ON — eyebrow */}
          <div
            className="text-[12px] tracking-[0.18em] uppercase text-[var(--ai)] mb-5"
            style={{ fontFamily: 'var(--font-mono)' }}
          >
            — Single sign-on —
          </div>

          {/* Headline with inline mono pill on the brand name */}
          <h1 className="text-[34px] leading-[1.15] font-bold tracking-[-0.01em] text-[var(--text)]">
            Sign in to{' '}
            <span
              className="inline-flex items-baseline px-2.5 py-0.5 rounded-[6px] align-baseline"
              style={{
                fontFamily: 'var(--font-mono)',
                background: 'var(--ai-soft)',
                color: 'var(--ai)',
                fontWeight: 500,
              }}
            >
              Hamlet
            </span>
          </h1>

          {/* Body */}
          <p className="mt-5 text-[14px] leading-[1.55] text-[var(--text-muted)]">
            Hamlet is an internal AI co-pilot for the product team — it<br />
            watches features, drafts updates, and keeps PMs unblocked.
          </p>

          {/* Error */}
          {error && (
            <p
              className="mt-6 mx-auto text-[12px] rounded-[8px] px-4 py-2"
              style={{
                color: 'var(--rose)',
                background: 'oklch(0.72 0.18 22 / 0.10)',
                border: '1px solid oklch(0.72 0.18 22 / 0.25)',
              }}
            >
              {ERROR_MESSAGES[error] ?? 'An error occurred — please try again.'}
            </p>
          )}

          {/* Continue-with-Lark CTA — fixed 374×40 chip, centred. */}
          <div className="mt-7 flex justify-center">
            <a
              href="/api/auth/login"
              className="inline-flex items-center justify-center gap-2.5 rounded-[var(--r-md)] text-[13px] font-semibold tracking-[-0.01em] bg-[var(--text)] text-[var(--bg)] transition-transform hover:-translate-y-px"
              style={{
                width: 374,
                height: 40,
                boxShadow: '0 0 0 1px var(--hairline-strong), var(--shadow-sm)',
              }}
            >
              <span className="grid place-items-center w-[22px] h-[22px] rounded-[4px] bg-white shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/lark.png" alt="" width={14} height={14} className="rounded-[3px]" />
              </span>
              Continue with Lark
            </a>
          </div>

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
