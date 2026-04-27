export default function AccessLimitedPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm text-center flex flex-col items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/hamlet.png" alt="Hamlet" className="w-16 h-16 object-contain" />
        <h1 className="text-5xl text-[var(--foreground)]" style={{ fontFamily: 'var(--font-newsreader)' }}>Hamlet</h1>
        <p className="text-sm text-[var(--muted)] mt-4">
          Sorry, access is currently limited. Stay tuned!
        </p>
      </div>
    </div>
  );
}
