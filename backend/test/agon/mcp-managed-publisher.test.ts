import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { encodeEventTopics, parseAbi, type Transaction, type TransactionReceipt } from "viem";
import { createManagedPublisher, type ManagedPublisherChain, type ManagedPublisherCircle } from "../../src/agon/mcp/managed-publisher.ts";
import { createAgonNativeMcpHandler } from "../../src/agon/mcp/native-server.ts";
import { createAgonRoutes, type AgonMarketService } from "../../src/agon/http/routes.ts";
import { Hono } from "hono";
import { createMemoryManagedPublisherStore } from "../../src/agon/mcp/managed-publisher-store.ts";
import { createMemoryProviderDraftStore } from "../../src/agon/mcp/provider-draft-store.ts";
import type { ProviderDraftInput } from "../../src/agon/mcp/contract.ts";
import type { createMcpAccessAdapter } from "../../src/agon/mcp/adapter.ts";

const actor = `0x${"1".repeat(40)}` as const;
const wallet = `0x${"2".repeat(40)}` as const;
const identity = `0x${"3".repeat(40)}` as const;
const registry = `0x${"4".repeat(40)}` as const;
const registrationAbi = parseAbi([
  "function register(string agentURI) returns (uint256 agentId)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
]);
const draft: ProviderDraftInput = {
  name: "A useful agent", logoUrl: "https://example.com/logo.png", outcome: "Answers a bounded question",
  category: "1", inputs: ["question"], outputs: ["answer"], priceUSDC: "0.01",
  expectedLatencyMs: 1000, privacy: "No retention", failurePolicy: "No charge if unavailable",
  endpoint: "https://example.com/run",
};
const draftId = `draft-${createHash("sha256").update(JSON.stringify(draft)).digest("hex").slice(0, 24)}`;

async function fixture(balance = 1_000_000_000_000_000_000n, badTransaction = false, uncertainOnce = false, highFee = false, writerReady = true, extra: { checksPassed?: (a: string, d: string) => Promise<boolean> } = {}) {
  const store = createMemoryManagedPublisherStore();
  const draftStore = createMemoryProviderDraftStore();
  await draftStore.create(actor, draftId, draft);
  const calls: Array<{ to: `0x${string}`; data: `0x${string}`; hash: `0x${string}`; key: string; fee: { gasLimit: string; gasPrice: string } }> = [];
  let walletCreates = 0;
  let lostResponse = false;
  const circle: ManagedPublisherCircle = {
    async createWallet(_ref, _key) { walletCreates++; return { walletId: "wallet-one", address: wallet }; },
    async execute(input) {
      const existing = calls.find((call) => call.key === input.idempotencyKey);
      if (existing) return { id: `circle-${calls.indexOf(existing)}`, state: "INITIATED" };
      const hash = `0x${(calls.length + 1).toString(16).padStart(64, "0")}` as const;
      calls.push({ to: input.contractAddress, data: input.callData, hash, key: input.idempotencyKey, fee: input.fee });
      if (uncertainOnce && !lostResponse) { lostResponse = true; throw new Error("Circle response lost after acceptance"); }
      return { id: `circle-${calls.length - 1}`, state: "INITIATED" };
    },
    async transaction(id) {
      const call = calls[Number(id.slice("circle-".length))];
      return { state: "COMPLETE", txHash: call?.hash ?? null };
    },
  };
  const chain: ManagedPublisherChain = {
    async balance() { return balance; },
    async hasCode() { return true; },
    async gasQuote() { return { gasLimit: 100_000n, gasPriceWei: highFee ? 2_000_000_000_000n : 10_000_000n }; },
    async transaction(hash) {
      const call = calls.find((item) => item.hash === hash)!;
      return { from: wallet, to: badTransaction ? actor : call.to, input: call.data } as Transaction;
    },
    async receipt(hash) {
      const call = calls.find((item) => item.hash === hash)!;
      const logs = call.to === identity ? [{
        address: identity,
        topics: encodeEventTopics({ abi: registrationAbi, eventName: "Transfer", args: { from: `0x${"0".repeat(40)}`, to: wallet, tokenId: 42n } }),
        data: "0x",
      }] : [];
      return { status: "success", logs } as unknown as TransactionReceipt;
    },
    async ownerOf() { return wallet; },
    async agentURI() { return `https://api.example.com/agon/identities/${storePublicId}`; },
  };
  let storePublicId = "";
  const access = {
    async startListing(publisher: string, value: ProviderDraftInput) {
      await draftStore.create(publisher, draftId, value);
      return { ok: true, value: { draftId, draft: value, nextAction: "run_listing_checks" } };
    },
    async compileListing() { return { ok: true, value: { manifestUri: "https://api.example.com/manifest.json" } }; },
    async publishListing() {
      return { ok: true, value: { status: "prepared", operationId: "operation-one", transaction: {
        chainId: "5042002", to: registry, data: "0xabcd", functionName: "publish", args: [],
      } } };
    },
    async confirmListing() {
      return { ok: true, value: { status: "published", reference: `5042002:${registry}:7` } };
    },
  } as unknown as ReturnType<typeof createMcpAccessAdapter>;
  const make = () => createManagedPublisher({
    store, draftStore, access, circle, chain, identityRegistry: identity,
    serviceRegistry: registry, publicApiUrl: "https://api.example.com/",
    publicationReady: async () => writerReady,
    ...extra,
  });
  const publisher = make();
  const setup = await publisher.setup(actor, draftId);
  storePublicId = (await store.get(actor, draftId))!.publicId;
  return { publisher, make, setup, calls, access, publicId: storePublicId, walletCreates: () => walletCreates };
}

