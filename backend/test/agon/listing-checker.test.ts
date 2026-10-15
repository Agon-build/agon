import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { createListingChecker } from "../../src/agon/listing/checker.ts";
import { PostgresListingCheckStore, createMemoryListingCheckStore } from "../../src/agon/listing/check-store.ts";
import type { ListingCheckResult } from "../../src/agon/listing/endpoint-check.ts";
import { createAgonTestDatabase, type AgonTestDatabase } from "./database-test-helper.ts";

let db: AgonTestDatabase;
before(async () => { db = await createAgonTestDatabase("listing_checks"); });
after(async () => db.close());

const draft = { name: "A", logoUrl: "https://e.com/l.png", outcome: "o", category: "3", inputs: ["i"], outputs: ["o"], priceUSDC: "0.22", expectedLatencyMs: 1000, privacy: "p", failurePolicy: "f", endpoint: "https://agent.example/run" };
const result = (ok: boolean): ListingCheckResult => ({ checks: [], requiredPassed: ok, certificationScore: null, checkedAt: "" });
const A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

for (const [label, makeStore] of [["memory", () => createMemoryListingCheckStore()], ["Postgres", () => new PostgresListingCheckStore(db.pool)]] as const) {
  test(`a pass counts for 30 minutes for the same endpoint and price, whoever renamed the draft (${label})`, async () => {
    let t = new Date("2026-10-16T12:00:00Z");
    const checker = createListingChecker({ store: makeStore(), run: async () => result(true), now: () => t, limit: () => true });
    const who = label === "memory" ? A : "0xdddddddddddddddddddddddddddddddddddddddd";
    assert.equal(await checker.hasRecentPass(who, draft), false);
    assert.ok((await checker.check(who.toUpperCase().replace("0X", "0x"), { ...draft, name: "Renamed" })).ok);
    assert.equal(await checker.hasRecentPass(who, { endpoint: "https://AGENT.example/run/", priceUSDC: "0.220" }), true);
    assert.equal(await checker.hasRecentPass(who, { endpoint: draft.endpoint, priceUSDC: "0.30" }), false);
    assert.equal(await checker.hasRecentPass(who, { endpoint: "https://agent.example/other", priceUSDC: "0.22" }), false);
    assert.equal(await checker.hasRecentPass("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", draft), false, "passes belong to the builder who ran them");
    t = new Date("2026-10-16T12:31:00Z");
    assert.equal(await checker.hasRecentPass(who, draft), false);
  });
}

test("a failed run never counts, and checks are limited per builder", async () => {
  let n = 0;
  const checker = createListingChecker({ store: createMemoryListingCheckStore(), run: async () => result(false), limit: () => ++n <= 2 });
  assert.ok((await checker.check(A, draft)).ok);
  assert.equal(await checker.hasRecentPass(A, draft), false);
  assert.ok((await checker.check(A, draft)).ok);
  assert.deepEqual(await checker.check(A, draft), { ok: false, code: "rate_limited" });
});

test("the default limit is 10 checks an hour per builder", async () => {
  const checker = createListingChecker({ store: createMemoryListingCheckStore(), run: async () => result(true) });
  for (let i = 0; i < 10; i += 1) assert.ok((await checker.check(A, draft)).ok, `check ${i + 1}`);
  assert.deepEqual(await checker.check(A, draft), { ok: false, code: "rate_limited" });
  assert.ok((await checker.check("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", draft)).ok, "another builder has their own budget");
});
