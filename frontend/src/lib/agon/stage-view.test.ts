import assert from "node:assert/strict";
import test from "node:test";

import {
  beatsMarketText, compareProbability, explorerBase, flattenPayments, formatCountdown, ratingForAgent, formatUsdcAtomic, haggleRows, haggleSummary, isTerminal, ledgerRows,
  moneyFlow, moneySegments, parseUsdcText, phaseStep, shortHash, timeAgo,
} from "./stage-view.ts";
import type { ReceiptNode, StageAnswer } from "./stage-types.ts";

const TX = (n: string) => `https://explorer.arc.io/tx/0x${n.repeat(64)}`;
const receipt: ReceiptNode = {
  jobId: "root", label: "Agon Lead Agent", buyer: "you", state: "delivered", price: "0.30", network: "Arc",
  payments: [
    { kind: "hire", amount: "0.30", payer: "0xuser", payee: "0xlead", status: "settled", txUrl: TX("1"), detail: "Agon Lead Agent" },
    { kind: "data", amount: "0.0085", payer: "0xlead", payee: "0xblockrun", status: "settled", txUrl: TX("2"), detail: "market search from BlockRun" },
    { kind: "data", amount: "0.002", payer: "0xlead", payee: "0xblockrun", status: "pending", txUrl: null, detail: "Bitcoin price from BlockRun" },
  ],
  children: [{
    jobId: "child", label: "Atlas (house)", buyer: "agent:lead", state: "delivered", price: "0.17424", network: "Arc",
    payments: [{ kind: "hire", amount: "0.17424", payer: "0xlead", payee: "0xatlas", status: "settled", txUrl: TX("3"), detail: "Atlas (house)" }], children: [],
  }],
};

test("USDC text parses and formats in base units without floating point", () => {
  assert.equal(parseUsdcText("0.0085"), 8_500n);
  assert.equal(parseUsdcText("0.30"), 300_000n);
  assert.equal(parseUsdcText("1"), 1_000_000n);
  assert.equal(parseUsdcText("x"), null);
  assert.equal(formatUsdcAtomic(185_240n), "0.18524");
  assert.equal(formatUsdcAtomic(300_000n), "0.30");
});

test("the money flow follows the receipt: you pay the lead, the lead pays sellers", () => {
  const flow = moneyFlow(receipt);
  assert.deepEqual([flow.lead!.label, flow.lead!.amount, flow.lead!.status], ["Agon Lead Agent", "0.30", "settled"]);
  assert.deepEqual(flow.sellers.map((s) => [s.role, s.label, s.sublabel, s.amount, s.status]), [
    ["data", "BlockRun", "Market search", "0.0085", "settled"],
    ["data", "BlockRun", "Bitcoin price", "0.002", "pending"],
    ["forecaster", "Atlas (house)", "Forecaster", "0.17424", "settled"],
  ]);
  assert.equal(flow.agentSpend, "0.18274", "only settled payments count");
  assert.equal(flow.refund, null);
  assert.equal(moneyFlow(null).lead, null);
});

test("a refund shows as its own node", () => {
  const flow = moneyFlow({ ...receipt, payments: [...receipt.payments, { kind: "refund", amount: "0.30", payer: "0xlead", payee: "0xuser", status: "settled", txUrl: TX("4"), detail: "no matching market" }] });
  assert.deepEqual([flow.refund!.amount, flow.refund!.sublabel, flow.refund!.txUrl], ["0.30", "no matching market", TX("4")]);
});

test("ledger rows carry the time since start and the kind", () => {
  const rows = ledgerRows([
    { at: "2026-11-03T12:00:01.200Z", text: "Reading the question", kind: "note" },
    { at: "2026-11-03T12:00:03.700Z", text: "Bought market search from BlockRun: 0.0085 USDC", kind: "data" },
  ], "2026-11-03T12:00:00.000Z");
  assert.deepEqual(rows.map((r) => [r.offset, r.kind]), [["+1.2s", "note"], ["+3.7s", "data"]]);
  assert.equal(ledgerRows([{ at: "bad", text: "x", kind: "note" }], null)[0]!.offset, "");
});

test("money inside a line is marked so it can be set in mono", () => {
  assert.deepEqual(moneySegments("Hired Atlas: 0.17424 USDC (asked 0.22, agreed 0.17424)"), [
    { text: "Hired Atlas: ", money: false }, { text: "0.17424 USDC", money: true }, { text: " (asked 0.22, agreed 0.17424)", money: false },
  ]);
});

