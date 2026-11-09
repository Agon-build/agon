import assert from "node:assert/strict";
import test from "node:test";

import { EMAIL_AUTH_LIMITS, createEmailAuthGate } from "../../src/lib/emailAuthLimits.ts";

// Audit B1 (2026-11-09): the email sign-in routes had no rate limit.

test("each address and each email gets a bounded number of sign-in calls", () => {
  const gate = createEmailAuthGate();
  const t = 1_000_000;
  for (let i = 0; i < EMAIL_AUTH_LIMITS.perEmail; i++) assert.equal(gate("198.51.100.1", "a@example.com", t + i), true);
  assert.equal(gate("198.51.100.2", "a@example.com", t + 100), false, "same email from another address");
  assert.equal(gate("198.51.100.2", "b@example.com", t + 100), true, "another email is unaffected");
  assert.equal(gate("198.51.100.1", "a@example.com", t + EMAIL_AUTH_LIMITS.windowMs + 1), true, "the window slides");
});

test("one address cannot spread calls over many emails without limit", () => {
  const gate = createEmailAuthGate();
  const t = 2_000_000;
  for (let i = 0; i < EMAIL_AUTH_LIMITS.perIp; i++) assert.equal(gate("198.51.100.9", `u${i}@example.com`, t), true);
  assert.equal(gate("198.51.100.9", "fresh@example.com", t), false);
  assert.ok(EMAIL_AUTH_LIMITS.perEmail <= 10 && EMAIL_AUTH_LIMITS.perIp <= 30);
});
