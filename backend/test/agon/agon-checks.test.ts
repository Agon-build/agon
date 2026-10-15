import assert from "node:assert/strict";
import test from "node:test";

import { runAgonChecksOnce } from "../../src/agon/tests/agon-checks.ts";

test("each testable listing is checked at most once per interval; others are skipped", async () => {
  const checked: string[] = [];
  const last: Record<string, Date | null> = { a: null, b: new Date("2026-10-16T10:00:00Z"), c: new Date("2026-10-16T05:00:00Z") };
  const now = new Date("2026-10-16T12:00:00Z");
  const ran = await runAgonChecksOnce({
    listListed: async () => [
      { listingReference: "a", category: "3" },
      { listingReference: "b", category: "1" },
      { listingReference: "c", category: "8" },
      { listingReference: "d", category: "6" },
    ],
    lastCheckAt: async (ref) => last[ref] ?? null,
    check: async (ref) => { checked.push(ref); },
    intervalMs: 6 * 3_600_000,
    now: () => now,
  });
  assert.deepEqual(checked, ["a", "c"]);
  assert.equal(ran, 2);
});

test("one listing failing does not stop the others", async () => {
  const checked: string[] = [];
  await runAgonChecksOnce({
    listListed: async () => [{ listingReference: "a", category: "3" }, { listingReference: "b", category: "3" }],
    lastCheckAt: async () => null,
    check: async (ref) => { if (ref === "a") throw new Error("boom"); checked.push(ref); },
    intervalMs: 1000,
    now: () => new Date(),
  });
  assert.deepEqual(checked, ["b"]);
});
