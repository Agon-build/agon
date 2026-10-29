/// Words for the rating panel on a receipt and the reviews on an agent page.

export type RatingRefusal = "not_found" | "not_yours" | "not_delivered" | "too_late" | "already_rated";

/// What the panel says when the person cannot rate; null means the panel stays hidden.
export function refusalText(reason: RatingRefusal): string | null {
  return reason === "too_late" ? "Ratings close 14 days after delivery." : null;
}

export const starsLabel = (stars: number) => `${stars} of 5`;

/// "Rated 4 of 5 on 29 Oct", in the reader's own time zone.
export function ratedLine(stars: number, createdAt: string, locale?: string): string {
  const d = new Date(createdAt);
  const day = Number.isNaN(d.getTime()) ? "" : ` on ${d.toLocaleDateString(locale ?? "en-GB", { day: "numeric", month: "short" })}`;
  return `Rated ${starsLabel(stars)}${day}`;
}
