
/// Bounded haggling over a price, the same rules as the July missions
/// negotiator (runners/missions/negotiate.ts) but free of mission types: a
/// house seller trades down toward a private floor, a buyer opens low and
/// moves halfway each round, nobody goes past three rounds, and walking away
/// is a real outcome. Outside sellers are not haggled with at all.

export type BargainStep = { step: "request" | "offer" | "counter" | "accept" | "walk" | "pay"; detail: string };
export type SellerDecision = { kind: "accept"; amount: bigint } | { kind: "counter"; amount: bigint } | { kind: "walk" };
export type SellerReply = { kind: "accept"; amount: bigint; quoteId: string } | { kind: "counter"; amount: bigint } | { kind: "walk" };

export function formatUsdc(atomic: bigint): string {
  const negative = atomic < 0n;
  const v = negative ? -atomic : atomic;
  const whole = v / 1_000_000n;
  let frac = (v % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  if (frac.length < 2) frac = frac.padEnd(2, "0");
  return `${negative ? "-" : ""}${whole}.${frac}`;
}

/// Move `from` toward `to` by `fraction` of the gap, in whole base units.
function toward(from: bigint, to: bigint, fraction: number): bigint {
  return from + ((to - from) * BigInt(Math.round(fraction * 10_000))) / 10_000n;
}

export function sellerRespond(input: { ask: bigint; floor: bigint; offer: bigint; round: number; maxRounds: number; lastCounter: bigint | null }): SellerDecision {
  const { ask, floor, offer, round, maxRounds } = input;
  const anchor = input.lastCounter ?? ask;
  if (offer >= ask) return { kind: "accept", amount: ask };
  if (offer >= floor) {
    if (round >= maxRounds) return { kind: "accept", amount: offer };
    const counter = toward(offer, anchor, 0.5);
    return counter <= offer ? { kind: "accept", amount: offer } : { kind: "counter", amount: counter };
  }
  if (round >= maxRounds) return { kind: "walk" };
  const counter = toward(offer, anchor, 0.6);
  return { kind: "counter", amount: counter < floor ? floor : counter };
}

export function buyerOffer(input: { ask: bigint; ceiling: bigint; lastOffer: bigint | null; lastCounter: bigint | null; round: number; maxRounds: number }): bigint {
  const { ask, ceiling, lastOffer, lastCounter, round, maxRounds } = input;
  const cap = (v: bigint) => (v > ceiling ? ceiling : v);
  if (lastOffer === null || lastCounter === null) return cap((ask * 60n) / 100n);
  if (round >= maxRounds && lastCounter <= ceiling) return lastCounter;
  return cap(toward(lastOffer, lastCounter, 0.5));
}

export async function negotiate(input: {
  sellerLabel: string;
  ask: bigint;
  ceiling: bigint;
  maxRounds?: number;
  quote: (offer: bigint, round: number, lastCounter: bigint | null) => Promise<SellerReply>;
}): Promise<{ deal: { quoteId: string; amount: bigint } | null; transcript: BargainStep[] }> {
  const maxRounds = input.maxRounds ?? 3;
  const transcript: BargainStep[] = [{ step: "request", detail: `asked ${input.sellerLabel} for a price; listed at ${formatUsdc(input.ask)} USDC` }];
  let lastOffer: bigint | null = null;
  let lastCounter: bigint | null = null;
  for (let round = 1; round <= maxRounds; round++) {
    const offer = buyerOffer({ ask: input.ask, ceiling: input.ceiling, lastOffer, lastCounter, round, maxRounds });
    transcript.push({ step: "offer", detail: `offered ${formatUsdc(offer)} USDC` });
    const reply = await input.quote(offer, round, lastCounter);
    if (reply.kind === "accept") {
      transcript.push({ step: "accept", detail: `agreed ${formatUsdc(reply.amount)} USDC (asked ${formatUsdc(input.ask)})` });
      return { deal: { quoteId: reply.quoteId, amount: reply.amount }, transcript };
    }
    if (reply.kind === "walk") {
      transcript.push({ step: "walk", detail: `${input.sellerLabel} would not go lower; walked away` });
      return { deal: null, transcript };
    }
    transcript.push({ step: "counter", detail: `${input.sellerLabel} countered at ${formatUsdc(reply.amount)} USDC` });
    lastOffer = offer;
    lastCounter = reply.amount;
  }
  transcript.push({ step: "walk", detail: `no deal with ${input.sellerLabel} after ${maxRounds} rounds` });
  return { deal: null, transcript };
}
