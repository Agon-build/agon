import assert from "node:assert/strict";
import test from "node:test";

import { buyerOffer, formatUsdc, negotiate, sellerRespond, type SellerReply } from "../../src/agon/payments/bargain.ts";

test("formatUsdc trims to at least two decimals", () => {
  assert.equal(formatUsdc(300_000n), "0.30");
  assert.equal(formatUsdc(2_000n), "0.002");
  assert.equal(formatUsdc(174_240n), "0.17424");
  assert.equal(formatUsdc(2_000_000n), "2.00");
});

test("seller: at or above ask accepts the ask; below floor counters until the last round, then walks", () => {
  assert.deepEqual(sellerRespond({ ask: 220_000n, floor: 160_000n, offer: 250_000n, round: 1, maxRounds: 3, lastCounter: null }), { kind: "accept", amount: 220_000n });
  assert.deepEqual(sellerRespond({ ask: 220_000n, floor: 160_000n, offer: 132_000n, round: 1, maxRounds: 3, lastCounter: null }), { kind: "counter", amount: 184_800n });
  assert.deepEqual(sellerRespond({ ask: 220_000n, floor: 160_000n, offer: 150_000n, round: 3, maxRounds: 3, lastCounter: 170_880n }), { kind: "walk" });
});

test("seller: never counters below its floor and accepts a floor-clearing offer in the last round", () => {
  const counter = sellerRespond({ ask: 220_000n, floor: 160_000n, offer: 10_000n, round: 2, maxRounds: 3, lastCounter: 160_500n });
  assert.equal(counter.kind, "counter");
  assert.ok(counter.kind === "counter" && counter.amount >= 160_000n);
  assert.deepEqual(sellerRespond({ ask: 220_000n, floor: 160_000n, offer: 174_240n, round: 3, maxRounds: 3, lastCounter: 174_240n }), { kind: "accept", amount: 174_240n });
});

test("buyer: opens at 60% of the ask and never offers above its ceiling", () => {
  assert.equal(buyerOffer({ ask: 220_000n, ceiling: 250_000n, lastOffer: null, lastCounter: null, round: 1, maxRounds: 3 }), 132_000n);
  assert.equal(buyerOffer({ ask: 220_000n, ceiling: 100_000n, lastOffer: null, lastCounter: null, round: 1, maxRounds: 3 }), 100_000n);
  assert.equal(buyerOffer({ ask: 220_000n, ceiling: 250_000n, lastOffer: 158_400n, lastCounter: 174_240n, round: 3, maxRounds: 3 }), 174_240n);
});

function houseSeller(ask: bigint, floor: bigint) {
  return async (offer: bigint, round: number, lastCounter: bigint | null): Promise<SellerReply> => {
    const d = sellerRespond({ ask, floor, offer, round, maxRounds: 3, lastCounter });
    return d.kind === "accept" ? { ...d, quoteId: "q-1" } : d;
  };
}

test("a full bargain with a house seller reaches a deal under the ask", async () => {
  const out = await negotiate({ sellerLabel: "Atlas", ask: 220_000n, ceiling: 250_000n, quote: houseSeller(220_000n, 160_000n) });
  assert.deepEqual(out.deal, { quoteId: "q-1", amount: 174_240n });
  assert.deepEqual(out.transcript.map((s) => s.step), ["request", "offer", "counter", "offer", "counter", "offer", "accept"]);
  assert.match(out.transcript.at(-1)!.detail, /0\.17424 USDC/);
  assert.match(out.transcript.at(-1)!.detail, /0\.22/);
});

test("a buyer whose ceiling is under the floor walks away with no deal", async () => {
  const out = await negotiate({ sellerLabel: "Atlas", ask: 220_000n, ceiling: 150_000n, quote: houseSeller(220_000n, 160_000n) });
  assert.equal(out.deal, null);
  assert.equal(out.transcript.at(-1)!.step, "walk");
});
