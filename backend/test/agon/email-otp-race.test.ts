import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import {
  OtpError, VERIFY_TTL_MS, checkVerification, claimVerification, startOtp, verifyOtp,
} from "../../src/lib/emailOtpStore.ts";
import { createAgonTestDatabase, type AgonTestDatabase } from "./database-test-helper.ts";

// Audit B1 (2026-11-09): a verified code used to be keyed by email alone, so
// any client naming the email could take the session. The client that typed
// the code now gets a one-time token, and only that token continues.

let db: AgonTestDatabase;
before(async () => { db = await createAgonTestDatabase("otp_race"); });
after(async () => db.close());

const PEPPER = "test-pepper-0123456789";
const T0 = new Date("2026-11-09T10:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

async function sendCode(email: string, code: string, now = T0) {
  await startOtp(db.pool, { email, ip: "203.0.113.7", pepper: PEPPER, now, generate: () => code, deliver: async () => {} });
}

test("only the client that verified the code can continue, and only once", async () => {
  const email = "victim@example.com";
  await sendCode(email, "123456");
  const a = await verifyOtp(db.pool, { email, code: "123456", pepper: PEPPER, now: at(1000) });
  assert.match(a.verificationToken, /^[A-Za-z0-9_-]{43}$/, "32 random bytes, base64url");

  // Client B knows the email and polls; it has no token.
  assert.equal(await claimVerification(db.pool, { email, token: "", now: at(2000) }), false);
  assert.equal(await claimVerification(db.pool, { email, token: "x".repeat(43), now: at(2000) }), false);
  assert.equal(await checkVerification(db.pool, { email, token: "x".repeat(43), now: at(2000) }), false);

  // A's token checks without being used up, then claims exactly once.
  assert.equal(await checkVerification(db.pool, { email, token: a.verificationToken, now: at(3000) }), true);
  assert.equal(await checkVerification(db.pool, { email, token: a.verificationToken, now: at(3000) }), true);
  assert.equal(await claimVerification(db.pool, { email, token: a.verificationToken, now: at(4000) }), true);
  assert.equal(await claimVerification(db.pool, { email, token: a.verificationToken, now: at(5000) }), false);
  assert.equal(await checkVerification(db.pool, { email, token: a.verificationToken, now: at(5000) }), false);
});

test("a token is tied to its email and lapses after 15 minutes", async () => {
  const email = "late@example.com";
  await sendCode(email, "654321");
  const a = await verifyOtp(db.pool, { email, code: "654321", pepper: PEPPER, now: T0 });
  assert.equal(await claimVerification(db.pool, { email: "other@example.com", token: a.verificationToken, now: at(1) }), false);
  assert.equal(await claimVerification(db.pool, { email, token: a.verificationToken, now: at(VERIFY_TTL_MS + 1) }), false);
});

test("two parallel claims with the same token: one wins", async () => {
  const email = "twice@example.com";
  await sendCode(email, "111222");
  const a = await verifyOtp(db.pool, { email, code: "111222", pepper: PEPPER, now: T0 });
  const results = await Promise.all(Array.from({ length: 8 }, () => claimVerification(db.pool, { email, token: a.verificationToken, now: at(10) })));
  assert.equal(results.filter(Boolean).length, 1);
});

test("a new code voids the token from the earlier one", async () => {
  const email = "restart@example.com";
  await sendCode(email, "333444");
  const a = await verifyOtp(db.pool, { email, code: "333444", pepper: PEPPER, now: T0 });
  await sendCode(email, "555666", at(61_000));
  assert.equal(await claimVerification(db.pool, { email, token: a.verificationToken, now: at(62_000) }), false);
});

test("verify refuses an unknown email and a malformed code", async () => {
  await assert.rejects(verifyOtp(db.pool, { email: "nobody@example.com", code: "123456", pepper: PEPPER, now: T0 }), (e: unknown) => e instanceof OtpError && e.code === "otp_not_started");
  await assert.rejects(verifyOtp(db.pool, { email: "nobody@example.com", code: "12ab56", pepper: PEPPER, now: T0 }), (e: unknown) => e instanceof OtpError && e.code === "otp_invalid_format");
});
