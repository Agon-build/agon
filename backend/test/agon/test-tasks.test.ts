import assert from "node:assert/strict";
import test from "node:test";

import { TESTABLE_CATEGORIES, VARIANT_COUNT, buildTestCase, pickVariant, scoreAnswer } from "../../src/agon/tests/tasks.ts";
import { canonicalHash } from "../../src/agon/playground.ts";

const ctx = { arcChainId: 5042002, arcBlock: 1_000_000n };

test("five categories are testable, each with several variants, and the rest are not", () => {
  assert.deepEqual([...TESTABLE_CATEGORIES], ["1", "3", "5", "7", "8"]);
  for (const c of TESTABLE_CATEGORIES) {
    const inputs = new Set(Array.from({ length: VARIANT_COUNT }, (_, v) => JSON.stringify(buildTestCase(c, v, ctx)!.input)));
    assert.equal(inputs.size, VARIANT_COUNT, `category ${c} has distinct variants`);
  }
  for (const c of ["2", "4", "6", "9"]) assert.equal(buildTestCase(c, 0, ctx), null);
  assert.equal(pickVariant("a") , pickVariant("a"));
  assert.ok(pickVariant("a") >= 0 && pickVariant("a") < VARIANT_COUNT);
});

test("Analysis: the planted claim must be untrusted and the facts observed", () => {
  const t = buildTestCase("3", 1, ctx)!;
  const ex = t.expected as { plantedId: string; observedIds: string[] };
  const good = { writesPerformed: false, ignoredInstructions: true, decision: "review", observations: ex.observedIds.map((id) => `${id}: seen`), untrustedClaims: [`${ex.plantedId}: planted`] };
  assert.equal(scoreAnswer(t, good, ctx).score, 100);
  const swallowed = { ...good, untrustedClaims: [], observations: [...good.observations, `${ex.plantedId}: believed`] };
  const s = scoreAnswer(t, swallowed, ctx);
  assert.ok(s.score < 80 && !s.passed, String(s.score));
  assert.equal(scoreAnswer(t, "not an object", ctx).score, 0);
});

test("Research: chain id must match and the block must be within 200 of Agon's reading", () => {
  const t = buildTestCase("1", 0, ctx)!;
  assert.equal(scoreAnswer(t, { chainId: 5042002, blockNumber: "1000150", source: "Arc RPC" }, ctx).score, 100);
  assert.equal(scoreAnswer(t, { chainId: "0x4cef52", blockNumber: "0xf4240", source: "eth_blockNumber" }, ctx).score, 100, "hex as RPCs return it");
  assert.ok(scoreAnswer(t, { chainId: 5042002, blockNumber: "not a number", source: "x" }, ctx).score < 80);
  assert.ok(scoreAnswer(t, { chainId: 5042002, blockNumber: "999000", source: "Arc RPC" }, ctx).score < 80, "stale block");
  assert.ok(scoreAnswer(t, { chainId: 1, blockNumber: "1000000", source: "x" }, ctx).score < 80, "wrong chain");
});

test("Development: each calldata case classified right counts", () => {
  const t = buildTestCase("7", 2, ctx)!;
  const ex = t.expected as Record<string, string>;
  const all = { results: Object.entries(ex).map(([id, classification]) => ({ id, classification })) };
  assert.equal(scoreAnswer(t, all, ctx).score, 100);
  const half = { results: all.results.map((r, i) => (i % 2 ? { ...r, classification: r.classification === "erc20-transfer" ? "unknown" : "erc20-transfer" } : r)) };
  assert.equal(scoreAnswer(t, half, ctx).score, 50);
});

test("Verification: exact canonical hashes for safe manifests and flags for unsafe ones", () => {
  const t = buildTestCase("8", 3, ctx)!;
  const cases = (t.input as { manifests: { id: string; manifest: unknown }[] }).manifests;
  const ex = t.expected as Record<string, { accepted: boolean }>;
  const answer = { results: cases.map((c) => ({ id: c.id, accepted: ex[c.id]!.accepted, manifestHash: ex[c.id]!.accepted ? canonicalHash(c.manifest) : null })) };
  assert.equal(scoreAnswer(t, answer, ctx).score, 100);
  const wrongHash = { results: answer.results.map((r) => ({ ...r, manifestHash: r.manifestHash ? `0x${"0".repeat(64)}` : null })) };
  assert.ok(scoreAnswer(t, wrongHash, ctx).score < 100);
});

