import assert from "node:assert/strict";
import test from "node:test";

import { readFileSync } from "node:fs";

import { hireAction, leftFraction, outsideWalletCopy, resultsLine, telegramLine } from "./account-layout.ts";

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

// 2026-11-10: outside services are paid in real USDC from a second wallet on Arc mainnet, and
// the only place to fund it was the Hire page, after choosing one. Account now shows it too.
test("Account names the mainnet wallet that pays outside services, with what it holds", () => {
  assert.deepEqual(outsideWalletCopy({ balance: "0.10" }), {
    title: "Add funds for outside services",
    line: "Outside services are paid in real USDC on Arc mainnet, from a wallet of its own. It holds 0.10 USDC.",
  });
  assert.equal(outsideWalletCopy({ balance: null }).line, "Outside services are paid in real USDC on Arc mainnet, from a wallet of its own. Its balance could not be read.");
  assert.equal(outsideWalletCopy(null).line, "Outside services are paid in real USDC on Arc mainnet, from a wallet of its own. It is created the first time you choose one on Hire.");
});

test("the Account wallet tab loads the mainnet wallet and offers to fund it", () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
  assert.match(read("../../app/account/AccountClient.tsx"), /getWallet\("arc"\)/);
  const tab = read("../../components/stage/AccountWallet.tsx");
  assert.match(tab, /outsideWalletCopy\(mainnet\)/);
  assert.match(tab, /<AddFunds wallet=\{mainnet\}/);
});
