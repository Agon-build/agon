import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { EMPTY_FORM, FEE_ATOMIC, draftFromForm, formFromDraft, missingFee, stepFor, timeline, validateForm } from "./listing-flow.ts";

const good = { ...EMPTY_FORM, name: "Atlas", logoUrl: "https://agon.surf/agents/atlas.svg", outcome: "Forecasts one market.", category: "3", priceUSDC: "0.22", endpoint: "https://api.agon.surf/agon/agents/house/atlas/forecast", inputs: "marketId: the market condition id\n\nquestion ", outputs: "probability", privacy: "Used only for this forecast.", failurePolicy: "No forecast, no charge.", expectedLatencySeconds: "60" };

test("a complete form becomes the draft the server expects, with the numeric category", () => {
  assert.deepEqual(validateForm(good), {});
  assert.deepEqual(draftFromForm(good), {
    name: "Atlas", logoUrl: "https://agon.surf/agents/atlas.svg", outcome: "Forecasts one market.", category: "3", inputs: ["marketId: the market condition id", "question"], outputs: ["probability"],
    priceUSDC: "0.22", expectedLatencyMs: 60000, privacy: "Used only for this forecast.", failurePolicy: "No forecast, no charge.", endpoint: "https://api.agon.surf/agon/agents/house/atlas/forecast",
  });
  assert.deepEqual(formFromDraft(draftFromForm(good)), { ...good, inputs: "marketId: the market condition id\nquestion" }, "a saved draft fills the form back");
});

test("each input needs a field name, written as name: what it is", () => {
  assert.match(validateForm({ ...good, inputs: "a polymarket market or question" }).inputs!, /name: what it is/);
  assert.match(validateForm({ ...good, inputs: "market: a link\nmarket: again" }).inputs!, /twice/);
  assert.equal(validateForm({ ...good, inputs: "market: a link\nnotes: short notes (optional)" }).inputs, undefined);
  const src = readFileSync(new URL("../../components/agon/list/ListFlow.tsx", import.meta.url), "utf8");
  assert.match(src, /error=\{touched \? errors\.inputs : undefined\}/);
  assert.match(src, /name: what it is/);
});

test("each field says what is wrong in plain words", () => {
  const e = validateForm({ ...good, name: "", logoUrl: "http://x.com/l.png", endpoint: "ftp://x", priceUSDC: "0.1234567", category: "", outputs: "", expectedLatencySeconds: "999" });
  assert.deepEqual(Object.keys(e).sort(), ["category", "endpoint", "expectedLatencySeconds", "logoUrl", "name", "outputs", "priceUSDC"]);
  assert.match(e.endpoint!, /https/i);
  assert.match(e.priceUSDC!, /six decimals/i);
  assert.match(validateForm({ ...good, priceUSDC: "0" }).priceUSDC!, /above 0/);
  assert.equal(validateForm({ ...good, category: "42" }).category !== undefined, true);
});

test("the step follows the server's publishing status, so a reload resumes in the right place", () => {
  assert.equal(stepFor(null, false), "check");
  assert.equal(stepFor(null, true), "approve");
  assert.equal(stepFor({ status: "review_terms", reference: null }, false), "check");
  assert.equal(stepFor({ status: "review_terms", reference: null }, true), "approve");
  assert.equal(stepFor({ status: "fund_wallet", reference: null }, true), "approve");
  assert.equal(stepFor({ status: "pending", reference: null }, false), "live");
  assert.equal(stepFor({ status: "ready", reference: null }, false), "live");
  assert.equal(stepFor({ status: "published", reference: "5042002:0xf017:9" }, false), "live");
});

test("the live timeline fills from what the publisher reports", () => {
  assert.deepEqual(timeline({ status: "pending", agentId: null, reference: null }, null).map((s) => s.label), ["Identity registered", "Listed", "Checking", "Verified"]);
  assert.deepEqual(timeline({ status: "pending", agentId: null, reference: null }, null).map((s) => s.done), [false, false, false, false]);
  assert.deepEqual(timeline({ status: "pending", agentId: "41", reference: null }, null).map((s) => s.done), [true, false, false, false]);
  assert.deepEqual(timeline({ status: "published", agentId: "41", reference: "r" }, null).map((s) => s.done), [true, true, true, false]);
  assert.deepEqual(timeline({ status: "published", agentId: "41", reference: "r" }, "Verified").map((s) => s.done), [true, true, true, true]);
});

