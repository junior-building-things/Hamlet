export default function AccessLimitedPage() {
  return (
    // relative + z-10 so the card sits above the fixed .app-bg dot
    // pattern instead of letting it bleed through.
    <div className="min-h-screen flex items-center justify-center p-4 relative z-10">
      <div className="w-full max-w-xl">
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-2xl p-10 shadow-2xl">
          {/* — RESTRICTED — eyebrow */}
          <div
            className="text-[12px] tracking-[0.18em] uppercase text-[var(--ai)] mb-5"
            style={{ fontFamily: 'var(--font-mono)' }}
          >
            — Restricted —
          </div>

          {/* Headline with inline mono pill on the brand name */}
          <h1 className="text-[34px] leading-[1.15] font-bold tracking-[-0.01em] text-[var(--text)]">
            You don&apos;t have access to{' '}
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
            </span>{' '}
            yet.
          </h1>

          {/* Body */}
          <p className="mt-5 text-[14px] leading-[1.55] text-[var(--text-muted)]">
            Hamlet is an internal AI co-pilot for the product team — it watches features,
            drafts updates, and keeps PMs unblocked. Access is invite-only while we&apos;re
            in early preview.
          </p>
        </div>
      </div>
    </div>
  );
}
