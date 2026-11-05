import test from "node:test";
import assert from "node:assert/strict";
import { createMcpAccessAdapter } from "../../src/agon/mcp/adapter.ts";
import { createMemoryMcpHireStore } from "../../src/agon/mcp/hire-store.ts";

const listing = {
  id: "5042002:0x1111111111111111111111111111111111111111:3",
  chainId: "5042002", serviceRegistry: "0x1111111111111111111111111111111111111111", listingId: "3", agentId: "42", serviceKey: `0x${"a".repeat(64)}`, category: "3", version: "1",
  manifest: { hash: `0x${"b".repeat(64)}`, uri: "https://provider.example/manifest.json", body: { service: { name: "CRM helper", description: "Enrich a bounded CRM list", logoUrl: "https://provider.example/logo.png", tags: ["crm"] }, invocation: { endpoint: "https://provider.example/execute", timeoutMs: 30_000, privacy: { description: "Deletes input after delivery" } }, pricing: { amountUSDC: "0.04" } } },
  providerSnapshot: `0x${"c".repeat(64)}`, status: "Listed", verification: { status: "Verified", scope: { agentId: "42", listingId: "3", version: "1", category: "3" } }, risk: { unverified: false, warning: null, quarantineReason: null }, endpointQa: { status: "passed", checkedAt: new Date().toISOString(), endpointStatus: 200, evidenceHash: `0x${"d".repeat(64)}`, reason: "ok", attempts: 1, passedAttempts: 1, successRate: 100, endpointUrl: "https://provider.example/execute" }, payment: { rail: "X402", directX402: true, escrowEligible: false }, provenance: { sourceBlockNumber: "1", sourceTxHash: `0x${"e".repeat(64)}`, sourceLogIndex: 1 },
} as const;

test("MCP search returns plain service terms and filters by price", async () => {
  const adapter = createMcpAccessAdapter({
    async listListings() { return { ok: true, value: { items: [listing], nextCursor: null } }; },
    async getListing() { return { ok: true, value: listing }; },
    async prepareX402Call() { return { ok: true, value: { intentId: "intent-1", actor: "0x1", idempotencyKey: "mcp-test-001", listingReference: listing.id, listingVersion: "1", inputHash: `0x${"1".repeat(64)}`, maxAmountUSDC: "0.04", state: "prepared", executionEnabled: false, nextAction: "execution_adapter_not_enabled" } }; },
  });
  const found = await adapter.searchServices({ query: "CRM", maxPriceUSDC: "0.05" });
  assert.equal(found.ok, true);
  if (found.ok) assert.equal(found.value.services[0]?.name, "CRM helper");
});

test("MCP preview binds terms to the provider price and input", async () => {
  const adapter = createMcpAccessAdapter({
    async listListings() { return { ok: true, value: { items: [], nextCursor: null } }; },
    async getListing() { return { ok: true, value: listing }; },
    async prepareX402Call(_actor, _reference, request) { return { ok: true, value: { intentId: "intent-1", actor: "buyer", idempotencyKey: request.idempotencyKey, listingReference: listing.id, listingVersion: "1", inputHash: `0x${"1".repeat(64)}`, maxAmountUSDC: request.maxAmountUSDC, state: "prepared", executionEnabled: false, nextAction: "execution_adapter_not_enabled" } }; },
  });
  const preview = await adapter.previewHire("buyer", { serviceReference: listing.id, input: { records: [] } });
  assert.equal(preview.ok, true);
  if (preview.ok) {
    assert.equal(preview.value.terms.priceUSDC, "0.04");
    assert.equal(preview.value.terms.service.name, "CRM helper");
  }
});

