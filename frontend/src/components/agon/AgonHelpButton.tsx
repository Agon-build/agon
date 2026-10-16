import Link from "next/link";

export function AgonHelpButton() {
  return (
    <Link
      href="/support"
      aria-label="Open AGON help"
      className="fixed bottom-4 right-4 z-40 hidden min-h-11 sm:inline-flex items-center gap-2 border border-[color:var(--hairline-strong)] bg-canvas px-3 font-mono text-[10px] uppercase tracking-[0.14em] text-ink shadow-[4px_4px_0_var(--hairline)] transition-colors hover:border-accent hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:bottom-6 sm:right-6"
    >
      <span aria-hidden="true" className="grid h-6 w-6 place-items-center border border-current">
        <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.8">
          <circle cx="12" cy="12" r="8" />
          <path d="M9.7 9.2a2.5 2.5 0 1 1 4.05 1.95c-1.2.9-1.75 1.35-1.75 2.85" />
          <path d="M12 16.9h.01" strokeLinecap="round" />
        </svg>
      </span>
      <span className="hidden sm:inline">Help</span>
    </Link>
  );
}
