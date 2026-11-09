import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { MAX_ATTEMPTS, OtpError, startOtp, verifyOtp } from "../../src/lib/emailOtpStore.ts";
import { createAgonTestDatabase, type AgonTestDatabase } from "./database-test-helper.ts";

// Audit B3 (2026-11-09): attempts were read, compared, then written, so
// parallel guesses all saw the same count and the 5-try cap did not hold.

let db: AgonTestDatabase;
before(async () => { db = await createAgonTestDatabase("otp_atomic"); });
after(async () => db.close());

const PEPPER = "test-pepper-0123456789";
const T0 = new Date("2026-11-09T10:00:00Z");

const codeOf = (e: unknown) => (e instanceof OtpError ? e.code : "unexpected");

test("parallel wrong guesses never get more than five tries", async () => {
  const email = "guess@example.com";
  await startOtp(db.pool, { email, ip: "203.0.113.9", pepper: PEPPER, now: T0, generate: () => "424242", deliver: async () => {} });
  const guesses = Array.from({ length: 40 }, (_, i) => String(100000 + i));
  const outcomes = await Promise.all(guesses.map((code) => verifyOtp(db.pool, { email, code, pepper: PEPPER, now: T0 }).then(() => "ok", codeOf)));
  const compared = outcomes.filter((o) => o === "otp_mismatch").length;
  assert.ok(compared <= MAX_ATTEMPTS, `at most ${MAX_ATTEMPTS} guesses compared, saw ${compared}`);
  assert.ok(outcomes.every((o) => o === "otp_mismatch" || o === "otp_too_many_attempts"), outcomes.join(","));

  // The right code no longer works once the tries are spent.
  await assert.rejects(verifyOtp(db.pool, { email, code: "424242", pepper: PEPPER, now: T0 }), (e: unknown) => e instanceof OtpError && e.code === "otp_too_many_attempts");
});

test("five sequential misses then the right code is refused", async () => {
  const email = "seq@example.com";
  await startOtp(db.pool, { email, ip: "203.0.113.10", pepper: PEPPER, now: T0, generate: () => "777777", deliver: async () => {} });
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    await assert.rejects(verifyOtp(db.pool, { email, code: "000000", pepper: PEPPER, now: T0 }), (e: unknown) => codeOf(e) === "otp_mismatch");
  }
  await assert.rejects(verifyOtp(db.pool, { email, code: "777777", pepper: PEPPER, now: T0 }), (e: unknown) => codeOf(e) === "otp_too_many_attempts");
});

test("an expired code is refused and removed", async () => {
  const email = "old@example.com";
  await startOtp(db.pool, { email, ip: "203.0.113.11", pepper: PEPPER, now: T0, generate: () => "888888", deliver: async () => {} });
  await assert.rejects(verifyOtp(db.pool, { email, code: "888888", pepper: PEPPER, now: new Date(T0.getTime() + 10 * 60_000 + 1) }), (e: unknown) => codeOf(e) === "otp_expired");
  await assert.rejects(verifyOtp(db.pool, { email, code: "888888", pepper: PEPPER, now: T0 }), (e: unknown) => codeOf(e) === "otp_not_started");
});
