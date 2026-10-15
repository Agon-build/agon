import assert from "node:assert/strict";
import test from "node:test";

import { collectPages, providerLabel, servicesForAgent } from "./agent-services.ts";
import type { AgonListing } from "./types.ts";

const base = (id: string, rail: "X402" | "Escrow", status: "Listed" | "Suspended" = "Listed", name = `S${id}`, agentId = "41") => ({
  id, agentId, status, payment: { rail, directX402: rail === "X402", escrowEligible: rail === "Escrow" }, firstParty: true,
  verification: { status: "Verified" }, risk: { quarantineReason: null }, manifest: { body: { service: { name, description: "d" }, pricing: { amountUSDC: "0.22" } } }, category: "3",
} as unknown as AgonListing);

test("an agent's services list every listed service with Hire for per call and Order for paid on delivery", () => {
  const a = base("a", "X402", "Listed", "Forecast");
  const rows = servicesForAgent([base("b", "Escrow", "Listed", "Research report"), a, base("c", "X402", "Suspended"), base("d", "X402", "Listed", "Other agent", "77")], a);
  assert.deepEqual(rows.map((r) => [r.name, r.action, r.href, r.current, r.price]), [
    ["Forecast", "Hire", "/agents/a", true, "0.22 USDC"],
    ["Research report", "Order", "/agents/b", false, "0.22 USDC"],
  ]);
});

test("the current listing is always shown, even before the list loads", () => {
  const a = base("a", "X402", "Listed", "Forecast");
  assert.deepEqual(servicesForAgent([], a).map((r) => r.name), ["Forecast"]);
});

test("the provider line says Built by Agon only for Agon's agents", () => {
  assert.equal(providerLabel(base("a", "X402")), "Built by Agon");
  assert.equal(providerLabel({ ...base("a", "X402"), firstParty: false } as AgonListing), "Independent agent");
  assert.equal(providerLabel({ ...base("a", "X402"), firstParty: undefined } as AgonListing), "Independent agent");
});

test("an agent's listings are read across every page, up to a safe limit", async () => {
  const pages: Record<string, { items: number[]; nextCursor: string | null }> = { start: { items: [1, 2], nextCursor: "p2" }, p2: { items: [3], nextCursor: "p3" }, p3: { items: [4], nextCursor: null } };
  const asked: (string | null)[] = [];
  assert.deepEqual(await collectPages(async (cursor) => { asked.push(cursor); return pages[cursor ?? "start"]!; }), [1, 2, 3, 4]);
  assert.deepEqual(asked, [null, "p2", "p3"]);
  let calls = 0;
  const endless = await collectPages(async () => { calls += 1; return { items: [calls], nextCursor: "again" }; }, 5);
  assert.deepEqual(endless, [1, 2, 3, 4, 5]);
});
