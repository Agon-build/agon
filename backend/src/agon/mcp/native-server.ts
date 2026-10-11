import { McpServer, createMcpHandler, fromJsonSchema, type AuthInfo } from "@modelcontextprotocol/server";

import { createMcpAccessAdapter } from "./adapter.ts";
import type { ManagedPublisher } from "./managed-publisher.ts";
import { registerStageTools, type StageMcpDeps } from "./stage-tools.ts";
import { adapterResult, failure, requireActor, result } from "./tool-results.ts";

type AccessAdapter = ReturnType<typeof createMcpAccessAdapter>;

const openObject = fromJsonSchema<Record<string, unknown>>({
  type: "object",
  additionalProperties: true,
});

const searchSchema = fromJsonSchema<Record<string, unknown>>({
  type: "object",
  properties: {
    query: { type: "string", description: "The outcome, skill, or service name to find." },
    category: { type: "string" },
    verifiedOnly: { type: "boolean" },
    maxPriceUSDC: { type: "string" },
    maxLatencyMs: { type: "number" },
    limit: { type: "number" },
  },
  additionalProperties: false,
});

const referenceSchema = fromJsonSchema<{ reference: string }>({
  type: "object",
  properties: { reference: { type: "string", minLength: 1 } },
  required: ["reference"],
  additionalProperties: false,
});

const hirePreviewSchema = fromJsonSchema<{ serviceReference: string; input: Record<string, unknown>; paymentMode?: "per_call" | "escrow" }>({
  type: "object",
  properties: {
    serviceReference: { type: "string", minLength: 1 },
    input: { type: "object", additionalProperties: true },
    paymentMode: { type: "string", enum: ["per_call", "escrow"], description: "Only per_call is currently available. Escrow requests return a capability error." },
  },
  required: ["serviceReference", "input"],
  additionalProperties: false,
});

const hireAuthorizationSchema = fromJsonSchema<{ hireId: string; termsDigest: string; approval: "approve"; idempotencyKey: string }>({
  type: "object",
  properties: {
    hireId: { type: "string", minLength: 1 },
    termsDigest: { type: "string", minLength: 1 },
    approval: { type: "string", const: "approve" },
    idempotencyKey: { type: "string", minLength: 1 },
  },
  required: ["hireId", "termsDigest", "approval", "idempotencyKey"],
  additionalProperties: false,
});

const hireStatusSchema = fromJsonSchema<{ hireId: string }>({
  type: "object",
  properties: { hireId: { type: "string", minLength: 1 } },
  required: ["hireId"],
  additionalProperties: false,
});

/**
 * Standards-based MCP tool surface. Public discovery remains available without
 * an account. Every provider or buyer mutation receives the authenticated AGON
 * wallet address from the validated bearer token at the HTTP edge.
 */
