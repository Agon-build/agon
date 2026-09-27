import assert from "node:assert/strict";
import test from "node:test";

import { clientAddress } from "../../src/http/client-address.ts";

const headers = (values: Record<string, string>) => (name: string) => values[name.toLowerCase()];

test("uses the first X-Forwarded-For entry written by the proxy", () => {
  assert.equal(clientAddress(headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.2" })), "203.0.113.7");
});

test("ignores client-supplied CF-Connecting-IP and X-Real-IP", () => {
  const spoofed = headers({ "cf-connecting-ip": "198.51.100.1", "x-real-ip": "198.51.100.2", "x-forwarded-for": "203.0.113.9" });
  assert.equal(clientAddress(spoofed), "203.0.113.9");
  assert.equal(clientAddress(headers({ "cf-connecting-ip": "198.51.100.1", "x-real-ip": "198.51.100.2" })), "unknown");
});

test("bounds the value so it cannot bloat a rate-limit key", () => {
  assert.equal(clientAddress(headers({ "x-forwarded-for": "a".repeat(500) })).length, 80);
});
