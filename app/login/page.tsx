'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { LayoutList, FileText, RefreshCw } from 'lucide-react';

const ERROR_MESSAGES: Record<string, string> = {
  invalid_state:  'Authentication failed — please try again.',
  token_exchange: 'Could not exchange login code — please try again.',
  no_token:       'No token received from Lark — please try again.',
  user_info:      'Could not fetch your user info — please try again.',
  no_user:        'Login failed — please try again.',
};

const FEATURES = [
  {
    icon: <LayoutList className="w-5 h-5 text-blue-400" />,
    bg:   'bg-blue-400/10',
    text: 'Track all your features in one place',
  },
  {
    icon: <FileText className="w-5 h-5 text-blue-400" />,
    bg:   'bg-blue-400/10',
    text: 'Auto-generate Meego, PRD, and compliance review',
  },
  {
    icon: <RefreshCw className="w-5 h-5 text-emerald-400" />,
    bg:   'bg-emerald-400/10',
    text: 'Connect to your agent of choice',
  },
];

function LoginContent() {
  const params = useSearchParams();
  const error  = params.get('error');

  return (
    <div className="min-h-screen bg-transparent flex items-center justify-center p-4">
      <div className="w-full max-w-sm">

        {/* Logo + wordmark */}
        <div className="text-center mb-8 flex flex-col items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/hamlet.png" alt="Hamlet" className="w-16 h-16 object-contain" />
          <h1 className="text-5xl text-[var(--foreground)]" style={{ fontFamily: 'var(--font-newsreader)' }}>Hamlet</h1>
        </div>

        <div className="bg-[var(--background)] border border-[var(--border)] rounded-2xl p-8 shadow-2xl flex flex-col gap-6">

          {/* Feature bullets */}
          <div className="flex flex-col gap-4">
            {FEATURES.map(({ icon, bg, text }) => (
              <div key={text} className="flex items-center gap-4">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${bg}`}>
                  {icon}
                </div>
                <span className="text-sm font-semibold text-[var(--foreground)] leading-snug">{text}</span>
              </div>
            ))}
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-[var(--card-hover)]" />
            <span className="text-[11px] font-semibold tracking-widest text-gray-500 uppercase">Continue with</span>
            <div className="flex-1 h-px bg-[var(--card-hover)]" />
          </div>

          {/* Error */}
          {error && (
            <p className="text-center text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-4 py-2">
              {ERROR_MESSAGES[error] ?? 'An error occurred — please try again.'}
            </p>
          )}

          {/* Login button */}
          <a
            href="/api/auth/login"
            className="w-full flex items-center justify-center gap-3 bg-white hover:bg-gray-100 text-gray-900 font-semibold text-sm px-5 py-3 rounded-xl transition-colors shadow"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/lark_logo.png" alt="" width={20} height={20} />
            Log in with Lark
          </a>

        </div>

        <p className="text-center text-xs text-gray-600 mt-6">
          Access restricted to ByteDance employees.
        </p>
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
