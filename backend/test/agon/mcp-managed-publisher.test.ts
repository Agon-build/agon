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
const idOf = (value: ProviderDraftInput) => `draft-${createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24)}`;
const draftId = idOf(draft);

async function fixture(balance = 1_000_000_000_000_000_000n, badTransaction = false, uncertainOnce = false, highFee = false, writerReady = true, extra: { checksPassed?: (a: string, d: string) => Promise<boolean>; refuseFees?: number; publishPendingOnce?: boolean; estimate?: { gasLimit: string; maxFee: string; priorityFee: string }; recoverPublished?: (w: `0x${string}`, agentId: string) => Promise<{ reference: string; txHash: `0x${string}` } | null> } = {}) {
  const store = createMemoryManagedPublisherStore();
  const draftStore = createMemoryProviderDraftStore();
  await draftStore.create(actor, draftId, draft);
  const calls: Array<{ to: `0x${string}`; data: `0x${string}`; hash: `0x${string}`; key: string; fee: { gasLimit: string; maxFee: string; priorityFee: string } }> = [];
  let walletCreates = 0;
  let lostResponse = false;
  let refusals = extra.refuseFees ?? 0;
  let publishPending = extra.publishPendingOnce ?? false;
  let prepares = 0;
  const compiles: Record<string, unknown>[] = [];
  const estimates: string[] = [];
  const circle: ManagedPublisherCircle = {
    async createWallet(_ref, _key) { walletCreates++; return { walletId: "wallet-one", address: wallet }; },
    async estimateFee() {
      estimates.push("low");
      // Circle's LOW tier on Arc (17 Oct 2026): tip in the hundreds of gwei over a 20 gwei base fee.
      if (extra.estimate) return extra.estimate;
      return highFee ? { gasLimit: "200000", maxFee: "6000", priorityFee: "5960" } : { gasLimit: "100000", maxFee: "568.71", priorityFee: "528.71" };
    },
    async execute(input) {
      if (refusals > 0) { refusals--; throw new Error("Circle rejected the request (HTTP 400, code 2): API parameter invalid"); }
      const existing = calls.find((call) => call.key === input.idempotencyKey);
      if (existing) return { id: `circle-${calls.indexOf(existing)}`, state: "INITIATED" };
      const hash = `0x${(calls.length + 1).toString(16).padStart(64, "0")}` as const;
      calls.push({ to: input.contractAddress, data: input.callData, hash, key: input.idempotencyKey, fee: input.fee });
      if (uncertainOnce && !lostResponse) { lostResponse = true; throw new Error("Circle response lost after acceptance"); }
      return { id: `circle-${calls.length - 1}`, state: "INITIATED" };
    },
    async transaction(id) {
      const call = calls[Number(id.slice("circle-".length))];
      if (call?.to === registry && publishPending) { publishPending = false; return { state: "SENT", txHash: null }; }
      return { state: "COMPLETE", txHash: call?.hash ?? null };
    },
  };
  const chain: ManagedPublisherChain = {
    async balance() { return balance; },
    async hasCode() { return true; },
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
      const id = idOf(value);
      await draftStore.create(publisher, id, value);
      return { ok: true, value: { draftId: id, draft: value, nextAction: "run_listing_checks" } };
    },
    async compileListing(_publisher: string, input: Record<string, unknown>) { compiles.push(input); return { ok: true, value: { manifestUri: "https://api.example.com/manifest.json" } }; },
    async publishListingVersion() {
      return { ok: true, value: { status: "prepared", operationId: "operation-version", transaction: {
        chainId: "5042002", to: registry, data: "0xbeef", functionName: "publishVersion", args: [],
      } } };
    },
    async publishListing() {
      prepares++;
      // Once the publish is on chain the contract refuses a second simulation (ServiceKeyAlreadyPublished).
      if (calls.some((c) => c.to === registry)) return { ok: false, message: "listing publication simulation was refused by the contract" };
      return { ok: true, value: { status: "prepared", operationId: "operation-one", transaction: {
        chainId: "5042002", to: registry, data: "0xabcd", functionName: "publish", args: [],
      } } };
    },
    async confirmListing() {
      return { ok: true, value: { status: "published", reference: `5042002:${registry}:7` } };
    },
  } as unknown as ReturnType<typeof createMcpAccessAdapter>;
  const { refuseFees: _refuse, publishPendingOnce: _pending, estimate: _estimate, ...options } = extra;
  const make = () => createManagedPublisher({
    store, draftStore, access, circle, chain, identityRegistry: identity,
    serviceRegistry: registry, publicApiUrl: "https://api.example.com/",
    publicationReady: async () => writerReady,
    ...options,
  });
  const publisher = make();
  const setup = await publisher.setup(actor, draftId);
  storePublicId = (await store.get(actor, draftId))!.publicId;
  return { publisher, make, setup, calls, access, store, draftStore, compiles, estimates, prepares: () => prepares, publicId: storePublicId, walletCreates: () => walletCreates };
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

