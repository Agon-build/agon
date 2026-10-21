import assert from "node:assert/strict";
import test from "node:test";

import {
  beatsMarketText, compareProbability, explorerBase, flattenPayments, formatCountdown, ratingForAgent, formatUsdcAtomic, haggleRows, haggleSummary, isTerminal, ledgerRows,
  moneyFlow, moneySegments, parseUsdcText, phaseStep, shortHash, timeAgo, workingNotice,
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

test("the money flow names where the hired service comes from", () => {
  assert.equal(moneyFlow(receipt).lead!.sublabel, "Built by Agon", "no source means an older API: the Lead");
  assert.equal(moneyFlow({ ...receipt, source: "lead" }).lead!.sublabel, "Built by Agon");
  assert.equal(moneyFlow({ ...receipt, label: "LoneStarOracle", source: "circle", children: [] }).lead!.sublabel, "Circle Agent Marketplace");
  assert.equal(moneyFlow({ ...receipt, label: "Scout", source: "agon", children: [] }).lead!.sublabel, "Listed on Agon");
});

test("the working notice names the hired service on a routed job and the lead agent on a Lead job", () => {
  assert.deepEqual(workingNotice("paying", receipt), { title: "Paying the lead agent", body: "Your payment is settling on Arc. The lead agent starts the moment it lands." });
  assert.deepEqual(workingNotice("working", { ...receipt, source: "lead" }), { title: "Agents at work", body: "The lead agent is buying data and choosing a forecaster. Every payment appears on the right as it lands." });
  const circle: ReceiptNode = { ...receipt, label: "LoneStarOracle", source: "circle", children: [] };
  assert.deepEqual(workingNotice("paying", circle), { title: "Paying LoneStarOracle", body: "Your payment is settling on Arc. LoneStarOracle starts the moment it lands." });
  assert.deepEqual(workingNotice("working", circle), { title: "LoneStarOracle is working", body: "Your request is with LoneStarOracle. The answer appears here when it arrives, and the payment is on the right." });
  assert.equal(workingNotice("working", null).title, "Agents at work");
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
  // One row per move, each naming who made it, so the table reads top to bottom.
  assert.deepEqual(haggleRows(steps, "Atlas (house)").map((r) => [r.side, r.label, r.amount]), [
    ["seller", "Atlas (house) asked", "0.22"], ["agon", "Agon offered", "0.132"], ["seller", "Atlas (house) came down to", "0.1848"], ["deal", "Agreed price", "0.17424"],
  ]);
  assert.deepEqual(haggleSummary(steps), { asked: "0.22", agreed: "0.17424", percentOff: 21 });
  assert.equal(haggleSummary([{ step: "walk", detail: "walked away" }]), null);
});

test("the forecast is compared with the market in whole points", () => {
  const answer: StageAnswer = { probabilityBps: 3400, marketPriceBps: 4100, reasons: [], marketQuestion: "q", marketEndsAt: null, marketSlug: null, forecaster: { name: "A", reason: "r", asked: "0.22", agreed: "0.17" } };
  assert.deepEqual(compareProbability(answer), {
    agonPct: 34, marketPct: 41, deltaPts: -7, verdict: "Less likely than the market says",
    sentence: "The forecast gives Yes 34%, 7 points below the 41% traders pay for Yes on Polymarket. The forecaster thinks Yes is less likely than the market does.",
  });
  // Within 2 points the two agree: no edge is claimed.
  const level = compareProbability({ ...answer, probabilityBps: 6000, marketPriceBps: 6050 });
  assert.equal(level.verdict, "Agrees with the market");
  assert.equal(level.sentence, "The forecast gives Yes 60% and traders pay 61% for Yes on Polymarket. They agree, so there is no clear edge either way.");
  assert.equal(compareProbability({ ...answer, probabilityBps: 4300 }).verdict, "Agrees with the market");
  const above = compareProbability({ ...answer, probabilityBps: 5000 });
  assert.equal(above.verdict, "More likely than the market says");
  assert.equal(above.sentence, "The forecast gives Yes 50%, 9 points above the 41% traders pay for Yes on Polymarket. The forecaster thinks Yes is more likely than the market does.");
  const none = compareProbability({ ...answer, marketPriceBps: null });
  assert.equal(none.verdict, "No market price to compare");
  assert.equal(none.sentence, "The forecast gives Yes 34%. Polymarket had no price to compare it with.");
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

import { SEASON_CATEGORY_TABS, type RatingsResponse } from "./stage-types.ts";
import { categoryCells } from "./stage-view.ts";

const cell = (n: number, ranked: boolean, rank: number | null, rating = 0.02) => ({ rating, meanSkill: rating, forecastsResolved: n, ranked, rank });
const ratings: RatingsResponse = {
  seasonId: "9001", updatedAt: new Date().toISOString(), categories: ["sports", "crypto", "economics", "politics", "world", "culture"],
  minRanked: { overall: 20, category: 10 },
  agents: [{ agentAddress: "0xabc", displayName: "Atlas (house)", house: true, overall: cell(24, true, 1),
    categories: { sports: cell(12, true, 2), crypto: cell(4, false, null), economics: cell(0, false, null), politics: cell(10, true, 1), world: cell(0, false, null), culture: cell(3, false, null) } }],
};

test("category cells say rank, provisional count or no forecasts yet, in tab order", () => {
  assert.deepEqual(SEASON_CATEGORY_TABS.map((t) => t.key), ["overall", "crypto", "politics", "sports", "economics", "world", "culture"]);
  const cells = categoryCells(ratings, "0xABC");
  assert.deepEqual(cells.map((c) => [c.key, c.text]), [
    ["overall", "#1 of ranked · 24 scored"],
    ["crypto", "Provisional · 4 of 10"],
    ["politics", "#1 · 10 scored"],
    ["sports", "#2 · 12 scored"],
    ["economics", "No forecasts yet"],
    ["world", "No forecasts yet"],
    ["culture", "Provisional · 3 of 10"],
  ]);
  assert.deepEqual(categoryCells(ratings, "0xnot-there"), []);
});

import { boardNotice } from "./stage-view.ts";

test("a category board with nothing scored yet says so instead of showing an empty table", () => {
  const base = { seasonId: "9001", network: "Arc Testnet", commitsAddress: "0x1", updatedAt: "", lastCommitAt: null };
  assert.equal(boardNotice({ ...base, category: "world", minRanked: 10, rows: [] }), "No World forecasts have been scored yet. Rankings appear after 10 scored forecasts.");
  const row = { agentAddress: "0xa", displayName: "Atlas (house)", house: true, slateResolved: 3, forecastsResolved: 0, meanSkill: 0, meanBrier: null, rating: 0, ranked: false, rank: null };
  assert.equal(boardNotice({ ...base, category: "world", minRanked: 10, rows: [row] }), "No World forecasts have been scored yet. Rankings appear after 10 scored forecasts.");
  assert.equal(boardNotice({ ...base, category: "overall", minRanked: 20, rows: [{ ...row, forecastsResolved: 4 }] }), "Rankings appear after 20 scored forecasts. Agents below that are shown as provisional.");
  assert.equal(boardNotice({ ...base, category: "crypto", minRanked: 10, rows: [{ ...row, forecastsResolved: 12, ranked: true, rank: 1 }] }), null);
});

import { historyRows } from "./stage-view.ts";

test("hires list newest first with a receipt link each", () => {
  const rows = historyRows([
    { jobId: "0b9e0b4c-3c2f-4b0e-9d1a-2f5a6b7c8d9e", question: "Will BTC close above 120k?", price: "0.30", state: "delivered", createdAt: "2026-10-12T10:00:00Z", receiptUrl: "https://agon.surf/r/0b9e0b4c-3c2f-4b0e-9d1a-2f5a6b7c8d9e" },
    { jobId: "1b9e0b4c-3c2f-4b0e-9d1a-2f5a6b7c8d9e", question: null, price: "0.30", state: "refunded", createdAt: "2026-10-12T12:00:00Z", receiptUrl: "https://agon.surf/r/1b9e0b4c-3c2f-4b0e-9d1a-2f5a6b7c8d9e" },
  ], Date.parse("2026-10-12T13:00:00Z"));
  assert.deepEqual(rows.map((r) => [r.label, r.state, r.amount, r.href]), [
    ["Agent job", "Refunded", "0.30", "/r/1b9e0b4c-3c2f-4b0e-9d1a-2f5a6b7c8d9e"],
    ["Will BTC close above 120k?", "Delivered", "0.30", "/r/0b9e0b4c-3c2f-4b0e-9d1a-2f5a6b7c8d9e"],
  ]);
});

import { seasonFromQuery, seasonStatus } from "./stage-view.ts";

const SEASON = { seasonId: "9002", network: "Arc Testnet", commitsAddress: "0x", commitsUrl: "https://explorer.testnet.arc.io/address/0x", startsAt: "2026-10-21T12:00:00.000Z", endsAt: "2026-11-18T12:00:00.000Z", roundHours: 6, currentRound: null };

test("a season reads as starting, running with its round, or ended, from its own dates", () => {
  const before = seasonStatus(SEASON, Date.parse("2026-10-21T08:00:00Z"));
  assert.deepEqual([before.state, before.label], ["upcoming", "Starts 21 October, 12:00 UTC"]);
  assert.match(before.sentence, /Dry run 2 on Arc Testnet starts 21 October and runs to 18 November\./);
  const during = seasonStatus({ ...SEASON, currentRound: "3" }, Date.parse("2026-10-22T07:00:00Z"));
  assert.deepEqual([during.state, during.label], ["running", "Running · Round 4"]);
  assert.match(during.sentence, /runs from 21 October to 18 November/);
  const after = seasonStatus({ ...SEASON, seasonId: "9001", startsAt: "2026-10-12T00:00:45.000Z", endsAt: "2026-10-15T00:00:45.000Z" }, Date.parse("2026-10-20T00:00:00Z"));
  assert.deepEqual([after.state, after.label, after.name], ["ended", "Ended", "Dry run 1"]);
  assert.match(after.sentence, /ran from 12 October to 15 October, and its forecasts are scored as the markets resolve\./);
});

test("the season page takes a season from the link only when it is a plain number", () => {
  assert.equal(seasonFromQuery("9001", "9002"), "9001");
  assert.equal(seasonFromQuery(null, "9002"), "9002");
  assert.equal(seasonFromQuery("../admin", "9002"), "9002");
  assert.equal(seasonFromQuery("12345678901", "9002"), "9002");
});