test("the fee is 0.50 USDC, and a short wallet asks for exactly what is missing", () => {
  assert.equal(FEE_ATOMIC, 500_000n);
  assert.equal(missingFee("Fund 0.0123 more Arc Testnet native USDC for the next contract action."), 12_300n);
  assert.equal(missingFee("Fund the publisher address with Arc Testnet native USDC."), 100_000n, "no amount given: send 0.10");
});

test("after paying, Live waits for the fee to land before advancing, and never asks again while it lands", async () => {
  const { feeLanding } = await import("./listing-flow.ts");
  const paidAt = Date.parse("2026-10-16T12:00:00Z");
  assert.equal(feeLanding({ balanceUSDC: "0", paidAt, now: paidAt + 10_000 }), "wait");
  assert.equal(feeLanding({ balanceUSDC: null, paidAt, now: paidAt + 10_000 }), "wait");
  assert.equal(feeLanding({ balanceUSDC: "0.5", paidAt, now: paidAt + 10_000 }), "advance");
  assert.equal(feeLanding({ balanceUSDC: "0", paidAt, now: paidAt + 4 * 60_000 }), "ask_again", "only after minutes without the fee arriving");
  assert.equal(feeLanding({ balanceUSDC: "0", paidAt: null, now: paidAt }), "ask_again");
});

test("a failed publish stops Live and shows why; a stale check sends the builder back to Check", async () => {
  const { liveOutcome, stepAfterError } = await import("./listing-flow.ts");
  assert.deepEqual(liveOutcome({ status: "needs_attention", reference: null, nextAction: "Stop and review the receipt." }), { stop: true, message: "Stop and review the receipt." });
  assert.deepEqual(liveOutcome({ status: "published", reference: "r", nextAction: "x" }), { stop: false, message: null });
  assert.deepEqual(liveOutcome({ status: "pending", reference: null, nextAction: "x" }), { stop: false, message: null });
  assert.equal(stepAfterError("Run the listing checks first: publishing needs a passing check."), "check");
  assert.equal(stepAfterError("Publishing could not continue."), null);
});

test("publishing stops after 3 failures in a row and asks the builder to try again; a success resets the count", async () => {
  const { afterLiveAttempt, LIVE_MAX_FAILURES } = await import("./listing-flow.ts");
  assert.equal(LIVE_MAX_FAILURES, 3);
  let state = { failures: 0, stalled: false };
  state = afterLiveAttempt(state, false);
  state = afterLiveAttempt(state, false);
  assert.deepEqual(state, { failures: 2, stalled: false });
  assert.deepEqual(afterLiveAttempt(state, true), { failures: 0, stalled: false }, "a success resets");
  assert.deepEqual(afterLiveAttempt(state, false), { failures: 3, stalled: true });
});

test("an update starts from the published details, publishes the next version from the same wallet and pays only for missing gas", () => {
  const src = readFileSync(new URL("../../components/agon/list/ListFlow.tsx", import.meta.url), "utf8");
  assert.match(src, /params\.get\("update"\)/);
  assert.match(src, /getListingDraft\(updates\)/);
  assert.match(src, /setupPublishing\(draftId!, updates \?\? undefined\)/);
  assert.match(src, /updates && p\.status !== "fund_wallet"/, "an update sends no fee unless the wallet is short");
  assert.match(src, /keeps its agent ID, tests and scores/);
  const api = readFileSync(new URL("./builder-api.ts", import.meta.url), "utf8");
  assert.match(api, /\/listings\/\$\{encodeURIComponent\(reference\)\}\/draft/);
  assert.match(api, /updates \? \{ updates \} : \{\}/);
  const detail = readFileSync(new URL("../../app/agents/[id]/page.tsx", import.meta.url), "utf8");
  assert.match(detail, /\/list\?update=\$\{encodeURIComponent\(listing\.id\)\}/);
});

test("while stalled the page shows the reason and Try again, never the under-a-minute line", () => {
  const src = readFileSync(new URL("../../components/agon/list/ListFlow.tsx", import.meta.url), "utf8");
  assert.match(src, /afterLiveAttempt/);
  assert.match(src, /stalled \?/);
  assert.match(src, /Try again/);
  assert.match(src, /!error && !stalled/);
});
