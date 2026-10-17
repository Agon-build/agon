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
