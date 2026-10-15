import { createHash, randomUUID } from "node:crypto";
import type { AgonListingView, ListingPage, SubmittedOperation, X402ApprovalRequest, X402CallIntentRequest, X402CallIntentView, X402SettlementReadinessView } from "../http/api-types.ts";
import { authorizeHireInput, compileListingInput, confirmListingInput, confirmPauseInput, pauseListingInput, previewHireInput, providerDraftInput, providerMutationResult, publishListingInput, publishListingVersionInput, serviceReference, serviceSearchInput, serviceTerms, type ProviderDraftInput, type ServiceReference } from "./contract.ts";
import { compileProviderManifest } from "./provider-manifest.ts";
import { createMemoryProviderDraftStore, type ProviderDraftStore, type ProviderPublicationEvidence } from "./provider-draft-store.ts";
import { createMemoryMcpHireStore, reviewedTermsDigest, type McpHireStore } from "./hire-store.ts";
import { HostedManifestError, type HostedManifestStore } from "../hosted-manifest-store.ts";
import type { ListingChecker } from "../listing/checker.ts";

export type McpResult<T> = { ok: true; value: T } | { ok: false; code: string; message: string };

export type McpCatalogService = {
  listListings(query: { limit: number; cursor: string | null; category: string | null; agentId: string | null; includeManifest: boolean }): Promise<{ ok: true; value: ListingPage } | { ok: false; error: { code: string; message: string } }>;
  getListing(reference: string): Promise<{ ok: true; value: AgonListingView } | { ok: false; error: { code: string; message: string } }>;
  getProviderListingForVersion?(listingId: string): Promise<{ ok: true; value: AgonListingView } | { ok: false; error: { code: string; message: string } }>;
  prepareX402Call(actor: string, reference: string, request: X402CallIntentRequest): Promise<{ ok: true; value: X402CallIntentView } | { ok: false; error: { code: string; message: string } }>;
  approveX402Call?(actor: string, intentId: string, request: X402ApprovalRequest): Promise<{ ok: true; value: unknown } | { ok: false; error: { code: string; message: string } }>;
  getX402SettlementReadiness?(actor: string, intentId: string): Promise<{ ok: true; value: X402SettlementReadinessView } | { ok: false; error: { code: string; message: string } }>;
  publishProviderDraft?(actor: string, draft: ProviderDraftInput, compiled: ReturnType<typeof compileProviderManifest>, manifestUri: string): Promise<{ ok: true; value: SubmittedOperation } | { ok: false; error: { code: string; message: string } }>;
  confirmOperation?(actor: string, operationId: string, txHash: `0x${string}`): Promise<{ ok: true; value: SubmittedOperation } | { ok: false; error: { code: string; message: string } }>;
  publishProviderDraftVersion?(actor: string, draft: ProviderDraftInput, compiled: ReturnType<typeof compileProviderManifest>, manifestUri: string, listingId: string): Promise<{ ok: true; value: SubmittedOperation } | { ok: false; error: { code: string; message: string } }>;
  pauseProviderListing?(actor: string, reference: string): Promise<{ ok: true; value: SubmittedOperation } | { ok: false; error: { code: string; message: string } }>;
};

