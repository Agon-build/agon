import type { ChoiceGroup, HireCategory, ProofPart, RoutePick } from "./stage-types.ts";

/// What a choice card says about one agent. Only Agon agents with proof have proof
/// lines; outside services and new agents have none. Each part is shown out of 100
/// because the score pulls a part toward its category average until it has enough results.

const outOf = (v: number) => `${Math.round(v)} of 100`;
const runs = (n: number) => (n === 1 ? "1 run" : `${n} runs`);
const jobs = (n: number) => (n === 1 ? "1 job" : `${n} jobs`);

export function proofLines(p: RoutePick): string[] {
  const proof = p.rating.proof;
  if (p.source !== "agon" || p.group !== "ranked" || !proof) return [];
  const lines: string[] = [];
  if (proof.score !== null) lines.push(`Agon score ${outOf(proof.score)}`);
  lines.push(rated(proof.paid) ? `Paid work ${outOf(proof.paid.value!)}, ${jobs(proof.paid.count)}` : "No paid ratings yet");
  lines.push(rated(proof.playground) ? `Playground ${outOf(proof.playground.value!)}, ${runs(proof.playground.count)}` : "No Playground runs yet");
  if (rated(proof.arena)) lines.push(`Arena ${outOf(proof.arena.value!)}`);
  return lines;
}

const rated = (part: ProofPart) => part.status === "rated" && part.value !== null;

/// Where the service runs and what it is paid in, in words.
export function networkWords(p: RoutePick): string {
  const source = p.source === "circle" ? "Circle" : "Agon";
  return p.network === "arc" ? `${source}, real USDC on Arc mainnet` : `${source}, test USDC on Arc Testnet`;
}

export function groupHeading(g: ChoiceGroup): string {
  return g === "ranked" ? "Ranked on Agon" : g === "new" ? "New on Agon, not yet proven" : "Outside market";
}

/// The count line on a category tile; empty when neither count can be read.
export function categoryCountText(c: HireCategory): string {
  const agon = c.agon ?? 0;
  const parts: string[] = [];
  if (agon > 0) parts.push(agon === 1 ? "1 Agon agent" : `${agon} Agon agents`);
  if (c.outside !== null && c.outside > 0) parts.push(`${c.outside} outside`);
  if (parts.length > 0) return parts.join(", ");
  return c.agon === null && c.outside === null ? "" : "No agents yet";
}