export function createAgonNativeMcpHandler(access: AccessAdapter, publisher?: ManagedPublisher, stage?: StageMcpDeps) {
  return createMcpHandler((context) => {
    const server = new McpServer({ name: "AGON", version: "1.0.0" });

    server.registerTool("search_services", {
      title: "Search AGON services",
      description: "Find pay-per-use agent services by result, skill, category, price, latency, or verification state.",
      inputSchema: searchSchema,
    }, async (input) => adapterResult(await access.searchServices(input)));

    server.registerTool("get_service", {
      title: "Get service terms",
      description: "Read the buyer-facing terms for one exact AGON service reference.",
      inputSchema: referenceSchema,
    }, async ({ reference }) => adapterResult(await access.getService(reference)));

    server.registerTool("preview_hire", {
      title: "Preview a hire",
      description: "Bind an exact service, input, price, and delivery terms before approval. This does not charge a wallet.",
      inputSchema: hirePreviewSchema,
    }, async (input) => {
      const authenticatedActor = requireActor(context.authInfo, "agon:read");
      return typeof authenticatedActor === "string"
        ? adapterResult(await access.previewHire(authenticatedActor, input))
        : authenticatedActor;
    });

    server.registerTool("authorize_hire", {
      title: "Approve a reviewed hire",
      description: "Advance a previously previewed hire only after the user confirms its exact terms digest. Wallet execution remains subject to the configured AGON policy.",
      inputSchema: hireAuthorizationSchema,
    }, async ({ hireId, ...input }) => {
      const authenticatedActor = requireActor(context.authInfo, "wallet:execute");
      return typeof authenticatedActor === "string"
        ? adapterResult(await access.authorizeHire(authenticatedActor, hireId, input))
        : authenticatedActor;
    });

    server.registerTool("get_hire_status", {
      title: "Get hire status",
      description: "Read payment, delivery, and reconciliation status for a previously previewed AGON hire.",
      inputSchema: hireStatusSchema,
    }, async ({ hireId }) => {
      const authenticatedActor = requireActor(context.authInfo, "agon:read");
      return typeof authenticatedActor === "string"
        ? adapterResult(await access.getWork(authenticatedActor, hireId))
        : authenticatedActor;
    });

    server.registerTool("start_listing", {
      title: "Start a service listing",
      description: "Create a provider listing draft from buyer-facing service terms. This never publishes or signs anything.",
      inputSchema: openObject,
    }, async (input) => {
      const authenticatedActor = requireActor(context.authInfo, "listing:prepare");
      return typeof authenticatedActor === "string"
        ? adapterResult(await access.startListing(authenticatedActor, input))
        : authenticatedActor;
    });

    server.registerTool("check_listing", {
      title: "Check a service listing",
      description: "Run provider draft checks and identify the next safe action before a publication request is prepared.",
      inputSchema: openObject,
    }, async (input) => {
      const authenticatedActor = requireActor(context.authInfo, "listing:prepare");
      return typeof authenticatedActor === "string"
        ? adapterResult(await access.checkListing(authenticatedActor, input))
        : authenticatedActor;
    });

    server.registerTool("compile_listing", {
      title: "Compile a checked listing",
      description: "Create the immutable service record from a checked draft. This does not publish or sign anything.",
      inputSchema: openObject,
    }, async (input) => {
      const authenticatedActor = requireActor(context.authInfo, "listing:prepare");
      return typeof authenticatedActor === "string"
        ? adapterResult(await access.compileListing(authenticatedActor, input))
        : authenticatedActor;
    });

    server.registerTool("prepare_listing_publication", {
      title: "Prepare listing publication",
      description: "Prepare the exact provider wallet action needed to publish a compiled listing. The provider must review and sign it separately.",
      inputSchema: openObject,
    }, async (input) => {
      const authenticatedActor = requireActor(context.authInfo, "listing:write");
      return typeof authenticatedActor === "string"
        ? adapterResult(await access.publishListing(authenticatedActor, input))
        : authenticatedActor;
    });

    server.registerTool("prepare_listing_version", {
      title: "Prepare a listing version",
      description: "Prepare publication for a checked draft that updates an existing service. The provider must review and sign it separately.",
      inputSchema: openObject,
    }, async (input) => {
      const authenticatedActor = requireActor(context.authInfo, "listing:write");
      return typeof authenticatedActor === "string"
        ? adapterResult(await access.publishListingVersion(authenticatedActor, input))
        : authenticatedActor;
    });

    server.registerTool("pause_listing", {
      title: "Prepare a listing pause",
      description: "Prepare the provider wallet action to pause an existing service listing.",
      inputSchema: openObject,
    }, async (input) => {
      const authenticatedActor = requireActor(context.authInfo, "listing:write");
      return typeof authenticatedActor === "string"
        ? adapterResult(await access.pauseListing(authenticatedActor, input))
        : authenticatedActor;
    });

    server.registerTool("confirm_listing", {
      title: "Confirm a signed listing action",
      description: "Verify the transaction receipt for a provider-approved listing or version. Supply a transaction hash only after the wallet has signed and broadcast it.",
      inputSchema: openObject,
    }, async (input) => {
      const authenticatedActor = requireActor(context.authInfo, "listing:confirm");
      return typeof authenticatedActor === "string"
        ? adapterResult(await access.confirmListing(authenticatedActor, input))
        : authenticatedActor;
    });

    server.registerTool("confirm_pause", {
      title: "Confirm a signed listing pause",
      description: "Verify the exact prepared pause transaction and its onchain receipt after the provider wallet signs and broadcasts it.",
      inputSchema: openObject,
    }, async (input) => {
      const authenticatedActor = requireActor(context.authInfo, "listing:confirm");
      return typeof authenticatedActor === "string"
        ? adapterResult(await access.confirmPause(authenticatedActor, input))
        : authenticatedActor;
    });

    server.registerTool("get_listing_publication", {
      title: "Get listing publication status",
      description: "Read the current preparation or confirmation state for a provider listing draft.",
      inputSchema: fromJsonSchema<{ draftId: string }>({
        type: "object",
        properties: { draftId: { type: "string", minLength: 1 } },
        required: ["draftId"],
        additionalProperties: false,
      }),
    }, async ({ draftId }) => {
      const authenticatedActor = requireActor(context.authInfo, "agon:read");
      return typeof authenticatedActor === "string"
        ? adapterResult(await access.getListingPublication(authenticatedActor, draftId))
        : authenticatedActor;
    });

    if (publisher) {
      const draftSchema = fromJsonSchema<{ draftId: string }>({
        type: "object", properties: { draftId: { type: "string", minLength: 1, maxLength: 256 } },
        required: ["draftId"], additionalProperties: false,
      });
      const managed = async (scope: string, task: (owner: string) => Promise<unknown>) => {
        const owner = requireActor(context.authInfo, scope);
        if (typeof owner !== "string") return owner;
        try { return result(await task(owner)); }
        catch (error) {
          const message = error instanceof Error ? error.message : "";
          const safe = /^(?:No managed publisher|Create a listing draft|draft changed|Publisher |The exact draft digest|Provision the publisher|Gas quote|Pinned gas quote|Circle transaction does not match|Identity receipt|Registered identity|Prepared publication|Publication target|Publication receipt|Hosted manifest|Managed draft digest|Publisher state changed)/.test(message);
          return failure("managed_publisher_failed", safe ? message : "Managed publisher action failed. Check its status before retrying.");
        }
      };
      server.registerTool("setup_managed_publisher", {
        title: "Get a publisher wallet to fund",
        description: "Provision one Circle-custodied Arc Testnet wallet for an existing listing draft. This does not sign or publish. Fund its address with native USDC for gas.",
        inputSchema: draftSchema,
      }, async ({ draftId }) => managed("listing:prepare", (owner) => publisher.setup(owner, draftId)));
      server.registerTool("get_managed_listing", {
        title: "Get managed listing status",
        description: "Read the publisher wallet, funding, identity, and listing progress after a restart.",
        inputSchema: draftSchema,
      }, async ({ draftId }) => managed("agon:read", (owner) => publisher.status(owner, draftId)));
      server.registerTool("approve_managed_listing", {
        title: "Approve managed identity and publication",
        description: "After the user reviews the exact listing digest and AGON custody, approve this draft's identity registration and publication. Funding alone is not approval.",
        inputSchema: fromJsonSchema<{ draftId: string; termsDigest: string; approval: "approve" }>({
          type: "object",
          properties: {
            draftId: { type: "string", minLength: 1, maxLength: 256 },
            termsDigest: { type: "string", pattern: "^0x[0-9a-fA-F]{64}$" },
            approval: { type: "string", const: "approve" },
          },
          required: ["draftId", "termsDigest", "approval"], additionalProperties: false,
        }),
      }, async ({ draftId, termsDigest, approval }) => managed("listing:write", (owner) => publisher.approve(owner, draftId, termsDigest, approval)));
      server.registerTool("continue_managed_listing", {
        title: "Continue managed listing",
        description: "After explicit approval, advance ERC-8004 registration, hosted identity file, publication, and receipt reconciliation. Retry this tool while pending; idempotency prevents duplicate writes.",
        inputSchema: draftSchema,
      }, async ({ draftId }) => managed("listing:write", (owner) => publisher.advance(owner, draftId)));
    }

    if (stage) registerStageTools(server, () => context.authInfo, stage);
    return server;
  }, { responseMode: "json" });
}
