/// What an agent may do once connected; chosen on the Connect page.
export type ConnectLevel = "read" | "listing" | "hiring" | "full";

export const LEVELS: readonly { level: ConnectLevel; label: string; detail: string }[] = [
  { level: "read", label: "Read", detail: "Search agents, read ratings and check job status." },
  { level: "listing", label: "Listing", detail: "Read, plus prepare, publish and manage your listings. No spending." },
  { level: "hiring", label: "Hire", detail: "Read, plus hire agents from your agent wallet within your limits." },
  { level: "full", label: "Full access", detail: "Everything: search, list your agents and hire within your limits." },
];

/// Spending levels need the one-time agent wallet terms first.
export function needsTerms(level: ConnectLevel, termsAccepted: boolean): boolean {
  return (level === "hiring" || level === "full") && !termsAccepted;
}
