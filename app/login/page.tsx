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
    icon: <LayoutList className="w-5 h-5 text-purple-400" />,
    bg:   'bg-purple-400/10',
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
    <div className="min-h-screen bg-[#080b18] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">

        {/* Wordmark */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white tracking-tight">Hamlet</h1>
          <p className="text-gray-500 text-sm mt-1">TikTok DM · Feature Tracker</p>
        </div>

        <div className="bg-[#0e1120] border border-[#1e2240] rounded-2xl p-8 shadow-2xl flex flex-col gap-6">

          {/* Feature bullets */}
          <div className="flex flex-col gap-4">
            {FEATURES.map(({ icon, bg, text }) => (
              <div key={text} className="flex items-center gap-4">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${bg}`}>
                  {icon}
                </div>
                <span className="text-sm font-semibold text-white leading-snug">{text}</span>
              </div>
            ))}
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-[#1e2240]" />
            <span className="text-[11px] font-semibold tracking-widest text-gray-500 uppercase">Continue with</span>
            <div className="flex-1 h-px bg-[#1e2240]" />
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
            {/* Lark logo (inline SVG — no external file dependency) */}
            <svg width="20" height="20" viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
              {/* teal top wing */}
              <path d="M100 30 C60 30 30 55 38 90 L100 110 L155 60 C140 40 120 30 100 30Z" fill="#00C8A0"/>
              {/* dark blue right wing */}
              <path d="M155 60 L100 110 L160 145 C185 125 190 90 175 68 L155 60Z" fill="#1A3CB8"/>
              {/* bright blue bottom body */}
              <path d="M38 90 C28 120 40 158 70 170 L160 145 L100 110 Z" fill="#3B82F6"/>
            </svg>
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
