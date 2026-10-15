import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
  PostgresAgonRepository,
  type ListingProjection,
} from "../../src/agon/store/repository.ts";
import { PostgresAgonMarketService } from "../../src/agon/http/service.ts";
import { createAgonTestDatabase, type AgonTestDatabase } from "./database-test-helper.ts";

const CHAIN_ID = 50_420_02n;
const SERVICE_REGISTRY = "0x3333333333333333333333333333333333333333";
const LEGACY_SERVICE_REGISTRY = "0x2222222222222222222222222222222222222222";
const PROVIDER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OBSERVED_AT = new Date("2026-08-17T12:00:00.000Z");

let database: AgonTestDatabase;
let repository: PostgresAgonRepository;
let service: PostgresAgonMarketService;

before(async () => {
  database = await createAgonTestDatabase("service");
  repository = new PostgresAgonRepository(database.pool);
  service = new PostgresAgonMarketService(repository, {
    activeServiceRegistryAddress: SERVICE_REGISTRY,
  });

  await repository.withTransaction(async (tx) => {
    for (const listingId of [1n, 2n, 3n]) {
      const byte = Number(listingId).toString(16).padStart(2, "0");
      const listing: ListingProjection = {
        chainId: CHAIN_ID,
        serviceRegistry: SERVICE_REGISTRY,
        listingId,
        agentId: listingId === 3n ? 77n : 42n,
        serviceKey: `0x${byte.repeat(32)}`,
        category: listingId === 1n ? 9n : 7n,
        currentVersion: 1n,
        manifestHash: `0x${(20 + Number(listingId)).toString(16).repeat(64)}`.slice(0, 66),
        manifestUri: `ipfs://manifest-${listingId}`,
        paymentRail: "X402",
        providerSnapshot: PROVIDER,
        status: "Listed",
        verification: "Unverified",
        quarantineReason: null,
        sourceBlockNumber: 100n + listingId,
        sourceTxHash: `0x${(30 + Number(listingId)).toString(16).repeat(64)}`.slice(0, 66),
        sourceLogIndex: Number(listingId),
        observedAt: OBSERVED_AT,
      };
      await tx.upsertListing(listing);
    }
    await tx.upsertListing({
      chainId: CHAIN_ID,
      serviceRegistry: LEGACY_SERVICE_REGISTRY,
      listingId: 99n,
      agentId: 99n,
      serviceKey: `0x${"99".repeat(32)}`,
      category: 9n,
      currentVersion: 1n,
      manifestHash: `0x${"98".repeat(32)}`,
      manifestUri: "ipfs://legacy-manifest",
      paymentRail: "X402",
      providerSnapshot: PROVIDER,
      status: "Listed",
      verification: "Verified",
      quarantineReason: null,
      sourceBlockNumber: 99n,
      sourceTxHash: `0x${"97".repeat(32)}`,
      sourceLogIndex: 0,
      observedAt: OBSERVED_AT,
    });
  });

  await database.pool.query(
    `insert into agon_verification_evidence
      (listing_id, agent_id, passed, evidence_hash, evidence)
     values ($1, $2, $3, $4, $5::jsonb)`,
    [
      "1",
      "42",
      true,
      `0x${"ab".repeat(32)}`,
      JSON.stringify({
        listingId: "1",
        agentId: "42",
        checkedAt: "2026-08-20T08:00:00.000Z",
        passed: true,
        endpointStatus: 402,
        checks: { x402_payment: { passed: true, detail: "endpoint HTTP 402" } },
      }),
    ],
  );
});

after(async () => {
  await database.close();
});

test("paginates deterministically across identical timestamps", async () => {
  const first = await service.listListings({ limit: 2, cursor: null, category: null, agentId: null });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.deepEqual(first.value.items.map((item) => item.listingId), ["3", "2"]);
  assert(first.value.nextCursor);

  const second = await service.listListings({
    limit: 2,
    cursor: first.value.nextCursor,
    category: null,
    agentId: null,
  });
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.deepEqual(second.value.items.map((item) => item.listingId), ["1"]);
  assert.equal(second.value.nextCursor, null);
});

