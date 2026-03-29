'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

const ERROR_MESSAGES: Record<string, string> = {
  invalid_state:  'Authentication failed — please try again.',
  token_exchange: 'Could not exchange login code — please try again.',
  no_token:       'No token received from Lark — please try again.',
  user_info:      'Could not fetch your user info — please try again.',
  no_user:        'Login failed — please try again.',
};

function LoginContent() {
  const params = useSearchParams();
  const error  = params.get('error');

  return (
    <div className="min-h-screen bg-[#080b18] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo / wordmark */}
        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold text-white tracking-tight">Hamlet</h1>
          <p className="text-gray-500 text-sm mt-1">TikTok DM · Feature Tracker</p>
        </div>

        <div className="bg-[#0e1120] border border-[#1e2240] rounded-2xl p-8 shadow-2xl flex flex-col items-center gap-6">
          <p className="text-gray-400 text-sm text-center leading-relaxed">
            Sign in with your ByteDance Lark account to continue.
          </p>

          {error && (
            <p className="w-full text-center text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-4 py-2">
              {ERROR_MESSAGES[error] ?? 'An error occurred — please try again.'}
            </p>
          )}

          <a
            href="/api/auth/login"
            className="w-full flex items-center justify-center gap-3 bg-purple-600 hover:bg-purple-500 text-white font-semibold text-sm px-5 py-3 rounded-xl transition-colors"
          >
            {/* Lark icon (simplified) */}
            <svg width="18" height="18" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M24 4C12.954 4 4 12.954 4 24s8.954 20 20 20 20-8.954 20-20S35.046 4 24 4z" fill="white" fillOpacity="0.2"/>
              <path d="M32 16l-10 8 10 8" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M16 16v16" stroke="white" strokeWidth="2.5" strokeLinecap="round"/>
            </svg>
            Sign in with Lark
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