test("a new draft gets one Circle wallet and requires an exact approval before writes", async () => {
  const f = await fixture();
  assert.equal(f.setup.fundingAddress, wallet);
  assert.equal(f.setup.status, "review_terms");
  assert.match(f.setup.custody, /Circle developer-controlled/);
  assert.equal((await f.publisher.advance(actor, draftId)).status, "review_terms");
  assert.equal(f.calls.length, 0);
  await assert.rejects(f.publisher.approve(actor, draftId, `0x${"0".repeat(64)}`, "approve"), /exact draft digest/);
  await f.publisher.setup(actor, draftId);
  assert.equal(f.walletCreates(), 1);
});

test("funding alone does not authorize a write and insufficient gas does not submit", async () => {
  const f = await fixture(0n);
  await f.publisher.approve(actor, draftId, f.setup.termsDigest, "approve");
  const next = await f.publisher.advance(actor, draftId);
  assert.equal(next.status, "fund_wallet");
  assert.equal(f.calls.length, 0);
});

test("an excessive gas quote is refused before Circle receives any write", async () => {
  const f = await fixture(1_000_000_000_000_000_000n, false, false, true);
  await f.publisher.approve(actor, draftId, f.setup.termsDigest, "approve");
  await assert.rejects(f.publisher.advance(actor, draftId), /gas quote exceeds the managed publisher limit/i);
  assert.equal(f.calls.length, 0);
});

test("registry or writer unavailability prevents identity registration", async () => {
  const f = await fixture(1_000_000_000_000_000_000n, false, false, false, false);
  await f.publisher.approve(actor, draftId, f.setup.termsDigest, "approve");
  const next = await f.publisher.advance(actor, draftId);
  assert.equal(next.status, "needs_attention");
  assert.equal(f.calls.length, 0);
});

test("registration with its hosted URI, publication and restart retry reconcile once", async () => {
  const f = await fixture();
  await f.publisher.approve(actor, draftId, f.setup.termsDigest, "approve");
  const published = await f.publisher.advance(actor, draftId);
  assert.equal(published.status, "published");
  assert.equal(published.agentId, "42");
  assert.equal(published.reference, `5042002:${registry}:7`);
  assert.equal(f.calls.length, 2);
  assert.equal((await f.make().advance(actor, draftId)).status, "published");
  assert.equal(f.calls.length, 2);
  const id = await f.publisher.publicIdentity(f.publicId);
  assert.equal(id?.name, draft.name);
  assert.deepEqual(id?.registrations, [{ agentId: 42, agentRegistry: `eip155:5042002:${identity}` }]);
});