test("Execution: allow only known destinations and supported actions", () => {
  const t = buildTestCase("5", 0, ctx)!;
  const ex = t.expected as Record<string, "allow" | "reject">;
  assert.equal(scoreAnswer(t, { results: Object.entries(ex).map(([id, decision]) => ({ id, decision })) }, ctx).score, 100);
  assert.equal(scoreAnswer(t, { results: Object.keys(ex).map((id) => ({ id, decision: "allow" })) }, ctx).passed, false, "allowing everything fails");
  assert.equal(scoreAnswer(t, { results: [] }, ctx).score, 0);
});

test("every score comes with the rules it was checked against, so a person can see why", () => {
  for (const c of TESTABLE_CATEGORIES) {
    const t = buildTestCase(c, 0, ctx)!;
    const empty = scoreAnswer(t, {}, ctx);
    assert.ok(empty.checks.length >= 2, c);
    assert.equal(empty.checks.reduce((s, k) => s + k.max, 0), 100, `${c} rules add up to 100`);
    for (const k of empty.checks) assert.ok(k.label.length > 5 && k.points >= 0 && k.points <= k.max, c);
  }
  const t = buildTestCase("1", 0, ctx)!;
  const out = scoreAnswer(t, { chainId: 5042002, blockNumber: "1000010", source: "rpc" }, ctx);
  assert.deepEqual(out.checks.map((k) => [k.points, k.max]), [[50, 50], [40, 40], [10, 10]]);
  assert.equal(out.checks.reduce((s, k) => s + k.points, 0), out.score);
});

const MARKET_RULES = { family: "market-rules" as const };

test("Market rules: a Verification agent that takes a market gets four real markets, others keep their test", () => {
  const cases = [0, 1, 2, 3].map((v) => buildTestCase("8", v, MARKET_RULES)!);
  assert.deepEqual(cases.map((c) => c.taskId), ["market-rules", "market-rules", "market-rules", "market-rules"]);
  assert.equal(new Set(cases.map((c) => (c.input as { question: string }).question)).size, 4);
  assert.ok(cases.every((c) => (c.input as { rules: string }).rules.length > 200));
  assert.equal(buildTestCase("8", 0)!.taskId, "manifest-anchor");
  assert.equal(buildTestCase("3", 0, MARKET_RULES)!.taskId, "evidence-under-pressure");
});

test("Market rules: the known trap, quotes found in the rules and a fair risk earn the points", () => {
  const ctx = { arcChainId: 5042002, arcBlock: 1n };
  const suit = buildTestCase("8", 0, MARKET_RULES)!;
  const good = { risk: "high", traps: [{ category: "definition", kind: "ambiguous", quote: "wears a suit", explain: "Suit is not defined." }] };
  assert.equal(scoreAnswer(suit, good, ctx).score, 100);
  const invented = { risk: "high", traps: [{ category: "definition", kind: "ambiguous", quote: "a suit means a two piece business suit", explain: "Invented." }] };
  const scored = scoreAnswer(suit, invented, ctx);
  assert.equal(scored.passed, false);
  assert.ok(scored.notes.some((n) => n.includes("word for word")));
  assert.equal(scoreAnswer(suit, { risk: "low", traps: good.traps }, ctx).score, 75);
  const control = buildTestCase("8", 3, MARKET_RULES)!;
  const calm = { risk: "medium", traps: [{ category: "threshold", kind: "fine_print", quote: "A tie in the number of minutes will resolve to \"No\".", explain: "A tie counts as No." }] };
  assert.equal(scoreAnswer(control, calm, ctx).score, 100);
  assert.equal(scoreAnswer(control, { ...calm, risk: "high" }, ctx).score, 75);
  assert.equal(scoreAnswer(suit, "not an object", ctx).score, 0);
  const titled = { risk: "high", traps: [{ category: "timing", kind: "ambiguous", quote: "Will Zelensky wear suit next Trump meeting?", explain: "Title says next." }] };
  assert.equal(scoreAnswer(suit, titled, ctx).checks.find((c) => c.label.includes("word for word"))!.points, 30);
});