test("each write carries Circle's live LOW fee and gas limit for Arc", async () => {
  // Circle refuses any tip under its own floating minimum on Arc (probed 17 Oct 2026), so the
  // publisher pins Circle's estimate and caps gasLimit x maxFee instead of computing its own fee.
  const f = await fixture();
  await f.publisher.approve(actor, draftId, f.setup.termsDigest, "approve");
  await f.publisher.advance(actor, draftId);
  assert.deepEqual(f.calls.map((c) => c.fee), [
    { gasLimit: "100000", maxFee: "568.71", priorityFee: "528.71" },
    { gasLimit: "100000", maxFee: "568.71", priorityFee: "528.71" },
  ]);
});

test("a fee Circle refuses is estimated again and sent once more; nothing counts as sent until Circle accepts", async () => {
  const f = await fixture(1_000_000_000_000_000_000n, false, false, false, true, { refuseFees: 1 });
  await f.publisher.approve(actor, draftId, f.setup.termsDigest, "approve");
  const before = f.estimates.length;
  assert.equal((await f.publisher.advance(actor, draftId)).status, "published");
  assert.equal(f.estimates.length - before, 3, "one estimate per write plus one after the refusal");
});

test("a second refusal stops with Circle's reason and leaves the write unsent", async () => {
  const f = await fixture(1_000_000_000_000_000_000n, false, false, false, true, { refuseFees: 2 });
  await f.publisher.approve(actor, draftId, f.setup.termsDigest, "approve");
  await assert.rejects(f.publisher.advance(actor, draftId), /Circle refused the transaction fee twice\. Nothing was sent/);
  const state = (await f.store.get(actor, draftId))!.state;
  assert.equal(state.registerTxId, null);
  assert.equal(state.registerFee, null, "the refused fee is not kept for the next try");
  assert.equal(f.calls.length, 0);
});

test("a fee pinned in an older shape or by an older rule is estimated again, never sent", async () => {
  for (const old of [{ gasLimit: "200000", gasPrice: "0.02" }, { gasLimit: "200000", maxFee: "41", priorityFee: "1" }]) {
    const f = await fixture(1_000_000_000_000_000_000n, false, false, false, true, { refuseFees: 1 });
    await f.publisher.approve(actor, draftId, f.setup.termsDigest, "approve");
    const record = (await f.store.get(actor, draftId))!;
    await f.store.save(record, { ...record.state, registerFee: old as never });
    await f.publisher.advance(actor, draftId);
    assert.deepEqual(f.calls[0]!.fee, { gasLimit: "100000", maxFee: "568.71", priorityFee: "528.71" });
  }
});

