import assert from "node:assert/strict";
import test from "node:test";

import { categoryTileLine, feeLine, HIRE_EXAMPLES, HIRE_STEPS_RAIL, moneyLine, shortfall } from "./hire-layout.ts";
import type { HireCategory } from "./stage-types.ts";

test("money is named from the record's own network", () => {
  assert.equal(moneyLine("Arc Testnet"), "Test USDC on Arc Testnet");
  assert.equal(moneyLine("Arc mainnet"), "Real USDC on Arc mainnet");
  assert.equal(moneyLine("arc-testnet"), "Test USDC on Arc Testnet");
  assert.equal(moneyLine("arc"), "Real USDC on Arc mainnet");
  assert.equal(moneyLine("Arc"), "Real USDC on Arc mainnet");
});

test("an unknown network is never guessed as test money", () => {
  assert.equal(moneyLine("Base"), null);
  assert.equal(moneyLine(""), null);
});

test("a direct hire shows no routing fee", () => {
  assert.equal(feeLine(true, "0.015"), "None, you picked it");
  assert.equal(feeLine(false, "0.015"), "0.015 USDC (5%)");
  assert.equal(feeLine(false, "0"), "None");
});

test("the rail has four steps", () => assert.deepEqual([...HIRE_STEPS_RAIL], ["Ask", "Choose", "Pay", "Answer"]));

test("category tiles count Agon and outside services from live data", () => {
  const c = (agon: number | null, outside: number | null) => ({ id: "prediction", label: "Prediction markets", agon, outside }) as HireCategory;
  assert.equal(categoryTileLine(c(3, 10)), "3 on Agon · 10 outside");
  assert.equal(categoryTileLine(c(0, 114)), "114 outside");
  assert.equal(categoryTileLine(c(2, 0)), "2 on Agon");
  assert.equal(categoryTileLine(c(0, 0)), "No services yet");
  assert.equal(categoryTileLine(c(null, null)), "");
});

test("examples cover more than prediction markets and never name Polymarket", () => {
  assert.ok(HIRE_EXAMPLES.length >= 3);
  assert.ok(HIRE_EXAMPLES.every((e) => !/polymarket/i.test(e)));
});

test("the top-up names the exact shortfall, or nothing when it cannot be read", () => {
  assert.equal(shortfall("0.62", "0.42"), "0.20");
  assert.equal(shortfall("0.105", "0"), "0.105");
  assert.equal(shortfall("0.10", "0.50"), null, "a covered price has no shortfall");
  assert.equal(shortfall("0.10", null), null);
});
