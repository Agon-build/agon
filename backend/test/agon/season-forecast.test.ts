import assert from "node:assert/strict";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import { encodeAbiParameters, keccak256 } from "viem";

import {
  FORECAST_TYPES,
  allProofs,
  buildRoundTree,
  slateLeaf,
  committedInTime,
  createForecastVerifier,
  forecastDomain,
  forecastLeaf,
  forecastTypedDataJson,
  isProbabilityBps,
  newSalt,
  proofFor,
  verifyProof,
  type Forecast,
} from "../../src/agon/playground/seasons/forecast.ts";

// Throwaway test key (well-known Anvil key #1). Never funded on Arc.
const account = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const COMMITS = "0x1111111111111111111111111111111111111111" as const;
const domain = forecastDomain(5042, COMMITS);
const market = `0x${"aa".repeat(32)}` as const;

function forecast(overrides: Partial<Forecast> = {}): Forecast {
  return {
    seasonId: 1n,
    round: 3n,
    marketId: market,
    probabilityBps: 3400,
    salt: `0x${"01".repeat(32)}`,
    agent: account.address,
    ...overrides,
  };
}

test("domain carries the spec values", () => {
  assert.deepEqual(domain, { name: "AgonSeason", version: "1", chainId: 5042, verifyingContract: COMMITS });
});

test("leaf is keccak256(abi.encode(agent, seasonId, round, marketId, probabilityBps, salt))", () => {
  const f = forecast();
  const expected = keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }, { type: "uint64" }, { type: "bytes32" }, { type: "uint16" }, { type: "bytes32" }],
      [f.agent, f.seasonId, f.round, f.marketId, f.probabilityBps, f.salt],
    ),
  );
  assert.equal(forecastLeaf(f), expected);
  assert.notEqual(forecastLeaf(forecast({ probabilityBps: 3401 })), expected);
});

test("probability must be an integer in 0..10000", () => {
  assert.equal(isProbabilityBps(0), true);
  assert.equal(isProbabilityBps(10_000), true);
  assert.equal(isProbabilityBps(3400), true);
  assert.equal(isProbabilityBps(10_001), false);
  assert.equal(isProbabilityBps(-1), false);
  assert.equal(isProbabilityBps(34.5), false);
  assert.equal(isProbabilityBps("3400"), false);
});

test("a signature from the agent verifies and a tampered forecast does not", async () => {
  const f = forecast();
  const signature = await account.signTypedData({
    domain,
    types: FORECAST_TYPES,
    primaryType: "Forecast",
    message: { ...f, probabilityBps: f.probabilityBps },
  });
  const verify = createForecastVerifier(domain);
  assert.equal(await verify(f, signature), true);
  assert.equal(await verify(forecast({ probabilityBps: 9000 }), signature), false);
  assert.equal(await verify(forecast({ agent: "0x2222222222222222222222222222222222222222" }), signature), false);
});

test("the Circle JSON document matches the EIP-712 shape", () => {
  const doc = JSON.parse(forecastTypedDataJson(domain, forecast()));
  assert.deepEqual(doc.types.EIP712Domain, [
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" },
  ]);
  assert.deepEqual(doc.types.Forecast, FORECAST_TYPES.Forecast);
  assert.equal(doc.primaryType, "Forecast");
  assert.equal(doc.message.seasonId, "1");
  assert.equal(doc.message.round, "3");
  assert.equal(doc.message.probabilityBps, 3400);
  assert.equal(doc.domain.chainId, 5042);
});

test("every leaf proves into the round root, including odd trees", () => {
  for (const size of [1, 2, 3, 5, 8, 11]) {
    const leaves = Array.from({ length: size }, (_, i) => forecastLeaf(forecast({ probabilityBps: 100 + i })));
    const tree = buildRoundTree([...leaves].reverse());
    assert.equal(tree.leaves.length, size);
    for (const leaf of leaves) {
      assert.equal(verifyProof(leaf, proofFor(tree.leaves, leaf), tree.root), true, `size ${size}`);
    }
    assert.equal(verifyProof(forecastLeaf(forecast({ probabilityBps: 9999 })), [], tree.root), false, "an outside leaf never proves");
  }
});

test("tree order does not depend on input order and duplicates collapse", () => {
  const a = forecastLeaf(forecast({ probabilityBps: 1 }));
  const b = forecastLeaf(forecast({ probabilityBps: 2 }));
  assert.equal(buildRoundTree([a, b]).root, buildRoundTree([b, a]).root);
  assert.deepEqual(buildRoundTree([a, a, b]).leaves.length, 2);
  assert.throws(() => buildRoundTree([]), /no leaves/);
});

test("deadline: commit must land at least one hour before market end", () => {
  const end = new Date("2026-10-20T12:00:00Z");
  assert.equal(committedInTime(new Date("2026-10-20T11:00:00Z"), end), true);
  assert.equal(committedInTime(new Date("2026-10-20T11:00:01Z"), end), false);
  assert.equal(committedInTime(new Date("2026-10-19T00:00:00Z"), end), true);
});

test("the slate leaf binds markets, baselines and end times, independent of order", () => {
  const markets = [
    { marketId: `0x${"bb".repeat(32)}` as const, baselineBps: 4100, endAt: new Date("2026-10-21T12:00:00Z") },
    { marketId: `0x${"aa".repeat(32)}` as const, baselineBps: 7300, endAt: new Date("2026-10-22T12:00:00Z") },
  ];
  const leaf = slateLeaf(1n, 3n, markets);
  assert.equal(slateLeaf(1n, 3n, [...markets].reverse()), leaf);
  assert.notEqual(slateLeaf(1n, 3n, [{ ...markets[0]!, baselineBps: 4200 }, markets[1]!]), leaf);
  assert.notEqual(slateLeaf(1n, 3n, [{ ...markets[0]!, endAt: new Date("2026-10-21T13:00:00Z") }, markets[1]!]), leaf);
  assert.notEqual(slateLeaf(1n, 4n, markets), leaf);
  // Sub-second differences do not change the leaf: end times are committed in whole seconds.
  assert.equal(slateLeaf(1n, 3n, [{ ...markets[0]!, endAt: new Date("2026-10-21T12:00:00.400Z") }, markets[1]!]), leaf);
});

test("allProofs matches proofFor for every leaf", () => {
  const leaves = Array.from({ length: 11 }, (_, i) => forecastLeaf(forecast({ probabilityBps: 200 + i })));
  const tree = buildRoundTree(leaves);
  const proofs = allProofs(tree.leaves);
  assert.equal(proofs.size, 11);
  for (const leaf of tree.leaves) assert.deepEqual(proofs.get(leaf), proofFor(tree.leaves, leaf));
});

test("salts are 32 random bytes", () => {
  const a = newSalt();
  assert.match(a, /^0x[0-9a-f]{64}$/);
  assert.notEqual(a, newSalt());
});
