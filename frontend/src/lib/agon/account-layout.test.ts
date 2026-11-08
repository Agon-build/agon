import assert from "node:assert/strict";
import test from "node:test";

import { hireAction, leftFraction, resultsLine, telegramLine } from "./account-layout.ts";

const settings = (email: boolean, telegram: boolean) => ({ email: { on: email, address: email ? "a…@x.com" : null }, telegram: { available: true, connected: telegram } });

test("the spend bar is what is left of today's limit", () => {
  assert.equal(leftFraction({ leftToday: "1.70", daily: "2.00" }), 0.85);
  assert.equal(leftFraction({ leftToday: "0", daily: "0" }), 0);
  assert.equal(leftFraction({ leftToday: "3", daily: "2" }), 1);
  assert.equal(leftFraction({ leftToday: "x", daily: "2" }), 0);
});

test("results go to the bell, plus email and Telegram when they are on", () => {
  assert.equal(resultsLine(settings(true, false)), "Bell and email");
  assert.equal(resultsLine(settings(true, true)), "Bell, email and Telegram");
  assert.equal(resultsLine(settings(false, false)), "Bell");
  assert.equal(resultsLine(settings(false, true)), "Bell and Telegram");
});

test("the line under it says what Telegram is doing", () => {
  assert.equal(telegramLine(settings(true, false)), "Telegram is not connected.");
  assert.equal(telegramLine(settings(true, true)), "Telegram is connected.");
  assert.equal(telegramLine({ email: { on: false, address: null }, telegram: { available: false, connected: false } }), "Telegram is not available right now.");
});

test("each hire row offers the next useful step", () => {
  assert.equal(hireAction("working"), "Watch");
  assert.equal(hireAction("paying"), "Watch");
  assert.equal(hireAction("delivered"), "Receipt");
  assert.equal(hireAction("refunded"), "Receipt");
  assert.equal(hireAction("failed"), "Receipt");
  assert.equal(hireAction("quoted"), "Retry");
});
