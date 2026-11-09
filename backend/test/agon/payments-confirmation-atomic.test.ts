import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Address } from "viem";

import { MAX_CODE_ATTEMPTS, issueConfirmation, redeemConfirmation } from "../../src/agon/payments/limits.ts";
import { PostgresPaymentsStore } from "../../src/agon/payments/store.ts";
import { createAgonTestDatabase, type AgonTestDatabase } from "./database-test-helper.ts";

// Audit B3 (2026-11-09), second half: the 4-digit hire code counted attempts
// and marked use with read-then-write, so parallel requests slipped past both.

let db: AgonTestDatabase;
let store: PostgresPaymentsStore;
before(async () => {
  db = await createAgonTestDatabase("pay_confirm");
  store = new PostgresPaymentsStore(db.pool);
});
after(async () => db.close());

const PAYEE = `0x${"c".repeat(40)}` as Address;
const now = new Date("2026-11-09T10:00:00Z");

test("parallel wrong hire codes are capped at five", async () => {
  await issueConfirmation(store, { walletRef: "budget:race", jobId: "00000000-0000-4000-8000-00000000000a", amount: 100_000n, payee: PAYEE, now, digits: () => 4321 });
  const tries = Array.from({ length: 30 }, (_, i) => String(1000 + i));
  const results = await Promise.all(tries.map((code) => redeemConfirmation(store, { walletRef: "budget:race", code, now })));
  const compared = results.filter((r) => !r.ok && r.code === "wrong_code").length;
  assert.ok(compared <= MAX_CODE_ATTEMPTS, `at most ${MAX_CODE_ATTEMPTS} codes compared, saw ${compared}`);
  assert.deepEqual(await redeemConfirmation(store, { walletRef: "budget:race", code: "4321", now }), { ok: false, code: "too_many_attempts" });
});

test("the right hire code sent twice at once is redeemed once", async () => {
  await issueConfirmation(store, { walletRef: "budget:twice", jobId: "00000000-0000-4000-8000-00000000000b", amount: 100_000n, payee: PAYEE, now, digits: () => 1357 });
  const results = await Promise.all(Array.from({ length: 6 }, () => redeemConfirmation(store, { walletRef: "budget:twice", code: "1357", now })));
  assert.equal(results.filter((r) => r.ok).length, 1, JSON.stringify(results.map((r) => (r.ok ? "ok" : r.code))));
});
