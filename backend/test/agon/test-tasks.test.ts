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