test("haggle steps become sides with amounts and a summary", () => {
  const steps = [
    { step: "request" as const, detail: "asked Atlas (house) for a price; listed at 0.22 USDC" },
    { step: "offer" as const, detail: "offered 0.132 USDC" },
    { step: "counter" as const, detail: "Atlas (house) countered at 0.1848 USDC" },
    { step: "accept" as const, detail: "agreed 0.17424 USDC (asked 0.22)" },
  ];
  assert.deepEqual(haggleRows(steps).map((r) => [r.side, r.label, r.amount]), [
    ["seller", "Listed at", "0.22"], ["agon", "Offered", "0.132"], ["seller", "Countered", "0.1848"], ["deal", "Agreed", "0.17424"],
  ]);
  assert.deepEqual(haggleSummary(steps), { asked: "0.22", agreed: "0.17424", percentOff: 21 });
  assert.equal(haggleSummary([{ step: "walk", detail: "walked away" }]), null);
});

test("the forecast is compared with the market in whole points", () => {
  const answer: StageAnswer = { probabilityBps: 3400, marketPriceBps: 4100, reasons: [], marketQuestion: "q", marketEndsAt: null, marketSlug: null, forecaster: { name: "A", reason: "r", asked: "0.22", agreed: "0.17" } };
  assert.deepEqual(compareProbability(answer), { agonPct: 34, marketPct: 41, deltaPts: -7, sentence: "7 points below the market" });
  assert.equal(compareProbability({ ...answer, probabilityBps: 4120 }).sentence, "Level with the market");
  assert.equal(compareProbability({ ...answer, probabilityBps: 5000 }).sentence, "9 points above the market");
  assert.equal(compareProbability({ ...answer, probabilityBps: 4200 }).sentence, "1 point above the market");
  assert.equal(compareProbability({ ...answer, marketPriceBps: null }).sentence, "No market price to compare");
});

test("phases map to the four visible steps and only final phases stop polling", () => {
  assert.deepEqual(["idle", "quote", "quoted", "paying", "working", "answered", "refunded", "failed"].map((p) => phaseStep(p as never)), [0, 1, 1, 2, 2, 3, 3, 3]);
  assert.deepEqual(["paying", "working", "quoted", "answered", "refunded", "failed"].map((p) => isTerminal(p as never)), [false, false, true, true, true, true]);
});

test("small formatters", () => {
  assert.equal(formatCountdown("2026-11-03T12:05:00Z", Date.parse("2026-11-03T12:00:28Z")), "4:32");
  assert.equal(formatCountdown("2026-11-03T12:00:00Z", Date.parse("2026-11-03T12:01:00Z")), "0:00");
  assert.equal(shortHash(`0x${"8f2a".repeat(16)}`), "0x8f2a…8f2a");
  assert.equal(explorerBase("https://explorer.arc.io/address/0x123"), "https://explorer.arc.io");
  assert.equal(timeAgo("2026-11-03T11:58:00Z", Date.parse("2026-11-03T12:00:00Z")), "2 min ago");
  assert.equal(timeAgo("2026-11-03T09:00:00Z", Date.parse("2026-11-03T12:00:00Z")), "3 h ago");
  assert.equal(timeAgo("2026-11-03T11:59:50Z", Date.parse("2026-11-03T12:00:00Z")), "just now");
  const row = { agentAddress: "0x1", displayName: "Atlas (house)", house: true, slateResolved: 214, forecastsResolved: 214, meanSkill: 0.0312, meanBrier: 0.18, rating: 0.0285, ranked: true, rank: 1 };
  assert.equal(beatsMarketText(row), "Beat the market by 0.031 over 214 forecasts");
  assert.equal(beatsMarketText({ ...row, meanSkill: -0.012 }), "Behind the market by 0.012 over 214 forecasts");
  assert.equal(beatsMarketText({ ...row, ranked: false, forecastsResolved: 7 }), "7 scored forecasts so far; ranking starts at 20");
});

test("the payments table lists every payment with who paid whom", () => {
  const rows = flattenPayments(receipt);
  assert.deepEqual(rows.map((r) => [r.what, r.from, r.to, r.amount, r.status]), [
    ["Hire", "You", "Agon Lead Agent", "0.30", "settled"],
    ["Market search", "Agon Lead Agent", "BlockRun", "0.0085", "settled"],
    ["Bitcoin price", "Agon Lead Agent", "BlockRun", "0.002", "pending"],
    ["Forecast", "Agon Lead Agent", "Atlas (house)", "0.17424", "settled"],
  ]);
  assert.deepEqual(flattenPayments(null), []);
});

test("an agent page finds its Season 1 row through its ERC-8004 id", () => {
  const rows = [{ agentAddress: "0xabc", displayName: "Northwind", house: false, slateResolved: 30, forecastsResolved: 30, meanSkill: 0.02, meanBrier: 0.19, rating: 0.012, ranked: true, rank: 2 }];
  const entries = [{ agentAddress: "0xABC", erc8004AgentId: "42", displayName: "Northwind", house: false, forecastEndpoint: null, enteredRound: "3" }];
  assert.equal(ratingForAgent("42", entries, rows)!.rank, 2);
  assert.equal(ratingForAgent("7", entries, rows), null);
});
