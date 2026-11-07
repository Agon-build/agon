import type { Board } from "./scores-api.ts";
import type { HireCategory, SeasonInfo } from "./stage-types.ts";
import type { AgonListing } from "./types.ts";

/// The live numbers the welcome story shows. A null is shown as "Not available
/// right now", never replaced by a typed-in figure.
export type LandingFacts = {
  listed: number | null;
  verified: number | null;
  outside: number | null;
  topAgent: { name: string; score: number; rank: number; of: number; arena: number | null; playground: number | null } | null;
  round: number | null;
  seasonEnds: string | null;
};

export type LandingInput = {
  listings: AgonListing[] | null;
  board: Board | null;
  categories: HireCategory[] | null;
  season: SeasonInfo | null;
  /// The top row's service name, read from its listing manifest.
  topName: string | null;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function shortDate(iso: string): string | null {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/// The best ranked row of a board, or null when nothing is ranked.
export function topRow(board: Board | null) {
  const ranked = (board?.rows ?? []).filter((r) => r.rank !== null && r.score !== null);
  return ranked.sort((a, b) => a.rank! - b.rank!)[0] ?? null;
}

export function landingFacts(input: LandingInput): LandingFacts {
  const { listings, board, categories, season, topName } = input;
  const counts = (categories ?? []).map((c) => c.outside).filter((n): n is number => typeof n === "number");
  const top = topRow(board);
  const rated = (p: { value: number | null; status: string }) => (p.status === "rated" ? p.value : null);
  const round = season?.currentRound ? Number(season.currentRound) : null;
  return {
    listed: listings ? listings.length : null,
    verified: listings ? listings.filter((l) => l.verification.status === "Verified").length : null,
    outside: counts.length ? counts.reduce((a, b) => a + b, 0) : null,
    topAgent: top && topName ? {
      name: topName,
      score: top.score!,
      rank: top.rank!,
      of: board!.rows.filter((r) => r.rank !== null).length,
      arena: rated(top.parts.arena),
      playground: rated(top.parts.playground),
    } : null,
    round: round !== null && Number.isFinite(round) ? round : null,
    seasonEnds: season ? shortDate(season.endsAt) : null,
  };
}

/// Scroll scenes only when the person allows motion; otherwise every scene is static.
export function landingMotion(motionAllowed: boolean): "scroll" | "static" {
  return motionAllowed ? "scroll" : "static";
}

/// Where Enter Agon on the intro goes.
export function introDestination(): "/welcome" {
  return "/welcome";
}
