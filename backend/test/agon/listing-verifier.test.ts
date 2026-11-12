import assert from "node:assert/strict";
import test from "node:test";

import {
  AgonListingVerificationError,
  createViemAgonListingVerifier,
  readAgonListingVerifierReadiness,
} from "../../src/agon/execution/listing-verifier.ts";

const registry = `0x${"11".repeat(20)}` as `0x${string}`;
const verifier = `0x${"22".repeat(20)}` as `0x${string}`;
const manifestHash = `0x${"33".repeat(32)}` as `0x${string}`;
const txHash = `0x${"44".repeat(32)}` as `0x${string}`;

function listing(overrides: Record<string, unknown> = {}) {
  return {
    listingId: 7n,
    agentId: 42n,
    manifestHash,
    version: 3n,
    status: 0,
    verification: 0,
    ...overrides,
  };
}

const request = {
  listingId: "7",
  agentId: "42",
  listingVersion: "3",
  manifestHash,
};

test("listing verifier binds the write to the exact current listing version", async () => {
  let current = listing();
  const writes: string[] = [];
  const submitted: string[] = [];
  const adapter = createViemAgonListingVerifier({
    enabled: true,
    registryAddress: registry,
    verifierAddress: verifier,
    client: {
      async readContract(input) { return input.functionName === "verificationScopeSupported" ? true : current; },
      async waitForTransactionReceipt() { current = listing({ verification: 2 }); return { status: "success" as const }; },
    },
    wallet: {
      async writeContract(input) { writes.push(input.functionName); return txHash; },
    },
  });

  const result = await adapter.verify({ ...request, onSubmitted: async (hash) => { submitted.push(hash); } });
  assert.deepEqual(result, { status: "confirmed", transactionHash: txHash });
  assert.deepEqual(writes, ["setVerificationForVersion"]);
  assert.deepEqual(submitted, [txHash]);
});

test("listing verifier is idempotent after an unknown receipt outcome", async () => {
  let current = listing();
  let writes = 0;
  const adapter = createViemAgonListingVerifier({
    enabled: true,
    registryAddress: registry,
    verifierAddress: verifier,
    client: {
      async readContract(input) { return input.functionName === "verificationScopeSupported" ? true : current; },
      async waitForTransactionReceipt() { current = listing({ verification: 2 }); throw new Error("timeout"); },
    },
    wallet: { async writeContract() { writes += 1; return txHash; } },
  });

  await assert.rejects(() => adapter.verify(request), (error: unknown) => error instanceof AgonListingVerificationError && error.code === "unknown_outcome");
  assert.deepEqual(await adapter.verify(request), { status: "already_verified", transactionHash: null });
  assert.equal(writes, 1);
});

test("listing verifier reconciles a previously submitted transaction before writing again", async () => {
  let current = listing();
  let writes = 0;
  const adapter = createViemAgonListingVerifier({
    enabled: true,
    registryAddress: registry,
    verifierAddress: verifier,
    client: {
      async readContract(input) { return input.functionName === "verificationScopeSupported" ? true : current; },
      async waitForTransactionReceipt(input) {
        assert.equal(input.hash, txHash);
        current = listing({ verification: 2 });
        return { status: "success" as const };
      },
    },
    wallet: { async writeContract() { writes += 1; return txHash; } },
  });

  assert.deepEqual(await adapter.verify({ ...request, priorTransactionHash: txHash }), {
    status: "confirmed",
    transactionHash: txHash,
  });
  assert.equal(writes, 0);
});

test("listing verifier preserves the transaction hash when durable submission recording fails", async () => {
  const adapter = createViemAgonListingVerifier({
    enabled: true,
    registryAddress: registry,
    verifierAddress: verifier,
    client: {
      async readContract(input) { return input.functionName === "verificationScopeSupported" ? true : listing(); },
      async waitForTransactionReceipt() { throw new Error("not expected"); },
    },
    wallet: { async writeContract() { return txHash; } },
  });

  await assert.rejects(
    () => adapter.verify({ ...request, onSubmitted: async () => { throw new Error("database unavailable"); } }),
    (error: unknown) => error instanceof AgonListingVerificationError
      && error.code === "unknown_outcome"
      && error.transactionHash === txHash,
  );
});

test("listing verifier suspends the exact version after repeated lifecycle defaults", async () => {
  let current = listing({ verification: 2 });
  let target: unknown = null;
  const adapter = createViemAgonListingVerifier({
    enabled: true,
    registryAddress: registry,
    verifierAddress: verifier,
    client: {
      async readContract(input) { return input.functionName === "verificationScopeSupported" ? true : current; },
      async waitForTransactionReceipt() { current = listing({ verification: 4 }); return { status: "success" as const }; },
    },
    wallet: {
      async writeContract(input) { target = input.args[3]; return txHash; },
    },
  });
  assert.deepEqual(await adapter.suspend(request), { status: "confirmed", transactionHash: txHash });
  assert.equal(target, 4);
  assert.deepEqual(await adapter.suspend(request), { status: "already_suspended", transactionHash: null });
});

