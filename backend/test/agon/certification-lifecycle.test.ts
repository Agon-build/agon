import assert from "node:assert/strict";
import test from "node:test";

import { evaluateAgonLifecycle, nextAgonLifecycleCheck } from "../../src/agon/certification-lifecycle.ts";

test("a clean initial lifecycle check approves the exact service version", () => {
  assert.deepEqual(evaluateAgonLifecycle({
    previousStatus: "pending",
    previousConsecutiveFailures: 0,
    passed: true,
    failureThreshold: 3,
  }), { status: "healthy", consecutiveFailures: 0, actions: ["approve"] });
});

test("transient failures warn before repeated defaults suspend", () => {
  const warning = evaluateAgonLifecycle({
    previousStatus: "healthy",
    previousConsecutiveFailures: 0,
    passed: false,
    failureThreshold: 3,
  });
  assert.deepEqual(warning, { status: "warning", consecutiveFailures: 1, actions: ["alert"] });
  const suspended = evaluateAgonLifecycle({
    previousStatus: "warning",
    previousConsecutiveFailures: 2,
    passed: false,
    failureThreshold: 3,
  });
  assert.deepEqual(suspended, { status: "suspended", consecutiveFailures: 3, actions: ["alert", "suspend"] });
});

// Owner decision 2026-11-11: a paused listing comes back after two passes in a row.
test("a suspended service recovers only after two passes in a row", () => {
  const first = evaluateAgonLifecycle({ previousStatus: "suspended", previousConsecutiveFailures: 4, passed: true, failureThreshold: 3 });
  assert.deepEqual(first, { status: "warning", consecutiveFailures: 4, actions: [] }, "the first pass writes nothing and keeps the failure count");
  const second = evaluateAgonLifecycle({ previousStatus: first.status, previousConsecutiveFailures: first.consecutiveFailures, passed: true, failureThreshold: 3 });
  assert.deepEqual(second, { status: "healthy", consecutiveFailures: 0, actions: ["recover"] });
  // A failure between the two passes suspends it again at once.
  const relapse = evaluateAgonLifecycle({ previousStatus: first.status, previousConsecutiveFailures: first.consecutiveFailures, passed: false, failureThreshold: 3 });
  assert.deepEqual(relapse, { status: "suspended", consecutiveFailures: 5, actions: ["alert", "suspend"] });
  // A listing that only had a warning still recovers on its next pass.
  assert.deepEqual(evaluateAgonLifecycle({ previousStatus: "warning", previousConsecutiveFailures: 1, passed: true, failureThreshold: 3 }), { status: "healthy", consecutiveFailures: 0, actions: ["recover"] });
});

test("after a pass the next check comes at an uneven time; after a failure it comes at the retry time", () => {
  const now = new Date("2026-11-11T12:00:00Z");
  const next = (passed: boolean, random?: () => number) => nextAgonLifecycleCheck({ now, passed, checkIntervalMs: 6 * 3_600_000, warningRetryMs: 15 * 60_000, ...(random ? { random } : {}) }).getTime() - now.getTime();
  assert.equal(next(true), 6 * 3_600_000, "with no spread, the fixed interval");
  assert.equal(next(true, () => 0), 3 * 3_600_000, "at the earliest, half an interval");
  assert.equal(next(true, () => 0.5), 6 * 3_600_000);
  assert.equal(next(true, () => 1), 9 * 3_600_000, "at the latest, one and a half");
  assert.equal(next(true, () => 7), 9 * 3_600_000, "a value out of range is held inside it");
  assert.equal(next(false, () => 0), 15 * 60_000, "a retry after a failure is not spread");
});

test("healthy and warning checks use separate bounded schedules", () => {
  const now = new Date("2026-09-21T12:00:00.000Z");
  assert.equal(nextAgonLifecycleCheck({ now, passed: true, checkIntervalMs: 21_600_000, warningRetryMs: 900_000 }).toISOString(), "2026-09-21T18:00:00.000Z");
  assert.equal(nextAgonLifecycleCheck({ now, passed: false, checkIntervalMs: 21_600_000, warningRetryMs: 900_000 }).toISOString(), "2026-09-21T12:15:00.000Z");
});
