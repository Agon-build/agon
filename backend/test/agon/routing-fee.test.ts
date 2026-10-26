import assert from "node:assert/strict";
import test from "node:test";

import { feeFor, totalWithFee } from "../../src/agon/routing/fee.ts";

test("fee is 1.5% rounded up to the next atomic unit", () => {
  assert.equal(feeFor(300_000n, 150), 4_500n);
  assert.equal(feeFor(10_000n, 150), 150n);
  assert.equal(feeFor(1n, 150), 1n);
  assert.equal(feeFor(333_333n, 150), 5_000n);
  assert.equal(feeFor(0n, 150), 0n);
  assert.equal(feeFor(300_000n, 0), 0n);
  assert.equal(totalWithFee(300_000n, 150), 304_500n);
});

test("the fee never falls below the minimum, so sub-cent services still earn Agon something", () => {
  assert.equal(feeFor(1_000n, 500, 10_000n), 10_000n, "5% of 0.001 is 0.00005, so the 0.01 minimum applies");
  assert.equal(feeFor(300_000n, 500, 10_000n), 15_000n, "5% of 0.30 is above the minimum");
  assert.equal(feeFor(200_000n, 500, 10_000n), 10_000n, "5% of 0.20 equals the minimum");
  assert.equal(totalWithFee(1_000n, 500, 10_000n), 11_000n);
  assert.equal(feeFor(1_000n, 0, 10_000n), 0n, "no fee rate means no fee at all");
  assert.equal(feeFor(0n, 500, 10_000n), 0n, "a free call carries no fee");
});
