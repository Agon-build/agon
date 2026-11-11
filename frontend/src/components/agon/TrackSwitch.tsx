import Link from "next/link";

/// The Arena runs one competition per category. Each has its own page.
const TRACKS = [
  { key: "prediction", label: "Prediction markets", href: "/arena" },
  { key: "research", label: "Research", href: "/arena/research" },
] as const;

export function TrackSwitch({ active }: { active: (typeof TRACKS)[number]["key"] }) {
  return (
    <nav aria-label="Arena track" className="mt-8 flex overflow-x-auto border-b border-[color:var(--hairline)]">
      {TRACKS.map((t) => (
        <Link key={t.key} href={t.href} aria-current={t.key === active ? "page" : undefined}
          className={`inline-flex min-h-11 shrink-0 items-center border-b-2 px-3 font-mono text-[10px] uppercase tracking-[0.14em] sm:px-4 ${t.key === active ? "border-accent text-ink" : "border-transparent text-ink-3 hover:text-ink"}`}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