test("maps filters and explicit unverified risk from stored listings", async () => {
  const result = await service.listListings({ limit: 20, cursor: null, category: "9", agentId: "42" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.items.map((item) => item.listingId), ["1"]);
  assert.equal(result.value.items[0]?.risk.unverified, true);
  assert.equal(result.value.items[0]?.payment.directX402, true);
  assert.equal(result.value.items[0]?.payment.escrowEligible, false);
  assert.deepEqual(result.value.items[0]?.endpointQa, {
    status: "passed",
    checkedAt: "2026-08-20T08:00:00.000Z",
    endpointStatus: 402,
    evidenceHash: `0x${"ab".repeat(32)}`,
    reason: "Agon observed the service endpoint returning HTTP 402.",
    attempts: 1,
    passedAttempts: 1,
    successRate: 100,
  });
});

test("keeps direct x402 declared when no endpoint evidence exists", async () => {
  const result = await service.getListing(`${CHAIN_ID}:${SERVICE_REGISTRY}:2`);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.payment.directX402, true);
  assert.equal(result.value.endpointQa.status, "not_checked");
  assert.equal(result.value.endpointQa.endpointStatus, null);
  assert.equal(result.value.endpointQa.attempts, 0);
});

test("catalog lists only the active service registry after a registry migration", async () => {
  const activeCatalog = new PostgresAgonMarketService(repository, {
    activeServiceRegistryAddress: SERVICE_REGISTRY,
  });
  const result = await activeCatalog.listListings({ limit: 20, cursor: null, category: null, agentId: null });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.items.map((item) => item.listingId), ["3", "2", "1"]);

  const historical = await activeCatalog.getListing(`${CHAIN_ID}:${LEGACY_SERVICE_REGISTRY}:99`);
  assert.equal(historical.ok, true);
});

test("refuses new jobs when the deployed escrow interface cannot accept generated calldata", async () => {
  const incompatibleService = new PostgresAgonMarketService(repository, {
    agonJobEscrowAddress: "0x4444444444444444444444444444444444444444",
    jobEscrowCalldataSupported: false,
    jobEscrowExecutionReason: "deployed_abi_requires_buyer_supplied_fee",
  });

  const result = await incompatibleService.prepareAgonJobEscrowIntent(PROVIDER, {
    listingReference: `${CHAIN_ID}:${SERVICE_REGISTRY}:1`,
    idempotencyKey: "incompatible-escrow-001",
    amountBaseUnits: "1000000",
    reviewHours: 24,
    expiresAt: "2026-08-30T12:00:00.000Z",
  });

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "capability_unavailable",
      message: "The deployed AgonJobEscrow interface is not supported for new jobs",
    },
  });
});

test("reports endpoint QA only when its runtime dependency is available", async () => {
  const unavailable = new PostgresAgonMarketService(repository, { endpointQa: async () => false });
  const available = new PostgresAgonMarketService(repository, { endpointQa: async () => true });
  const failed = new PostgresAgonMarketService(repository, { endpointQa: async () => { throw new Error("database unavailable"); } });

  assert.equal((await unavailable.getCapabilities()).endpointQa, false);
  assert.equal((await available.getCapabilities()).endpointQa, true);
  assert.equal((await failed.getCapabilities()).endpointQa, false);
});

test("listings of Agon's own agents are marked first party, others are not", async () => {
  const marked = new PostgresAgonMarketService(repository, { activeServiceRegistryAddress: SERVICE_REGISTRY, firstPartyAgents: [{ key: "lead", agentId: "42", owner: PROVIDER }] });
  const wrongOwner = new PostgresAgonMarketService(repository, { activeServiceRegistryAddress: SERVICE_REGISTRY, firstPartyAgents: [{ key: "lead", agentId: "42", owner: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }] });
  const moved = await wrongOwner.getListing(`${CHAIN_ID}:${SERVICE_REGISTRY}:2`);
  assert.ok(moved.ok);
  assert.equal(moved.value.firstParty, false, "same id, different publishing wallet");
  const own = await marked.getListing(`${CHAIN_ID}:${SERVICE_REGISTRY}:2`);
  const other = await marked.getListing(`${CHAIN_ID}:${SERVICE_REGISTRY}:3`);
  assert.ok(own.ok && other.ok);
  assert.equal(own.value.firstParty, true);
  assert.equal(other.value.firstParty, false);
  const page = await marked.listListings({ limit: 50, cursor: null, category: null, agentId: null });
  assert.ok(page.ok);
  assert.deepEqual(page.value.items.filter((l) => ["1", "2", "3"].includes(l.listingId)).map((l) => [l.listingId, l.firstParty]).sort(), [["1", true], ["2", true], ["3", false]]);
  const plain = await service.getListing(`${CHAIN_ID}:${SERVICE_REGISTRY}:2`);
  assert.ok(plain.ok);
  assert.equal(plain.value.firstParty, false);
});
