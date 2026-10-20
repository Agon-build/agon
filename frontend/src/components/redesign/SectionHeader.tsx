import type { ReactNode } from "react";

/// Every section opens with three stacked lines, left-aligned:
///   1) 6×6px pink square + mono caps eyebrow
///   2) massive display heading in stencil face
///   3) 2–3 line mono sub-deck at `--ink-2`
///
/// No center alignment. Headings sit hard against the left edge of the grid.

interface Props {
  /// Optional mono caps eyebrow. Strings render with the pink ■ marker; pass
  /// a node when you need richer content (e.g. an inline StatusChip). Skip
  /// the eyebrow when it would only paraphrase the heading: the heading is
  /// the thing.
  eyebrow?: ReactNode;
  /// The display heading. Usually a string; pass a node when you need to keep
  /// multi-word phrases from breaking mid-line (wrap each in a nowrap span).
  heading: ReactNode;
  /// Optional sub-deck mono body. Two or three lines max.
  subDeck?: ReactNode;
  /// Optional right-side slot for a tag CTA aligned to the heading row.
  right?: ReactNode;
  /// Heading size: hero for top-of-page, section for everything else.
  size?: "hero" | "section";
  headingAs?: "h1" | "h2";
}

export function SectionHeader({ eyebrow, heading, subDeck, right, size = "section", headingAs: Heading = "h2" }: Props) {
  const fontSize =
    size === "hero" ? "clamp(56px, 8vw, 112px)" : "clamp(40px, 5vw, 72px)";
  return (
    <header className="flex flex-wrap items-end justify-between gap-6">
      <div className="min-w-0 flex-1">
        {eyebrow ? (
          <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-ink">
            {typeof eyebrow === "string" ? (
              <>
                <span aria-hidden className="text-accent">■</span>
                {eyebrow}
              </>
            ) : (
              eyebrow
            )}
          </div>
        ) : null}
        <Heading
          className={eyebrow ? "mt-4 text-balance font-stencil uppercase text-ink" : "text-balance font-stencil uppercase text-ink"}
          style={{ fontSize, lineHeight: size === "hero" ? "0.95" : "1.0", letterSpacing: "-0.01em" }}
        >
          {heading}
        </Heading>
        {subDeck ? (
          <div className="mt-4 max-w-[120ch] text-pretty font-mono text-sm leading-[1.55] text-ink-2">{subDeck}</div>
        ) : null}
      </div>
      {right ? <div className="flex items-center gap-3">{right}</div> : null}
    </header>
  );
}
