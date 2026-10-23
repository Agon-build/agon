import assert from "node:assert/strict";
import test from "node:test";

import { deliveryForJob } from "../../src/agon/deliveries/summary.ts";

const SITE = "https://agon.surf";
const base = { jobId: "11111111-2222-3333-4444-555555555555", depth: 0, providerLabel: "Pitch", priceAtomic: 150_000n, request: {} };
const plain = (s: string) => assert.ok(!s.includes("—") && !/ \+ /.test(s) && !/[{}]/.test(s), s);

test("a delivered forecast reads as the chance against the market, with the price and the receipt", () => {
  const d = deliveryForJob({ ...base, state: "delivered", result: { agent: "Pitch", market: { question: "Will Arsenal win on Saturday?" }, probabilityBps: 6200, crowdBps: 5500, reasons: ["Arsenal unbeaten at home in 9.", "x"] } }, SITE)!;
  assert.equal(d.title, "Your answer from Pitch");
  assert.equal(d.body, "Will Arsenal win on Saturday? Pitch gives Yes a 62% chance; the market says 55%. Arsenal unbeaten at home in 9. You paid 0.15 USDC.");
  assert.equal(d.href, `${SITE}/r/${base.jobId}`);
  [d.title, d.body].forEach(plain);
});

test("the Lead's answer, Rules Check, Scout and Resolution Watch each read in plain words", () => {
  const lead = deliveryForJob({ ...base, providerLabel: "Agon Lead Agent", priceAtomic: 300_000n, state: "delivered", result: { ok: true, probabilityBps: 3400, marketPriceBps: 4100, reasons: ["Polls tightened."], market: { question: "Will the Fed cut in December?" } } }, SITE)!;
  assert.equal(lead.body, "Will the Fed cut in December? Agon Lead Agent gives Yes a 34% chance; the market says 41%. Polls tightened. You paid 0.30 USDC.");

  const rules = deliveryForJob({ ...base, providerLabel: "Rules Check", priceAtomic: 250_000n, state: "delivered", result: { market: { question: "Will X happen?" }, risk: "high", traps: [{ explain: "Only an official announcement counts." }] } }, SITE)!;
  assert.equal(rules.body, "Will X happen? High dispute risk. Only an official announcement counts. You paid 0.25 USDC.");

  const scout = deliveryForJob({ ...base, providerLabel: "Scout", priceAtomic: 100_000n, state: "delivered", result: { market: { question: "Will Y?" }, verdict: "avoid", flags: [{ detail: "The spread is 9 cents." }] } }, SITE)!;
  assert.equal(scout.body, "Will Y? Scout says avoid trading it. The spread is 9 cents. You paid 0.10 USDC.");

  const watch = deliveryForJob({ ...base, providerLabel: "Resolution Watch", priceAtomic: 250_000n, state: "delivered", result: { watchId: "abc", markets: [{}, {}, {}], endsAt: "2026-12-22T00:00:00Z" } }, SITE)!;
  assert.equal(watch.title, "Resolution Watch is watching 3 markets");
  assert.equal(watch.body, "You will get an alert when a result is proposed, challenged or final. You paid 0.25 USDC.");
  assert.equal(watch.href, `${SITE}/watch/abc`);
});

test("an answer Agon cannot read still says it is ready", () => {
  const d = deliveryForJob({ ...base, providerLabel: "Outside Agent", state: "delivered", result: { foo: 1 } }, SITE)!;
  assert.deepEqual([d.title, d.body], ["Your answer from Outside Agent", "It is ready on Agon. You paid 0.15 USDC."]);
});

test("a refund and a failure say what happened to the money", () => {
  const refunded = deliveryForJob({ ...base, providerLabel: "Agon Lead Agent", state: "refunded", result: { ok: false, refunded: true, code: "no_market" } }, SITE)!;
  assert.equal(refunded.title, "Agon Lead Agent could not finish, and you were refunded");
  assert.match(refunded.body, /^Polymarket has no open market that matches this question\./);

  const closed = deliveryForJob({ ...base, state: "failed", result: { error: "market_closed" } }, SITE)!;
  assert.equal(closed.title, "Pitch did not run, and nothing was charged");
  assert.match(closed.body, /already closed/);

  const paid = deliveryForJob({ ...base, state: "failed", result: { error: "delivery_failed" } }, SITE)!;
  assert.equal(paid.title, "Pitch was paid but did not deliver");
  assert.match(paid.body, /receipt/);
});

test("jobs still running, unpaid quotes and sub-jobs are not delivered", () => {
  for (const state of ["quoted", "paying", "paid"]) assert.equal(deliveryForJob({ ...base, state, result: null }, SITE), null, state);
  assert.equal(deliveryForJob({ ...base, depth: 1, state: "delivered", result: { probabilityBps: 1 } }, SITE), null);
});