test("MCP refuses escrow preview without creating an x402 intent", async () => {
  let prepared = 0;
  const adapter = createMcpAccessAdapter({
    async listListings() { return { ok: true, value: { items: [], nextCursor: null } }; },
    async getListing() { return { ok: true, value: listing }; },
    async prepareX402Call() { prepared++; throw new Error("x402 must not run for escrow"); },
  });
  const result = await adapter.previewHire("buyer", { serviceReference: listing.id, input: {}, paymentMode: "escrow" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "capability_unavailable");
  assert.equal(prepared, 0);
});

test("MCP authorization and work status stay task-oriented", async () => {
  const adapter = createMcpAccessAdapter({
    async listListings() { return { ok: true, value: { items: [], nextCursor: null } }; },
    async getListing() { return { ok: true, value: listing }; },
    async prepareX402Call() { return { ok: true, value: { intentId: "intent-1", actor: "buyer", idempotencyKey: "mcp-test-001", listingReference: listing.id, listingVersion: "1", inputHash: `0x${"1".repeat(64)}`, maxAmountUSDC: "0.04", state: "prepared", executionEnabled: false, nextAction: "execution_adapter_not_enabled" } }; },
    async approveX402Call() { return { ok: true, value: { state: "approved" } }; },
    async getX402SettlementReadiness() { return { ok: true, value: { receiptId: "receipt-1", intentId: "intent-1", state: "service_delivery_pending", network: "eip155:5042002", settlementRef: null, providerTransferId: null, status: "service_delivery_pending", reason: "provider delivery pending", executionEnabled: false, nextAction: "deliver_service", checkedAt: new Date().toISOString() } }; },
  });
  const preview = await adapter.previewHire("buyer", { serviceReference: listing.id, input: { records: [] } });
  assert.equal(preview.ok, true);
  if (!preview.ok) return;
  const approved = await adapter.authorizeHire("buyer", "intent-1", { termsDigest: preview.value.terms.termsDigest, approval: "approve", idempotencyKey: "hire-test-001" });
  assert.equal(approved.ok, true);
  const work = await adapter.getWork("buyer", "intent-1");
  assert.equal(work.ok, true);
  if (work.ok) assert.equal(work.value.status, "working");
  const retry = await adapter.retryOrReportWork("buyer", "intent-1", "retry_delivery");
  assert.deepEqual(retry, { ok: false, code: "retry_unavailable", message: "Automatic delivery retry is not available. Check the settlement status before contacting support; do not pay again." });
});

test("MCP hire terms survive a fresh adapter and remain scoped to the buyer", async () => {
  const buyer = "0x1111111111111111111111111111111111111111";
  const other = "0x2222222222222222222222222222222222222222";
  const hireStore = createMemoryMcpHireStore();
  let currentTime = Date.now();
  let approvals = 0;
  const service = {
    async listListings() { return { ok: true as const, value: { items: [], nextCursor: null } }; },
    async getListing() { return { ok: true as const, value: listing }; },
    async prepareX402Call(_actor: string, _reference: string, request: { idempotencyKey: string; maxAmountUSDC: string }) {
      return { ok: true as const, value: { intentId: "intent-restart", actor: buyer, idempotencyKey: request.idempotencyKey, listingReference: listing.id, listingVersion: "1", inputHash: `0x${"1".repeat(64)}`, maxAmountUSDC: request.maxAmountUSDC, state: "prepared" as const, executionEnabled: false, nextAction: "execution_adapter_not_enabled" } };
    },
    async approveX402Call() { approvals++; return { ok: true as const, value: { state: "approved" } }; },
    async getX402SettlementReadiness() { return { ok: true as const, value: { receiptId: "receipt-restart", intentId: "intent-restart", state: "approved", network: "eip155:5042002", settlementRef: null, providerTransferId: null, status: "not_ready" as const, reason: "awaiting settlement", executionEnabled: false, nextAction: "prepare_authorization", checkedAt: new Date().toISOString() } }; },
  };
  const preview = await createMcpAccessAdapter(service, { hireStore, now: () => currentTime }).previewHire(buyer, { serviceReference: listing.id, input: { records: ["a"] } });
  assert.equal(preview.ok, true);
  if (!preview.ok) return;
  const resumed = createMcpAccessAdapter(service, { hireStore, now: () => currentTime });
  const wrongBuyer = await resumed.authorizeHire(other, "intent-restart", { termsDigest: preview.value.terms.termsDigest, approval: "approve", idempotencyKey: "hire-restart-001" });
  assert.equal(wrongBuyer.ok, false);
  const approved = await resumed.authorizeHire(buyer, "intent-restart", { termsDigest: preview.value.terms.termsDigest, approval: "approve", idempotencyKey: "hire-restart-001" });
  assert.equal(approved.ok, true);
  assert.equal(approvals, 1);
  const status = await resumed.getWork(buyer, "intent-restart");
  assert.equal(status.ok, true);
  if (status.ok) assert.equal(status.value.terms?.termsDigest, preview.value.terms.termsDigest);
  const hidden = await resumed.getWork(other, "intent-restart");
  assert.equal(hidden.ok, false);
  const report = await resumed.retryOrReportWork(buyer, "intent-restart", "report_problem");
  assert.equal(report.ok, true);
  const privateReport = await resumed.retryOrReportWork(other, "intent-restart", "report_problem");
  assert.equal(privateReport.ok, false);
  currentTime += 10 * 60_000;
  const expired = await resumed.authorizeHire(buyer, "intent-restart", { termsDigest: preview.value.terms.termsDigest, approval: "approve", idempotencyKey: "hire-restart-002" });
  assert.equal(expired.ok, false);
  if (!expired.ok) assert.equal(expired.code, "terms_expired");
  assert.equal(approvals, 1);
});

test("MCP provider draft returns a stable draft and pre-publication checks", async () => {
  const adapter = createMcpAccessAdapter({
    async listListings() { return { ok: true, value: { items: [], nextCursor: null } }; },
    async getListing() { return { ok: false, error: { code: "not_found", message: "unused" } }; },
    async prepareX402Call() { return { ok: false, error: { code: "unused", message: "unused" } }; },
  });
  const draft = { name: "CRM helper", logoUrl: "https://provider.example/logo.png", outcome: "Enrich a bounded CRM list", category: "crm", inputs: ["records"], outputs: ["enriched records"], priceUSDC: "0.04", expectedLatencyMs: 90_000, privacy: "Deletes input after delivery", failurePolicy: "Retry delivery without another charge when safe", endpoint: "https://provider.example/execute" };
  const checked = await adapter.checkListing(draft);
  assert.equal(checked.ok, true);
  if (checked.ok) {
    assert.match(checked.value.draftId, /^draft-/);
    assert.equal(checked.value.checks[0]?.status, "passed");
    assert.equal(checked.value.nextAction, "review_and_approve_publication");
    const rechecked = await adapter.checkListing({ draftId: checked.value.draftId });
    assert.equal(rechecked.ok, true);
    const published = await adapter.publishListing("provider", { draftId: checked.value.draftId, approval: "approve" });
    assert.equal(published.ok, true);
    if (published.ok) assert.equal(published.value.nextAction, "compile_listing_with_manifest_uri");
    const paused = await adapter.pauseListing("provider", { reference: listing.id, approval: "approve" });
    assert.equal(paused.ok, true);
    if (paused.ok) assert.equal(paused.value.nextAction, "operator_pause_required");
    const compiled = await adapter.compileListing({ draftId: checked.value.draftId, agentId: "42" });
    assert.equal(compiled.ok, true);
    if (compiled.ok) {
      assert.equal(compiled.value.body.identity.agentId, "42");
      assert.match(compiled.value.manifestHash, /^0x[0-9a-f]{64}$/);
    }
  }
});

test("MCP search lists a listing's named inputs as what it accepts, and falls back to its tags", async () => {
  const withInputs = { ...listing, manifest: { ...listing.manifest, body: { ...listing.manifest.body, invocation: { ...listing.manifest.body.invocation, requestSchema: { type: "object", properties: { market: { type: "string", description: "a Polymarket market link, slug or condition id" }, note: { type: "string" } }, required: ["market"] } } } } };
  const adapter = createMcpAccessAdapter({
    async listListings() { return { ok: true, value: { items: [withInputs, listing], nextCursor: null } }; },
    async getListing() { return { ok: true, value: withInputs }; },
    async prepareX402Call() { throw new Error("not used"); },
  } as never);
  const found = await adapter.searchServices({});
  assert.equal(found.ok, true);
  if (found.ok) {
    assert.deepEqual(found.value.services[0]?.accepts, ["market: a Polymarket market link, slug or condition id", "note"]);
    assert.deepEqual(found.value.services[1]?.accepts, ["crm"]);
  }
});