test("a sent publish is confirmed on a later check from its saved calldata, never prepared again", async () => {
  // Kestrel, 17 Oct 2026: the check after Circle sent the publish re-ran the simulation, which the
  // contract refused because the listing already existed, and failed until the indexer caught up.
  const f = await fixture(1_000_000_000_000_000_000n, false, false, false, true, { publishPendingOnce: true });
  await f.publisher.approve(actor, draftId, f.setup.termsDigest, "approve");
  assert.equal((await f.publisher.advance(actor, draftId)).status, "pending");
  const preparedBefore = f.prepares();
  const done = await f.make().advance(actor, draftId);
  assert.equal(done.status, "published");
  assert.equal(done.reference, `5042002:${registry}:7`);
  assert.equal(f.prepares(), preparedBefore, "no second preparation after the publish was sent");
  assert.equal(f.calls.length, 2);
});

test("a publish-sized write at Circle's HIGH tip fits the 1 USDC cap", async () => {
  // Kestrel's publish: Circle gas limit 864,081; Circle's HIGH tip reached 692.51 gwei on 17 Oct 2026.
  const f = await fixture(2_000_000_000_000_000_000n, false, false, false, true, { estimate: { gasLimit: "864081", maxFee: "732.51", priorityFee: "692.51" } });
  await f.publisher.approve(actor, draftId, f.setup.termsDigest, "approve");
  assert.equal((await f.publisher.advance(actor, draftId)).status, "published");
});

test("results show the fee limit and the next write's worst case before anything is approved", async () => {
  const f = await fixture();
  assert.equal(f.setup.feeLimitUSDC, "1", "Circle's own per-transaction limit is the default");
  assert.deepEqual(f.setup.nextFee, { action: "register", worstCaseUSDC: "0.056871" });
  const approved = await f.publisher.approve(actor, draftId, f.setup.termsDigest, "approve", "0.5");
  assert.equal(approved.feeLimitUSDC, "0.5");
});

test("a write whose worst case is above the builder's fee limit is not sent, and says how to go on", async () => {
  const f = await fixture();
  await f.publisher.approve(actor, draftId, f.setup.termsDigest, "approve", "0.05");
  const held = await f.publisher.advance(actor, draftId);
  assert.equal(held.status, "needs_attention");
  assert.match(held.nextAction, /could reach 0\.056871 USDC, above your 0\.05 USDC limit\. Nothing was sent/);
  assert.deepEqual(held.nextFee, { action: "register", worstCaseUSDC: "0.056871" });
  assert.equal(f.calls.length, 0);
  assert.equal((await f.store.get(actor, draftId))!.state.registerFee, null, "a fee over the limit is never pinned");
  await f.publisher.approve(actor, draftId, f.setup.termsDigest, "approve", "0.1");
  assert.equal((await f.publisher.advance(actor, draftId)).status, "published");
});

