import assert from "node:assert/strict";
import test from "node:test";

import { listLiveListings } from "../../src/agon/tests/live-listings.ts";

const item = (id: string, over: Record<string, unknown> = {}) => ({ id, agentId: id, category: "3", firstParty: false, status: "Listed", risk: { quarantineReason: null }, ...over });

test("all pages are read and only listed, unquarantined listings are kept", async () => {
  const pages: Record<string, { items: ReturnType<typeof item>[]; nextCursor: string | null }> = {
    start: { items: [item("1"), item("2", { status: "Delisted" })], nextCursor: "p2" },
    p2: { items: [item("3", { risk: { quarantineReason: "bad anchor" } }), item("4")], nextCursor: null },
  };
  const out = await listLiveListings(async (cursor) => ({ ok: true, value: pages[cursor ?? "start"]! }));
  assert.deepEqual(out.map((l) => l.id), ["1", "4"]);
});

test("a failed page throws instead of returning a partial list, so snapshots are kept", async () => {
  await assert.rejects(listLiveListings(async (cursor) => (cursor ? { ok: false } : { ok: true, value: { items: [item("1")], nextCursor: "p2" } })), /listing/);
});
