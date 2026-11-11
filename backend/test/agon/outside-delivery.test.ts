import assert from "node:assert/strict";
import test from "node:test";
import type { Address } from "viem";

import { answerProblem, isOutsideRef } from "../../src/agon/payments/answer-check.ts";
import type { OutsideOutcome } from "../../src/agon/payments/types.ts";
import type { CatalogEntry, RouteSource } from "../../src/agon/routing/catalog.ts";
import { byDelivery, createDeliveryRecords, deliveryRate, deliveryRecords, type DeliveryRecord } from "../../src/agon/routing/delivery-record.ts";
import type { Intent } from "../../src/agon/routing/intent.ts";
import { groupCandidates } from "../../src/agon/routing/rank.ts";
import { createRouter, type RouteRuntime } from "../../src/agon/routing/router.ts";
import { MemoryPaymentsStore } from "./payments-memory-store.ts";

const NOW = new Date("2026-11-11T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
const outcome = (providerRef: string, delivered: boolean, hours: number, seconds: number | null = 4): OutsideOutcome => ({ providerRef, delivered, at: hoursAgo(hours), seconds });

test("an answer with nothing in it, or only an error, is not an answer", () => {
  for (const empty of [null, undefined, "", "   ", [], {}, { data: [], note: "" }, { result: null }, { items: {}, text: " " }, { contentType: "text/plain", text: "  " }, { contentType: "image/png", bytes: 0 }]) {
    assert.equal(answerProblem(empty), "empty answer", JSON.stringify(empty));
  }
  for (const error of [{ error: "upstream timeout" }, { error: "bad", message: "try later", code: 504 }, { error: { type: "rate_limited" }, status: 429 }, { success: false, error: "no data" }]) {
    assert.equal(answerProblem(error), "error in place of an answer", JSON.stringify(error));
  }
  for (const real of ["Apple: Buy", 0, false, [1], { price: 1.23 }, { price: 0 }, { ok: false, refunded: true }, { error: "partial", data: [1] }, { success: true, error: "" }, { contentType: "text/plain", text: "hi" }, { contentType: "image/png", bytes: 2048 }, { status: "queued", poll_url: "/jobs/1" }, { error: null, result: "x" }, { ok: true, error: "ignored" }]) {
    assert.equal(answerProblem(real), null, JSON.stringify(real));
  }
  assert.deepEqual([isOutsideRef("circle:https://x.example"), isOutsideRef("agent:scout"), isOutsideRef("house:atlas")], [true, false, false]);
});

test("the delivery record counts paid hires, failures in a row and the typical time to answer", () => {
  const records = deliveryRecords([
    outcome("circle:good", true, 1, 2), outcome("circle:good", true, 30, 9), outcome("circle:good", false, 50), outcome("circle:good", true, 70, 5),
    outcome("circle:new", true, 3),
    outcome("circle:bad", false, 2), outcome("circle:bad", false, 5), outcome("circle:bad", true, 9),
    outcome("circle:was-bad", false, 30), outcome("circle:was-bad", false, 40),
    outcome("circle:recovered", true, 1), outcome("circle:recovered", false, 2), outcome("circle:recovered", false, 3),
  ], NOW);
  assert.deepEqual(records.get("circle:good"), { paid: 4, delivered: 3, failedInARow: 0, restingUntil: null, typicalSeconds: 5 });
  assert.deepEqual([deliveryRate(records.get("circle:good")), deliveryRate(records.get("circle:new")), deliveryRate(undefined)], [0.75, null, null], "a rate is stated only from three paid hires");
  // Two failures in a row rest a service for 24 hours from the newer one.
  const bad = records.get("circle:bad")!;
  assert.deepEqual([bad.paid, bad.delivered, bad.failedInARow, bad.restingUntil?.toISOString()], [3, 1, 2, "2026-11-12T10:00:00.000Z"]);
  assert.equal(records.get("circle:was-bad")!.restingUntil, null, "the rest is over after a day");
  assert.deepEqual([records.get("circle:recovered")!.failedInARow, records.get("circle:recovered")!.restingUntil], [0, null], "a delivery ends the run of failures");
  assert.equal(deliveryRecords([], NOW).size, 0);
});

test("a service that delivers comes before one with no record, and one that mostly fails comes after", () => {
  const rec = (paid: number, delivered: number): DeliveryRecord => ({ paid, delivered, failedInARow: 0, restingUntil: null, typicalSeconds: null });
  assert.ok(byDelivery(rec(4, 4), undefined) < 0);
  assert.ok(byDelivery(undefined, rec(4, 1)) < 0);
  assert.ok(byDelivery(rec(4, 4), rec(4, 3)) < 0, "the higher rate first");
  assert.equal(byDelivery(rec(2, 0), undefined), 0, "under three paid hires there is no standing yet");
  assert.equal(byDelivery(rec(3, 3), rec(6, 6)), 0, "equal rates are left to the price");
});

test("the records are read once a minute, and a failed read is asked again", async () => {
  let t = NOW.getTime();
  let loads = 0;
  let fail = false;
  const since: Date[] = [];
  const records = createDeliveryRecords({ now: () => new Date(t), load: async (from) => { loads += 1; since.push(from); if (fail) throw new Error("db down"); return [outcome("circle:a", true, 1)]; } });
  assert.equal((await records()).get("circle:a")!.paid, 1);
  await records();
  assert.equal(loads, 1);
  assert.equal(since[0]!.toISOString(), "2026-10-12T12:00:00.000Z", "thirty days back");
  t += 61_000;
  fail = true;
  await assert.rejects(records());
  fail = false;
  assert.equal((await records()).size, 1);
  assert.equal(loads, 3);
});

const entry = (over: Partial<CatalogEntry>): CatalogEntry => ({
  source: "circle", reference: "circle:x", name: "Polymarket odds", provider: "P", category: "FINANCIAL_ANALYSIS", description: "Polymarket market check", url: "https://x.example/a",
  method: "GET", inputSchema: null, price: 10_000n, payTo: `0x${"c1".repeat(20)}` as Address, network: "arc", rating: { tier: "unrated", score: null }, latencyMs: null, tags: [], ...over,
});
const intent: Intent = { kind: "analysis", query: "polymarket market check", values: {} };

test("the Outside market group orders by what Agon has seen delivered, then by price, and says what it has seen", () => {
  const deliveries = deliveryRecords([
    ...[1, 2, 3, 4].map((h) => outcome("circle:proven", true, h)),
    outcome("circle:weak", true, 1), outcome("circle:weak", false, 30), outcome("circle:weak", false, 60), outcome("circle:weak", false, 90),
    outcome("circle:once", true, 1),
  ], NOW);
  const list = [entry({ reference: "circle:weak", price: 1_000n }), entry({ reference: "circle:cheap-unknown", price: 2_000n }), entry({ reference: "circle:once", price: 5_000n }), entry({ reference: "circle:proven", price: 90_000n })];
  const opts = { feeBps: 500, feeMin: 10_000n, downranked: new Set<string>(), category: "prediction" as const };
  const g = groupCandidates(list, intent, { ...opts, deliveries });
  assert.deepEqual(g.outside.map((c) => c.reference), ["circle:proven", "circle:cheap-unknown", "circle:once", "circle:weak"]);
  assert.deepEqual(g.outside.map((c) => c.reason), [
    "Outside market, delivered 4 of 4 paid hires through Agon", "Outside market, not ranked by Agon",
    "Outside market, delivered 1 of 1 paid hire through Agon", "Outside market, delivered 1 of 4 paid hires through Agon",
  ]);
  assert.deepEqual(g.outside.map((c) => c.delivery ?? null), [{ paid: 4, delivered: 4 }, null, { paid: 1, delivered: 1 }, { paid: 4, delivered: 1 }]);
  assert.ok(g.outside.every((c) => c.rating.score === null && c.rating.tier === "unrated"), "a delivery count is never an Agon score");
  // With no record kept, the order is by price as before.
  assert.deepEqual(groupCandidates(list, intent, opts).outside.map((c) => c.reference), ["circle:weak", "circle:cheap-unknown", "circle:once", "circle:proven"]);
});

function router(deliveries?: () => Promise<Map<string, DeliveryRecord>>) {
  const rows = [entry({ reference: "circle:resting" }), entry({ reference: "circle:fine", price: 20_000n })];
  const src = (id: "agon" | "circle"): RouteSource => ({ id, status: () => "ok", search: async () => rows.filter((r) => r.source === id), all: async () => rows.filter((r) => r.source === id) });
  return createRouter({
    sources: [src("agon"), src("circle")],
    runtimes: { "arc-testnet": {} as RouteRuntime },
    readIntent: async (text) => ({ kind: "analysis", query: text, values: {} }),
    judge: async () => rows.map((r) => r.reference),
    fill: async () => ({ ok: true as const, input: {} }),
    feeBps: 150, feeAddress: { "arc-testnet": null, arc: null },
    leadAsk: async () => ({ ok: false, code: "invalid_question" }),
    store: new MemoryPaymentsStore(),
    approvalUrl: (t) => `https://agon.surf/approve?t=${t}`,
    ...(deliveries ? { deliveries } : {}),
    now: () => NOW,
  });
}

test("a service that took payment twice in a row without delivering is not offered for a day", async () => {
  const records = async () => deliveryRecords([outcome("circle:resting", false, 1), outcome("circle:resting", false, 2)], NOW);
  const choices = await router(records).route("op:x", "polymarket market check", { choices: true, category: "prediction" });
  assert.ok(choices.kind === "choices");
  assert.deepEqual(choices.groups.outside.map((c) => c.reference), ["circle:fine"]);
  const browse = await router(records).browse("op:x", "prediction");
  assert.deepEqual(browse.groups.outside.map((c) => c.reference), ["circle:fine"]);
  const pick = await router(records).route("op:x", "polymarket market check");
  assert.ok(pick.kind === "pick" && pick.pick.reference === "circle:fine" && pick.alternatives.length === 0);
  // With no record, or a record that cannot be read, both are offered.
  for (const r of [router(), router(async () => { throw new Error("db down"); })]) {
    const out = await r.route("op:x", "polymarket market check", { choices: true, category: "prediction" });
    assert.ok(out.kind === "choices");
    assert.deepEqual(out.groups.outside.map((c) => c.reference).sort(), ["circle:fine", "circle:resting"]);
  }
});