function text(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function number(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function toServiceReference(listing: AgonListingView): ServiceReference {
  const body = listing.manifest.body && typeof listing.manifest.body === "object" ? listing.manifest.body as Record<string, unknown> : {};
  const service = body.service && typeof body.service === "object" ? body.service as Record<string, unknown> : body;
  const invocation = body.invocation && typeof body.invocation === "object" ? body.invocation as Record<string, unknown> : {};
  const pricing = body.pricing && typeof body.pricing === "object" ? body.pricing as Record<string, unknown> : {};
  const tags = Array.isArray(service.tags) ? service.tags.filter((tag): tag is string => typeof tag === "string") : [];
  const endpoint = typeof invocation.endpoint === "string" ? invocation.endpoint : "";
  const availability = listing.endpointQa.status === "passed" ? "ready" : listing.status !== "Listed" || listing.risk.quarantineReason ? "paused" : "needs_review";
  const verification = listing.risk.quarantineReason ? "quarantined" : listing.verification.status === "Verified" ? "verified" : listing.verification.status === "Unverified" ? "unverified" : "listed";
  return serviceReference.parse({
    reference: listing.id,
    source: { id: "arc", name: "AGON Arc" },
    name: text(service.name, `Service ${listing.listingId}`),
    logoUrl: typeof service.logoUrl === "string" && service.logoUrl.startsWith("https://") ? service.logoUrl : null,
    provider: `Agent ${listing.agentId}`,
    outcome: text(service.description, "A bounded agent service"),
    category: listing.category,
    priceUSDC: text(pricing.amountUSDC ?? pricing.amount, "0"),
    expectedLatencyMs: number(invocation.timeoutMs, 60_000),
    availability,
    verification,
    privacy: text((invocation.privacy as Record<string, unknown> | undefined)?.description, "See provider terms"),
    accepts: tags.length ? tags : [endpoint ? "structured request" : "service input"],
    returns: ["service result"],
  });
}

export function createMcpAccessAdapter(service: McpCatalogService, options: { providerDraftStore?: ProviderDraftStore; hireStore?: McpHireStore; hostedManifestStore?: HostedManifestStore; now?: () => number; listingChecker?: ListingChecker } = {}) {
  const hireStore = options.hireStore ?? createMemoryMcpHireStore();
  const now = options.now ?? Date.now;
  const providerDraftStore = options.providerDraftStore ?? createMemoryProviderDraftStore();
  const legacyDrafts = new Map<string, { draft: ProviderDraftInput; compiled: ReturnType<typeof compileProviderManifest> | null; manifestUri: string | null }>();

  function workStatus(readiness: X402SettlementReadinessView): "preparing" | "paid" | "working" | "delivered" | "reconciling" | "complete" | "needs_attention" {
    if (readiness.status === "terminal" && readiness.state === "reconciled") return "complete";
    if (readiness.status === "reconciliation_required") return "reconciling";
    if (readiness.status === "service_delivery_pending") return "working";
    if (readiness.status === "ready") return "paid";
    if (readiness.state === "service_delivered") return "delivered";
    if (readiness.state === "failed" || readiness.state === "rejected") return "needs_attention";
    return "preparing";
  }

  return {
    async searchServices(input: unknown): Promise<McpResult<{ services: ServiceReference[]; nextCursor: string | null }>> {
      const parsed = serviceSearchInput.safeParse(input);
      if (!parsed.success) return { ok: false, code: "invalid_request", message: parsed.error.issues[0]?.message ?? "Invalid service search" };
      const result = await service.listListings({ limit: parsed.data.limit, cursor: null, category: parsed.data.category ?? null, agentId: null, includeManifest: true });
      if (!result.ok) return { ok: false, code: result.error.code, message: result.error.message };
      const services = result.value.items.map(toServiceReference).filter((item) => {
        if (parsed.data.verifiedOnly && item.verification !== "verified") return false;
        if (parsed.data.maxPriceUSDC && Number(item.priceUSDC) > Number(parsed.data.maxPriceUSDC)) return false;
        if (parsed.data.maxLatencyMs && item.expectedLatencyMs > parsed.data.maxLatencyMs) return false;
        const query = parsed.data.query?.toLowerCase();
        return !query || `${item.name} ${item.outcome} ${item.category} ${item.accepts.join(" ")}`.toLowerCase().includes(query);
      });
      return { ok: true, value: { services, nextCursor: result.value.nextCursor } };
    },

    async getService(reference: string): Promise<McpResult<ServiceReference>> {
      const result = await service.getListing(reference);
      return result.ok ? { ok: true, value: toServiceReference(result.value) } : { ok: false, code: result.error.code, message: result.error.message };
    },

    async previewHire(actor: string, input: unknown): Promise<McpResult<{ terms: ReturnType<typeof serviceTerms.parse>; intent: X402CallIntentView }>> {
      const parsed = previewHireInput.safeParse(input);
      if (!parsed.success) return { ok: false, code: "invalid_request", message: parsed.error.issues[0]?.message ?? "Invalid hire preview" };
      if (parsed.data.paymentMode === "escrow") return { ok: false, code: "capability_unavailable", message: "MCP escrow hiring is not available. Choose per_call for a verified x402 service." };
      const listing = await service.getListing(parsed.data.serviceReference);
      if (!listing.ok) return { ok: false, code: listing.error.code, message: listing.error.message };
      const serviceReference = toServiceReference(listing.value);
      const request: X402CallIntentRequest = { idempotencyKey: `mcp-${randomUUID()}`, method: "POST", input: parsed.data.input, maxAmountUSDC: serviceReference.priceUSDC, endpointUrl: listing.value.manifest.body && typeof listing.value.manifest.body === "object" && typeof (listing.value.manifest.body as { invocation?: { endpoint?: unknown } }).invocation?.endpoint === "string" ? (listing.value.manifest.body as { invocation: { endpoint: string } }).invocation.endpoint : undefined };
      const intent = await service.prepareX402Call(actor, parsed.data.serviceReference, request);
      if (!intent.ok) return { ok: false, code: intent.error.code, message: intent.error.message };
      if (intent.value.actor.toLowerCase() !== actor.toLowerCase() || intent.value.listingReference !== listing.value.id || intent.value.listingVersion !== listing.value.version || intent.value.maxAmountUSDC !== serviceReference.priceUSDC) {
        return { ok: false, code: "intent_mismatch", message: "The prepared payment intent does not match the reviewed service and buyer." };
      }
      const expiresAt = new Date(now() + 10 * 60_000).toISOString();
      const reviewed = { service: serviceReference, input: parsed.data.input, priceUSDC: serviceReference.priceUSDC, paymentMode: parsed.data.paymentMode, expiresAt, deliveryDeadlineMs: serviceReference.expectedLatencyMs, privacy: serviceReference.privacy, failurePolicy: "Payment and delivery are reconciled separately; unknown payment outcomes remain reconciling." };
      const terms = serviceTerms.parse({ ...reviewed, termsDigest: reviewedTermsDigest(reviewed) });
      const stored = await hireStore.create(actor, intent.value.intentId, terms);
      return { ok: true, value: { terms: stored.terms, intent: intent.value } };
    },

    async authorizeHire(actor: string, hireId: string, input: unknown): Promise<McpResult<import("./contract.ts").HireResult>> {
      const parsed = authorizeHireInput.safeParse(input);
      if (!parsed.success) return { ok: false, code: "invalid_request", message: parsed.error.issues[0]?.message ?? "Invalid hire authorization" };
      const hire = await hireStore.get(actor, hireId);
      if (!hire) return { ok: false, code: "hire_not_found", message: "Preview this hire again before authorizing payment." };
      if (hire.terms.termsDigest.toLowerCase() !== parsed.data.termsDigest.toLowerCase()) return { ok: false, code: "terms_changed", message: "The hire terms changed; preview the service again." };
      if (Date.parse(hire.terms.expiresAt) <= now()) return { ok: false, code: "terms_expired", message: "The reviewed hire terms expired; preview the service again." };
      if (!service.approveX402Call) return { ok: false, code: "execution_not_ready", message: "Payment authorization is not configured." };
      const result = await service.approveX402Call(actor, hireId, { approvedAmountUSDC: hire.terms.priceUSDC });
      if (!result.ok) return { ok: false, code: result.error.code, message: result.error.message };
      return { ok: true, value: { status: "preparing", nextAction: "check_work_status", hireId, terms: hire.terms, paymentEvidence: { state: "approved", idempotencyKey: parsed.data.idempotencyKey } } };
    },

    async getWork(actor: string, hireId: string): Promise<McpResult<import("./contract.ts").HireResult>> {
      const hire = await hireStore.get(actor, hireId);
      if (!hire) return { ok: false, code: "hire_not_found", message: "The hire was not found for this account." };
      if (!service.getX402SettlementReadiness) return { ok: false, code: "execution_not_ready", message: "Work status is not configured." };
      const result = await service.getX402SettlementReadiness(actor, hireId);
      if (!result.ok) return { ok: false, code: result.error.code, message: result.error.message };
      const status = workStatus(result.value);
      return { ok: true, value: { status, nextAction: status === "complete" ? "none" : result.value.nextAction, hireId, terms: hire.terms, paymentEvidence: { state: result.value.state }, reconciliationEvidence: { status: result.value.status } } };
    },

    async retryOrReportWork(actor: string, hireId: string, action: "retry_delivery" | "report_problem"): Promise<McpResult<import("./contract.ts").HireResult>> {
      const hire = await hireStore.get(actor, hireId);
      if (!hire) return { ok: false, code: "hire_not_found", message: "The hire was not found for this account." };
      if (action === "retry_delivery") return { ok: false, code: "retry_unavailable", message: "Automatic delivery retry is not available. Check the settlement status before contacting support; do not pay again." };
      return { ok: true, value: { status: "needs_attention", nextAction: "open_support_case", hireId, terms: hire.terms } };
    },

    async startListing(actorOrInput: string | unknown, maybeInput?: unknown): Promise<McpResult<{ draftId: string; draft: ProviderDraftInput; nextAction: string }>> {
      const actor = typeof actorOrInput === "string" && maybeInput !== undefined ? actorOrInput : null;
      const input = maybeInput === undefined ? actorOrInput : maybeInput;
      const parsed = providerDraftInput.safeParse(input);
      if (!parsed.success) return { ok: false, code: "invalid_request", message: parsed.error.issues[0]?.message ?? "Invalid provider draft" };
      const draftId = `draft-${createHash("sha256").update(JSON.stringify(parsed.data)).digest("hex").slice(0, 24)}`;
      if (actor) await providerDraftStore.create(actor, draftId, parsed.data);
      else legacyDrafts.set(draftId, { draft: parsed.data, compiled: null, manifestUri: null });
      return { ok: true, value: { draftId, draft: parsed.data, nextAction: "run_listing_checks" } };
    },

    async checkListing(actorOrInput: string | unknown, maybeInput?: unknown): Promise<McpResult<{ draftId: string; checks: Array<{ name: string; status: "passed" | "failed" | "skipped" | "needs_attention"; required?: boolean; detail: string }>; requiredPassed?: boolean; certificationScore?: number | null; nextAction: string }>> {
      const actor = typeof actorOrInput === "string" && maybeInput !== undefined ? actorOrInput : null;
      const input = maybeInput === undefined ? actorOrInput : maybeInput;
      const reference = input && typeof input === "object" && "draftId" in input && typeof (input as { draftId?: unknown }).draftId === "string" ? (input as { draftId: string }).draftId : null;
      const draft = actor && reference ? await providerDraftStore.get(actor, reference) : null;
      const legacy = reference ? legacyDrafts.get(reference) : null;
      const started = (draft || legacy) && reference
        ? { ok: true as const, value: { draftId: reference, draft: draft?.draft ?? legacy!.draft, nextAction: "run_listing_checks" } }
        : await this.startListing(actor ?? input, actor ? input : undefined);
      if (!started.ok) return started;
      if (options.listingChecker) {
        // Checks are per builder: a pass lets that builder publish this endpoint at this price.
        if (!actor) return { ok: false, code: "authentication_required", message: "Connect AGON with an access token to run listing checks." };
        const out = await options.listingChecker.check(actor, started.value.draft);
        if (!out.ok) return { ok: false, code: "rate_limited", message: "Up to 10 checks an hour. Try again later." };
        return { ok: true, value: {
          draftId: started.value.draftId, checks: out.result.checks, requiredPassed: out.result.requiredPassed,
          certificationScore: out.result.certificationScore, nextAction: out.result.requiredPassed ? "approve_publication" : "fix_and_check_again",
        } };
      }
      const checks = [
        { name: "brand_identity", status: "passed" as const, detail: "The immutable service file includes the agent's public HTTPS logo." },
        { name: "secure_endpoint", status: "passed" as const, detail: "The service uses a public HTTPS endpoint." },
        { name: "terms_complete", status: "passed" as const, detail: "Price, input, output, privacy, and failure terms are present." },
        { name: "wallet_publication", status: "needs_attention" as const, detail: "A provider wallet approval is required before publication." },
      ];
      return { ok: true, value: { draftId: started.value.draftId, checks, nextAction: "review_and_approve_publication" } };
    },

    /** True when this builder has a recent passing check for the draft's endpoint and price (always true without a checker). */
    async checksPassed(actor: string, draftId: string): Promise<boolean> {
      if (!options.listingChecker) return true;
      const stored = await providerDraftStore.get(actor, draftId);
      return stored ? options.listingChecker.hasRecentPass(actor, stored.draft) : false;
    },

    async publishListing(actor: string, input: unknown): Promise<McpResult<import("./contract.ts").ProviderMutationResult>> {
      const parsed = publishListingInput.safeParse(input);
      if (!parsed.success) return { ok: false, code: "invalid_request", message: parsed.error.issues[0]?.message ?? "Invalid publication request" };
      const legacy = legacyDrafts.get(parsed.data.draftId);
      const stored = legacy ? null : await providerDraftStore.get(actor, parsed.data.draftId);
      const draft = stored?.draft ?? legacy?.draft;
      if (!draft) return { ok: false, code: "draft_not_found", message: "Create or resume the provider draft before publishing." };
      const compiled = stored?.compiled ?? legacy?.compiled;
      const manifestUri = stored?.manifestUri ?? legacy?.manifestUri;
      if (!compiled || !manifestUri) return { ok: true, value: providerMutationResult.parse({ status: "needs_attention", nextAction: "compile_listing_with_manifest_uri", draftId: parsed.data.draftId }) };
      if (!service.publishProviderDraft) return { ok: true, value: providerMutationResult.parse({ status: "needs_attention", nextAction: "connect_provider_wallet", draftId: parsed.data.draftId }) };
      const result = await service.publishProviderDraft(actor, draft, compiled, manifestUri);
      if (!result.ok) return { ok: false, code: result.error.code, message: result.error.message };
      if (stored) await providerDraftStore.markPrepared(actor, parsed.data.draftId, result.value.operationId, result.value.resultReference ?? undefined);
      return { ok: true, value: providerMutationResult.parse({ status: "prepared", nextAction: "review_and_sign_publication", draftId: parsed.data.draftId, operationId: result.value.operationId, reference: result.value.resultReference ?? undefined, transaction: result.value.transaction }) };
    },

    async publishListingVersion(actor: string, input: unknown): Promise<McpResult<import("./contract.ts").ProviderMutationResult>> {
      const parsed = publishListingVersionInput.safeParse(input);
      if (!parsed.success) return { ok: false, code: "invalid_request", message: parsed.error.issues[0]?.message ?? "Invalid version publication request" };
      const stored = await providerDraftStore.get(actor, parsed.data.draftId);
      if (!stored) return { ok: false, code: "draft_not_found", message: "Create and compile the version draft before publishing." };
      if (stored.publicationKind !== "version" || !stored.listingId) return { ok: false, code: "version_target_missing", message: "Compile this draft with an existing listingId to publish a new version." };
      if (!stored.compiled || !stored.manifestUri) return { ok: true, value: providerMutationResult.parse({ status: "needs_attention", nextAction: "compile_listing_with_manifest_uri", draftId: parsed.data.draftId }) };
      if (!service.publishProviderDraftVersion) return { ok: true, value: providerMutationResult.parse({ status: "needs_attention", nextAction: "connect_provider_wallet", draftId: parsed.data.draftId }) };
      const result = await service.publishProviderDraftVersion(actor, stored.draft, stored.compiled, stored.manifestUri, stored.listingId);
      if (!result.ok) return { ok: false, code: result.error.code, message: result.error.message };
      await providerDraftStore.markPrepared(actor, parsed.data.draftId, result.value.operationId, result.value.resultReference ?? undefined);
      return { ok: true, value: providerMutationResult.parse({ status: "prepared", nextAction: "review_and_sign_publication", draftId: parsed.data.draftId, operationId: result.value.operationId, reference: result.value.resultReference ?? undefined, transaction: result.value.transaction }) };
    },

    async pauseListing(actor: string, input: unknown): Promise<McpResult<import("./contract.ts").ProviderMutationResult>> {
      const parsed = pauseListingInput.safeParse(input);
      if (!parsed.success) return { ok: false, code: "invalid_request", message: parsed.error.issues[0]?.message ?? "Invalid pause request" };
      if (!service.pauseProviderListing) return { ok: true, value: providerMutationResult.parse({ status: "needs_attention", nextAction: "operator_pause_required", reference: parsed.data.reference }) };
      const result = await service.pauseProviderListing(actor, parsed.data.reference);
      if (!result.ok) return { ok: false, code: result.error.code, message: result.error.message };
      return { ok: true, value: providerMutationResult.parse({ status: "prepared", nextAction: "review_and_sign_pause", reference: parsed.data.reference, operationId: result.value.operationId, transaction: result.value.transaction }) };
    },

    async confirmPause(actor: string, input: unknown): Promise<McpResult<import("./contract.ts").ProviderMutationResult>> {
      const parsed = confirmPauseInput.safeParse(input);
      if (!parsed.success) return { ok: false, code: "invalid_request", message: parsed.error.issues[0]?.message ?? "Invalid pause confirmation" };
      if (!service.confirmOperation) return { ok: false, code: "execution_not_ready", message: "Pause confirmation is not configured." };
      const result = await service.confirmOperation(actor, parsed.data.operationId, parsed.data.txHash as `0x${string}`);
      if (!result.ok) return { ok: false, code: result.error.code, message: result.error.message };
      const operation = result.value;
      const reference = parsed.data.reference.match(/^([1-9]\d*):(0x[0-9a-fA-F]{40}):([1-9]\d*)$/);
      if (!reference || operation.transaction.functionName !== "setStatus" || operation.transaction.chainId !== reference[1] || operation.transaction.to.toLowerCase() !== reference[2]?.toLowerCase() || operation.transaction.args[0] !== reference[3] || operation.transaction.args[1] !== "1") {
        return { ok: false, code: "operation_mismatch", message: "The receipt does not match the requested listing pause." };
      }
      if (!operation.txHash || !operation.proof) return { ok: false, code: "reconciliation_unavailable", message: "Pause receipt was accepted without complete proof." };
      return { ok: true, value: providerMutationResult.parse({ status: "paused", nextAction: "none", reference: parsed.data.reference, operationId: operation.operationId, evidence: { txHash: operation.txHash, blockNumber: operation.proof.blockNumber, logIndex: operation.proof.logIndex } }) };
    },

    async confirmListing(actor: string, input: unknown): Promise<McpResult<import("./contract.ts").ProviderMutationResult>> {
      const parsed = confirmListingInput.safeParse(input);
      if (!parsed.success) return { ok: false, code: "invalid_request", message: parsed.error.issues[0]?.message ?? "Invalid publication confirmation" };
      const stored = await providerDraftStore.get(actor, parsed.data.draftId);
      if (!stored) return { ok: false, code: "draft_not_found", message: "The provider draft is not available for this account." };
      if (stored.operationId !== parsed.data.operationId) return { ok: false, code: "operation_mismatch", message: "The transaction does not match the prepared publication." };
      if (stored.state === "confirmed") {
        if (!stored.txHash || stored.blockNumber === null || stored.logIndex === null) {
          return { ok: false, code: "reconciliation_unavailable", message: "Publication was confirmed without complete stored proof." };
        }
        if (stored.txHash.toLowerCase() !== parsed.data.txHash.toLowerCase()) {
          return { ok: false, code: "operation_mismatch", message: "The transaction hash does not match the confirmed publication." };
        }
        return { ok: true, value: providerMutationResult.parse({ status: "published", nextAction: "wait_for_listing_checks", draftId: parsed.data.draftId, operationId: stored.operationId, reference: stored.reference, evidence: { txHash: stored.txHash, blockNumber: stored.blockNumber, logIndex: stored.logIndex } }) };
      }
      if (!service.confirmOperation) return { ok: false, code: "execution_not_ready", message: "Publication confirmation is not configured." };
      const result = await service.confirmOperation(actor, parsed.data.operationId, parsed.data.txHash as `0x${string}`);
      if (!result.ok) return { ok: false, code: result.error.code, message: result.error.message };
      if (!result.value.txHash || !result.value.proof) return { ok: false, code: "reconciliation_unavailable", message: "publication receipt was accepted without complete proof" };
      const evidence: ProviderPublicationEvidence = {
        txHash: result.value.txHash,
        blockNumber: result.value.proof.blockNumber,
        logIndex: result.value.proof.logIndex,
      };
      await providerDraftStore.markConfirmed(actor, parsed.data.draftId, result.value.resultReference ?? undefined, evidence);
      return { ok: true, value: providerMutationResult.parse({ status: "published", nextAction: "wait_for_listing_checks", draftId: parsed.data.draftId, operationId: result.value.operationId, reference: result.value.resultReference ?? undefined, evidence }) };
    },

    async getListingPublication(actor: string, draftId: string): Promise<McpResult<import("./contract.ts").ProviderMutationResult>> {
      const stored = await providerDraftStore.get(actor, draftId);
      if (!stored) return { ok: false, code: "draft_not_found", message: "The provider draft is not available for this account." };
      const nextAction = stored.state === "confirmed"
        ? "wait_for_listing_checks"
        : stored.state === "prepared"
          ? "review_and_sign_publication"
          : stored.state === "compiled"
            ? "approve_publication"
            : "run_listing_checks";
      const evidence = stored.txHash && stored.blockNumber !== null && stored.logIndex !== null
        ? { txHash: stored.txHash, blockNumber: stored.blockNumber, logIndex: stored.logIndex }
        : undefined;
      return { ok: true, value: providerMutationResult.parse({ status: stored.state === "confirmed" ? "published" : stored.state === "prepared" ? "prepared" : "needs_attention", nextAction, draftId, operationId: stored.operationId ?? undefined, reference: stored.reference ?? undefined, evidence }) };
    },

    async compileListing(actorOrInput: string | unknown, maybeInput?: unknown): Promise<McpResult<ReturnType<typeof compileProviderManifest> & { manifestUri?: string }>> {
      const actor = typeof actorOrInput === "string" && maybeInput !== undefined ? actorOrInput : null;
      const input = maybeInput === undefined ? actorOrInput : maybeInput;
      const parsed = compileListingInput.safeParse(input);
      if (!parsed.success) return { ok: false, code: "invalid_request", message: parsed.error.issues[0]?.message ?? "Invalid listing compilation request" };
      const stored = actor ? await providerDraftStore.get(actor, parsed.data.draftId) : null;
      const legacy = legacyDrafts.get(parsed.data.draftId);
      const draft = stored?.draft ?? legacy?.draft;
      if (!draft) return { ok: false, code: "draft_not_found", message: "Create or resume the provider draft before compiling it." };
      try {
        let identity: Parameters<typeof compileProviderManifest>[1] = { agentId: parsed.data.agentId };
        if (parsed.data.listingId) {
          if (!service.getProviderListingForVersion) return { ok: false, code: "version_lookup_unavailable", message: "The current listing version cannot be checked." };
          const current = await service.getProviderListingForVersion(parsed.data.listingId);
          if (!current.ok) return { ok: false, code: current.error.code, message: current.error.message };
          if (current.value.agentId !== parsed.data.agentId || current.value.providerSnapshot.toLowerCase() !== actor?.toLowerCase()) {
            return { ok: false, code: "version_owner_mismatch", message: "The publisher must own the existing listing and use its agent ID." };
          }
          if (!/^0x[0-9a-fA-F]{64}$/.test(current.value.serviceKey) || !/^[1-9]\d*$/.test(current.value.version)) {
            return { ok: false, code: "version_target_invalid", message: "The existing listing has an invalid service key or version." };
          }
          identity = { agentId: parsed.data.agentId, serviceKey: current.value.serviceKey as `0x${string}`, version: (BigInt(current.value.version) + 1n).toString() };
        }
        const compiled = compileProviderManifest(draft, identity);
        const target = parsed.data.listingId ? { kind: "version" as const, listingId: parsed.data.listingId } : { kind: "new" as const };
        const manifestUri = parsed.data.manifestUri ?? (actor && options.hostedManifestStore
          ? (await options.hostedManifestStore.put(actor, compiled.body, compiled.manifestHash)).uri
          : null);
        if (actor && stored) await providerDraftStore.saveCompilation(actor, parsed.data.draftId, compiled, manifestUri, target);
        if (legacy) { legacy.compiled = compiled; legacy.manifestUri = manifestUri; }
        return { ok: true, value: { ...compiled, ...(manifestUri ? { manifestUri } : {}) } };
      } catch (error) {
        return { ok: false, code: error instanceof HostedManifestError ? error.code : "manifest_invalid", message: error instanceof Error ? error.message : "Provider manifest is invalid" };
      }
    },
  };
}