test("listing verifier refuses stale versions, hashes, agents, and non-listed services", async () => {
  for (const value of [
    listing({ version: 4n }),
    listing({ manifestHash: `0x${"55".repeat(32)}` }),
    listing({ agentId: 99n }),
    listing({ status: 1 }),
  ]) {
    const adapter = createViemAgonListingVerifier({
      enabled: true,
      registryAddress: registry,
      verifierAddress: verifier,
      client: { async readContract(input) { return input.functionName === "verificationScopeSupported" ? true : value; }, async waitForTransactionReceipt() { throw new Error("not expected"); } },
      wallet: { async writeContract() { throw new Error("not expected"); } },
    });
    await assert.rejects(() => adapter.verify(request), (error: unknown) => error instanceof AgonListingVerificationError && error.code === "scope_mismatch");
  }
});

test("listing verifier refuses suspension writes on a V1 registry", async () => {
  let writes = 0;
  const adapter = createViemAgonListingVerifier({
    enabled: true,
    registryAddress: registry,
    verifierAddress: verifier,
    client: {
      async readContract(input) {
        if (input.functionName === "verificationScopeSupported") throw new Error("function missing");
        return listing({ verification: 2 });
      },
      async waitForTransactionReceipt() { throw new Error("not expected"); },
    },
    wallet: { async writeContract() { writes += 1; return txHash; } },
  });
  await assert.rejects(() => adapter.suspend(request), (error: unknown) => error instanceof AgonListingVerificationError && error.code === "disabled");
  assert.equal(writes, 0);
});

test("listing verifier readiness requires the scoped VERIFIER_ROLE", async () => {
  const ready = await readAgonListingVerifierReadiness({
    enabled: true,
    registryAddress: registry,
    verifierAddress: verifier,
    client: { async readContract(input) { return input.functionName === "VERIFIER_ROLE" ? `0x${"66".repeat(32)}` : true; } },
  });
  assert.equal(ready.assigned, true);
  assert.equal(ready.reason, "assigned");

  const missing = await readAgonListingVerifierReadiness({
    enabled: true,
    registryAddress: registry,
    verifierAddress: verifier,
    client: { async readContract(input) {
      if (input.functionName === "VERIFIER_ROLE") return `0x${"66".repeat(32)}`;
      if (input.functionName === "verificationScopeSupported") return true;
      return false;
    } },
  });
  assert.equal(missing.assigned, false);
  assert.equal(missing.reason, "role_not_assigned");

  const legacy = await readAgonListingVerifierReadiness({
    enabled: true,
    registryAddress: registry,
    verifierAddress: verifier,
    client: { async readContract(input) { return input.functionName === "VERIFIER_ROLE" ? `0x${"66".repeat(32)}` : false; } },
  });
  assert.equal(legacy.reason, "scoped_verification_unsupported");

  const deployedV1 = await readAgonListingVerifierReadiness({
    enabled: true,
    registryAddress: registry,
    verifierAddress: verifier,
    client: { async readContract(input) {
      if (input.functionName === "VERIFIER_ROLE") return `0x${"66".repeat(32)}`;
      if (input.functionName === "verificationScopeSupported") throw new Error("function missing");
      return true;
    } },
  });
  assert.equal(deployedV1.reason, "scoped_verification_unsupported");
});

function verifierOn(current: () => unknown, written: number[]) {
  return createViemAgonListingVerifier({
    enabled: true,
    registryAddress: registry,
    verifierAddress: verifier,
    client: {
      async readContract(input) { return input.functionName === "verificationScopeSupported" ? true : current(); },
      async waitForTransactionReceipt() { return { status: "success" as const }; },
    },
    wallet: {
      async writeContract(input) { written.push(input.args[3]); return txHash; },
    },
  });
}

test("a suspension the certification cycle wrote itself is lifted by its later approval", async () => {
  let current = listing({ verification: 4 });
  const written: number[] = [];
  const adapter = createViemAgonListingVerifier({
    enabled: true,
    registryAddress: registry,
    verifierAddress: verifier,
    client: {
      async readContract(input) { return input.functionName === "verificationScopeSupported" ? true : current; },
      async waitForTransactionReceipt() { current = listing({ verification: 2 }); return { status: "success" as const }; },
    },
    wallet: { async writeContract(input) { written.push(input.args[3]); return txHash; } },
  });
  assert.deepEqual(await adapter.verify({ ...request, liftOwnSuspension: true }), { status: "confirmed", transactionHash: txHash });
  assert.deepEqual(written, [2]);
});

test("a suspended listing is left alone when the cycle did not suspend it", async () => {
  const written: number[] = [];
  const adapter = verifierOn(() => listing({ verification: 4 }), written);
  await assert.rejects(adapter.verify(request), /does not allow automatic promotion/);
  await assert.rejects(adapter.verify({ ...request, liftOwnSuspension: false }), /does not allow automatic promotion/);
  assert.deepEqual(written, []);
});

test("an expired or revoked listing is never promoted, whatever the cycle asks", async () => {
  for (const verification of [3, 5]) {
    const written: number[] = [];
    const adapter = verifierOn(() => listing({ verification }), written);
    await assert.rejects(adapter.verify({ ...request, liftOwnSuspension: true }), /does not allow automatic promotion/);
    assert.deepEqual(written, []);
  }
});
