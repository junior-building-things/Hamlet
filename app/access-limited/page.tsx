export default function AccessLimitedPage() {
  return (
    // relative + z-10 so the card sits above the fixed .app-bg dot
    // pattern instead of letting it bleed through.
    <div className="min-h-screen flex items-center justify-center p-4 relative z-10">
      <div className="w-full max-w-sm">
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-2xl p-10 shadow-2xl flex flex-col items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/hamlet.png" alt="Hamlet" className="w-16 h-16 object-contain" />
          <h1
            className="text-4xl font-light uppercase text-[var(--foreground)]"
            style={{ fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' }}
          >
            Hamlet
          </h1>
        </div>
        <p className="text-center text-xs text-gray-600 mt-6">
          Sorry, access is currently limited. Stay tuned!
        </p>
      </div>
    </div>
  );
}
