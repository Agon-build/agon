import assert from "node:assert/strict";
import test from "node:test";

import { REPORT_LIMITS, reportBody } from "./report-body.ts";

// Audit B5 (2026-11-09): the API now refuses browser events over 500 characters
// of message or 2 KB of context, so the reporter trims before it sends.
test("a report keeps its kind, and a long message or context is cut to what the API accepts", () => {
  const long = reportBody("client_error", { level: "error", message: "x".repeat(5_000), context: { stack: "s".repeat(10_000) } });
  assert.equal(long.kind, "client_error");
  assert.equal(long.message!.length, REPORT_LIMITS.messageChars);
  assert.deepEqual(long.context, { truncated: true });
  assert.ok(new TextEncoder().encode(JSON.stringify(long)).length < 4096, "the whole body fits the API's limit");

  const small = reportBody("login", { context: { method: "email" }, address: "0xabc" });
  assert.deepEqual(small, { kind: "login", level: undefined, message: undefined, context: { method: "email" }, address: "0xabc" });
});