test("a successful receipt with changed transaction target is refused", async () => {
  const f = await fixture(1_000_000_000_000_000_000n, true);
  await f.publisher.approve(actor, draftId, f.setup.termsDigest, "approve");
  await assert.rejects(f.publisher.advance(actor, draftId), /does not match the approved publisher action/);
  assert.equal(f.calls.length, 1);
});

test("a lost Circle response resumes with the same idempotency key after restart", async () => {
  const f = await fixture(1_000_000_000_000_000_000n, false, true);
  await f.publisher.approve(actor, draftId, f.setup.termsDigest, "approve");
  await assert.rejects(f.publisher.advance(actor, draftId), /response lost/);
  assert.equal(f.calls.length, 1);
  const recovered = await f.make().advance(actor, draftId);
  assert.equal(recovered.status, "published");
  assert.equal(f.calls.length, 2);
});

test("the public identity file is served only after an identity exists", async () => {
  const f = await fixture();
  const app = new Hono();
  app.route("/agon", createAgonRoutes({
    service: {} as AgonMarketService,
    verifyMcpToken: async () => null,
    requireAuth: async (_context, next) => { await next(); },
    managedPublisher: f.publisher,
  }));
  const before = await app.request(`/agon/identities/${f.publicId}`);
  assert.equal(before.status, 404);
  await f.publisher.approve(actor, draftId, f.setup.termsDigest, "approve");
  await f.publisher.advance(actor, draftId);
  const after = await app.request(`/agon/identities/${f.publicId}`);
  assert.equal(after.status, 200);
  const body = await after.json() as { registrations: Array<{ agentId: number }> };
  assert.equal(body.registrations[0]?.agentId, 42);
});

test("managed MCP tools are advertised only when wired and enforce scopes", async () => {
  const f = await fixture();
  const handler = createAgonNativeMcpHandler(f.access, f.publisher);
  const request = (method: string, params: Record<string, unknown>) => new Request("https://api.example.com/agon/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const list = await handler.fetch(request("tools/list", {}));
  assert.match(await list.text(), /setup_managed_publisher/);
  const call = request("tools/call", { name: "continue_managed_listing", arguments: { draftId } });
  const denied = await handler.fetch(call, { authInfo: {
    token: "verified", clientId: "agon-cli", scopes: ["agon:read"], extra: { address: actor, client: "agon-cli" },
  } });
  assert.match(await denied.text(), /scope_required/);
  assert.equal(f.calls.length, 0);
});

test("approval is refused without a recent passing check, and allowed after one", async () => {
  let passed = false;
  const seen: string[] = [];
  const { publisher, setup } = await fixture(undefined, false, false, false, true, { checksPassed: async (a, d) => { seen.push(`${a}:${d}`); return passed; } });
  await assert.rejects(publisher.approve(actor, draftId, setup.termsDigest, "approve"), /Run the listing checks first/);
  assert.deepEqual(seen, [`${actor}:${draftId}`], "the gate asks about the approving builder and this draft");
  passed = true;
  assert.equal((await publisher.approve(actor, draftId, setup.termsDigest, "approve")).status, "ready");
});

test("a publication re-prepared before anything was sent is adopted instead of blocking the listing", async () => {
  const f = await fixture();
  let prepares = 0;
  const access = f.access as unknown as { publishListing: () => Promise<unknown> };
  // The first prepare is saved; every later one returns a different operation, as when two advances overlapped.
  access.publishListing = async () => {
    prepares += 1;
    return { ok: true, value: { status: "prepared", operationId: prepares === 1 ? "operation-one" : "operation-two", transaction: {
      chainId: "5042002", to: registry, data: "0xabcd", functionName: "publish", args: [],
    } } };
  };
  await f.publisher.approve(actor, draftId, f.setup.termsDigest, "approve");
  const published = await f.publisher.advance(actor, draftId);
  assert.equal(published.status, "published");
  assert.equal(f.calls.length, 2, "one register, one publish");
});