test("a fee limit must be above 0 and at most 1 USDC, in plain USDC", async () => {
  const f = await fixture();
  for (const bad of ["0", "1.5", "abc", "0.0000001", "-1"]) {
    await assert.rejects(f.publisher.approve(actor, draftId, f.setup.termsDigest, "approve", bad), /fee limit/i, bad);
  }
  assert.equal((await f.store.get(actor, draftId))!.state.approvedAt, null, "a refused limit approves nothing");
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

test("a listing already published on chain is recovered and confirmed instead of published again", async () => {
  const recovered: string[] = [];
  const f = await fixture(1_000_000_000_000_000_000n, false, false, false, true, {
    recoverPublished: async (walletAddress: string, agentId: string) => {
      recovered.push(`${walletAddress}:${agentId}`);
      return { reference: `5042002:${registry}:1`, txHash: `0x${"a".repeat(64)}` as `0x${string}` };
    },
  } as never);
  await f.publisher.approve(actor, draftId, f.setup.termsDigest, "approve");
  const out = await f.publisher.advance(actor, draftId);
  assert.equal(out.status, "published");
  assert.equal(out.reference, `5042002:${registry}:1`);
  assert.equal(f.calls.length, 1, "only the identity registration; no second publish");
  assert.deepEqual(recovered, [`${wallet}:42`]);
});

test("two overlapping advances for one draft run one after the other and publish once", async () => {
  const f = await fixture();
  await f.publisher.approve(actor, draftId, f.setup.termsDigest, "approve");
  const [a, b] = await Promise.all([f.publisher.advance(actor, draftId), f.publisher.advance(actor, draftId)]);
  assert.equal(a.status, "published");
  assert.equal(b.status, "published");
  assert.equal(f.calls.length, 2, "one register, one publish");
});

test("a publish whose transaction is on record but never confirmed is recovered, not prepared again", async () => {
  const f = await fixture(1_000_000_000_000_000_000n, false, false, false, true, {
    recoverPublished: async () => ({ reference: `5042002:${registry}:1`, txHash: `0x${"b".repeat(64)}` as `0x${string}` }),
  } as never);
  await f.publisher.approve(actor, draftId, f.setup.termsDigest, "approve");
  // The state this listing was really in: identity done, a publish sent and saved, then the run died before confirming.
  const record = (await f.store.get(actor, draftId))!;
  await f.store.save(record, { ...record.state, agentId: "42", registerTxHash: `0x${"c".repeat(64)}`, operationId: "operation-one", publishTxId: "circle-9" });
  const access = f.access as unknown as { publishListing: () => Promise<unknown> };
  access.publishListing = async () => ({ ok: false, code: "conflict", message: "listing publication simulation was refused by the contract" });
  const out = await f.publisher.advance(actor, draftId);
  assert.equal(out.status, "published");
  assert.equal(out.reference, `5042002:${registry}:1`);
});

test("updating a listing published through Agon reuses its wallet and agent, skips registration and publishes a new version", async () => {
  // The publisher would recover the original listing for this wallet; an update must still write its version.
  const f = await fixture(undefined, false, false, false, true, { recoverPublished: async () => ({ reference: `5042002:${registry}:7`, txHash: `0x${"9".repeat(64)}` }) });
  await f.publisher.approve(actor, draftId, f.setup.termsDigest, "approve");
  const first = await f.publisher.advance(actor, draftId);
  assert.equal(first.reference, `5042002:${registry}:7`);
  assert.equal(f.calls.length, 1, "the identity registration only; the listing was recovered");
  const updated: ProviderDraftInput = { ...draft, inputs: ["question: your question in plain words"] };
  const updatedId = idOf(updated);
  await f.draftStore.create(actor, updatedId, updated);
  const setup = await f.publisher.setupVersion(actor, updatedId, first.reference!);
  assert.deepEqual([setup.status, setup.fundingAddress, setup.agentId, f.walletCreates()], ["review_terms", wallet, "42", 1]);
  await f.publisher.approve(actor, updatedId, setup.termsDigest, "approve");
  const out = await f.publisher.advance(actor, updatedId);
  assert.equal(out.status, "published");
  assert.equal(f.calls.length, 2, "one more write, the version, and no second identity");
  assert.deepEqual([f.calls[1]!.to, f.calls[1]!.data], [registry, "0xbeef"]);
  assert.deepEqual(f.compiles.at(-1), { draftId: updatedId, agentId: "42", listingId: "7" });
});

test("only the account that published a listing through Agon can update it", async () => {
  const f = await fixture();
  await f.publisher.approve(actor, draftId, f.setup.termsDigest, "approve");
  const first = await f.publisher.advance(actor, draftId);
  const updated: ProviderDraftInput = { ...draft, outcome: "A clearer outcome" };
  const updatedId = idOf(updated);
  const stranger = `0x${"5".repeat(40)}` as const;
  await f.draftStore.create(stranger, updatedId, updated);
  await assert.rejects(f.publisher.setupVersion(stranger, updatedId, first.reference!), /published through Agon/);
  await f.draftStore.create(actor, updatedId, updated);
  await assert.rejects(f.publisher.setupVersion(actor, updatedId, `5042002:${registry}:99`), /published through Agon/);
});
