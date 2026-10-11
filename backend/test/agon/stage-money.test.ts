import assert from "node:assert/strict";
import test from "node:test";

import { parseUsdc } from "../../src/agon/stage/money.ts";

test("user amounts parse to USDC base units without floating point", () => {
  assert.equal(parseUsdc("0.50"), 500_000n);
  assert.equal(parseUsdc("0.5"), 500_000n);
  assert.equal(parseUsdc(".5"), 500_000n);
  assert.equal(parseUsdc("1"), 1_000_000n);
  assert.equal(parseUsdc("$0.30"), 300_000n);
  assert.equal(parseUsdc("0.30 USDC"), 300_000n);
  assert.equal(parseUsdc(" 2.000001 usdc "), 2_000_001n);
  assert.equal(parseUsdc("0.1234567"), null, "more than 6 decimals");
  assert.equal(parseUsdc("0"), null);
  assert.equal(parseUsdc("-1"), null);
  assert.equal(parseUsdc("1e3"), null);
  assert.equal(parseUsdc("abc"), null);
  assert.equal(parseUsdc("1000001"), null, "over a million USDC is never a user amount");
});
