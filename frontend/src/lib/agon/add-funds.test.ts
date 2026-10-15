import assert from "node:assert/strict";
import test from "node:test";

import { fundingPath, parseAmount } from "./add-funds.ts";

test("amounts are positive USDC with at most six decimals and a per-transfer ceiling", () => {
  assert.equal(parseAmount("1"), 1_000_000n);
  assert.equal(parseAmount("0.25"), 250_000n);
  assert.equal(parseAmount(" 2.5 "), 2_500_000n);
  assert.equal(parseAmount("0.000001"), 1n);
  assert.equal(parseAmount("1000"), 1_000_000_000n);
  assert.equal(parseAmount("0"), null);
  assert.equal(parseAmount("-1"), null);
  assert.equal(parseAmount("0.0000001"), null);
  assert.equal(parseAmount("1000.01"), null);
  assert.equal(parseAmount("abc"), null);
  assert.equal(parseAmount(""), null);
});

test("wallet users sign a transfer, Circle wallet users confirm one, others get the address", () => {
  assert.equal(fundingPath("wagmi", true), "wallet");
  assert.equal(fundingPath("circle", true), "circle");
  assert.equal(fundingPath(undefined, true), "address-only");
  assert.equal(fundingPath("wagmi", false), "address-only", "browser wallets are set up for Arc Testnet only");
  assert.equal(fundingPath("circle", false), "circle");
});
