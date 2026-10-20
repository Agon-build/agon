import { fromJsonSchema } from "@modelcontextprotocol/server";

/// The exact input shapes of the listing tools, written for MCP clients. Each
/// mirrors its strict zod check in contract.ts (mcp-listing-schemas.test.ts
/// keeps them in step) and says in plain words what goes in every field, so an
/// agent can fill a listing from the user's own project and ask only for gaps.

const draftId = { type: "string", minLength: 1, maxLength: 256, description: "The draftId returned by start_listing." };
const reference = { type: "string", minLength: 1, maxLength: 256, description: "The listing reference, chainId:registry:listingId, from get_listing_publication or the listing page." };
const operationId = { type: "string", minLength: 1, maxLength: 256, description: "The operationId returned when the transaction was prepared." };
const txHash = { type: "string", pattern: "^0x[0-9a-fA-F]{64}$", description: "The Arc transaction hash after the user's wallet signed and sent it." };
const approval = { type: "string", const: "approve", description: "Send exactly \"approve\", and only after the user has read the terms and said yes." };

export const LISTING_GUIDE =
  "Fill every field from the user's own agent: read its repository, README and running endpoint first, and ask the user only for what you cannot find. " +
  "The endpoint must be the agent's public https address and must answer an unpaid call with HTTP 402 offering the x402 exact scheme in USDC on Arc at priceUSDC. " +
  "Categories: 1 Research, 2 Market data, 3 Analysis, 4 Prediction, 5 Execution, 6 Content, 7 Development, 8 Verification, 9 General. " +
  "Today Agon can certify Analysis (3) automatically, so an Analysis listing can become Verified; other categories list as Listed. " +
  "This creates a draft only: nothing is signed, paid or published.";

export const startListingSchema = fromJsonSchema<Record<string, unknown>>({
  type: "object",
  properties: {
    name: { type: "string", minLength: 1, maxLength: 80, description: "The agent's public name, as buyers will see it, for example \"Kestrel\"." },
    logoUrl: { type: "string", pattern: "^https://", maxLength: 2048, description: "https link to a square logo (SVG or PNG) that loads publicly." },
    outcome: { type: "string", minLength: 1, maxLength: 500, description: "One or two sentences on what a buyer gets back from one call." },
    category: { type: "string", enum: ["1", "2", "3", "4", "5", "6", "7", "8", "9"], description: "Category id: 1 Research, 2 Market data, 3 Analysis, 4 Prediction, 5 Execution, 6 Content, 7 Development, 8 Verification, 9 General." },
    inputs: { type: "array", items: { type: "string", minLength: 1 }, maxItems: 64, description: "What the caller sends, one field per item, written as name: what it is, where name is the exact field your endpoint reads. Add (optional) at the end when it may be left out. For example [\"market: a Polymarket link, slug or condition id\", \"notes: short notes (optional)\"]." },
    outputs: { type: "array", items: { type: "string", minLength: 1 }, maxItems: 64, description: "A list of what comes back, one field or short phrase each, for example [\"probability\", \"reasons\"]." },
    priceUSDC: { type: "string", pattern: "^\\d+(?:\\.\\d{1,6})?$", description: "Price per call in USDC as a decimal string, for example \"0.22\". It must equal what the endpoint asks for." },
    expectedLatencyMs: { type: "integer", minimum: 1, maximum: 300000, description: "Typical time to answer, in whole milliseconds, for example 30000." },
    privacy: { type: "string", minLength: 1, maxLength: 8000, description: "What happens to the caller's input: what is stored, for how long, and whether it goes to third parties such as a model provider." },
    failurePolicy: { type: "string", minLength: 1, maxLength: 8000, description: "What the caller gets if the agent cannot answer, for example that the call fails and nothing is charged." },
    endpoint: { type: "string", pattern: "^https://", maxLength: 2048, description: "The agent's public https endpoint that answers unpaid calls with 402 and paid calls with the result." },
  },
  required: ["name", "logoUrl", "outcome", "category", "inputs", "outputs", "priceUSDC", "expectedLatencyMs", "privacy", "failurePolicy", "endpoint"],
  additionalProperties: false,
});

export const draftOnlySchema = fromJsonSchema<{ draftId: string }>({
  type: "object", properties: { draftId }, required: ["draftId"], additionalProperties: false,
});

export const compileListingSchema = fromJsonSchema<Record<string, unknown>>({
  type: "object",
  properties: {
    draftId,
    agentId: { type: "string", pattern: "^\\d+$", description: "The ERC-8004 agent id on Arc that this listing belongs to, as digits." },
    listingId: { type: "string", pattern: "^[1-9]\\d*$", description: "Only when publishing a new version of an existing listing: its listing id." },
    manifestUri: { type: "string", pattern: "^https://", maxLength: 2048, description: "Optional https address where the service record will be hosted; Agon hosts it when left out." },
  },
  required: ["draftId", "agentId"],
  additionalProperties: false,
});

export const publishSchema = fromJsonSchema<{ draftId: string; approval: "approve" }>({
  type: "object", properties: { draftId, approval }, required: ["draftId", "approval"], additionalProperties: false,
});

export const pauseSchema = fromJsonSchema<{ reference: string; approval: "approve" }>({
  type: "object", properties: { reference, approval }, required: ["reference", "approval"], additionalProperties: false,
});

export const confirmListingSchema = fromJsonSchema<{ draftId: string; operationId: string; txHash: string }>({
  type: "object", properties: { draftId, operationId, txHash }, required: ["draftId", "operationId", "txHash"], additionalProperties: false,
});

export const confirmPauseSchema = fromJsonSchema<{ reference: string; operationId: string; txHash: string }>({
  type: "object", properties: { reference, operationId, txHash }, required: ["reference", "operationId", "txHash"], additionalProperties: false,
});
