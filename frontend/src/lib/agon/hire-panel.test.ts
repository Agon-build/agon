import assert from "node:assert/strict";
import test from "node:test";

import { canAfford, shortWalletText, topUpAmount } from "./hire-panel.ts";

test("the top-up covers the shortfall, rounded up to whole USDC, at least 1", () => {
  assert.equal(topUpAmount("0.30", "0.00"), "1");
  assert.equal(topUpAmount("0.30", null), "1");
  assert.equal(topUpAmount("2.50", "0.20"), "3");
  assert.equal(topUpAmount("3.00", "1.00"), "2");
  assert.equal(topUpAmount("0.30", "5.00"), "1");
});

test("a wallet can afford a hire when its balance covers the price", () => {
  assert.equal(canAfford("0.30", "30.00"), true);
  assert.equal(canAfford("0.30", "0.30"), true);
  assert.equal(canAfford("0.30", "0.29"), false);
  assert.equal(canAfford("0.30", null), false);
  assert.equal(canAfford("bad", "1.00"), false);
});

test("the short-wallet line states balance and price, with no page directions", () => {
  const text = shortWalletText("0.00", "0.30");
  assert.equal(text, "Your agent wallet has 0.00 USDC. This hire costs 0.30 USDC.");
  assert.doesNotMatch(text, /below|above/i);
  assert.equal(shortWalletText(null, "0.30"), "Your agent wallet needs 0.30 USDC for this hire.");
});
