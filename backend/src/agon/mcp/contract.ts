import { z } from "zod";

import { inputProblems } from "./listing-inputs.ts";

const id = z.string().trim().min(1).max(256);
const nonEmpty = z.string().trim().min(1).max(8_000);
const amount = z.string().regex(/^\d+(?:\.\d{1,6})?$/, "amount must be a decimal string");

export const mcpCapability = z.enum([
  "discover",
  "inspect",
  "preview",
  "hire",
  "escrow",
  "work",
  "result",
  "list",
  "publish",
  "pause",
]);

export const serviceSearchInput = z.object({
  query: nonEmpty.optional(),
  category: id.optional(),
  maxPriceUSDC: amount.optional(),
  privacy: z.enum(["none", "declared", "provider-retained"]).optional(),
  maxLatencyMs: z.number().int().positive().max(300_000).optional(),
  verifiedOnly: z.boolean().default(false),
  limit: z.number().int().positive().max(50).default(10),
}).strict();

export const serviceReference = z.object({
  reference: id,
  source: z.object({ id, name: nonEmpty }).strict(),
  name: nonEmpty,
  logoUrl: z.string().url().startsWith("https://").nullable(),
  provider: nonEmpty,
  outcome: nonEmpty,
  category: id,
  priceUSDC: amount,
  expectedLatencyMs: z.number().int().positive().max(300_000),
  availability: z.enum(["ready", "busy", "paused", "needs_review"]),
  verification: z.enum(["verified", "listed", "unverified", "quarantined", "unavailable"]),
  privacy: nonEmpty,
  accepts: z.array(nonEmpty).max(32),
  returns: z.array(nonEmpty).max(32),
}).strict();

export const serviceTerms = z.object({
  service: serviceReference,
  input: z.record(z.unknown()),
  priceUSDC: amount,
  paymentMode: z.enum(["per_call", "escrow"]),
  expiresAt: z.string().datetime({ offset: true }),
  deliveryDeadlineMs: z.number().int().positive().max(86_400_000),
  privacy: nonEmpty,
  failurePolicy: nonEmpty,
  termsDigest: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
}).strict();

export const previewHireInput = z.object({
  serviceReference: id,
  input: z.record(z.unknown()),
  paymentMode: z.enum(["per_call", "escrow"]).default("per_call"),
}).strict();

export const authorizeHireInput = z.object({
  termsDigest: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  approval: z.literal("approve"),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/),
}).strict();

export const hireResult = z.object({
  status: z.enum(["awaiting_approval", "preparing", "paid", "working", "delivered", "reconciling", "complete", "needs_attention"]),
  nextAction: nonEmpty,
  hireId: id,
  terms: serviceTerms.optional(),
  result: z.unknown().optional(),
  paymentEvidence: z.record(z.unknown()).optional(),
  deliveryEvidence: z.record(z.unknown()).optional(),
  reconciliationEvidence: z.record(z.unknown()).optional(),
}).strict();

export const providerDraftInput = z.object({
  name: z.string().trim().min(1).max(80),
  logoUrl: z.string().url().startsWith("https://"),
  outcome: z.string().trim().min(1).max(500),
  category: id,
  inputs: z.array(nonEmpty).max(64).superRefine((lines, ctx) => {
    for (const message of inputProblems(lines)) ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  }),
  outputs: z.array(nonEmpty).max(64),
  priceUSDC: amount,
  expectedLatencyMs: z.number().int().positive().max(300_000),
  privacy: nonEmpty,
  failurePolicy: nonEmpty,
  endpoint: z.string().url().startsWith("https://"),
}).strict();

export const publishListingInput = z.object({
  draftId: id,
  approval: z.literal("approve"),
}).strict();

export const publishListingVersionInput = z.object({
  draftId: id,
  approval: z.literal("approve"),
}).strict();

export const pauseListingInput = z.object({
  reference: id,
  approval: z.literal("approve"),
}).strict();

export const confirmListingInput = z.object({
  draftId: id,
  operationId: id,
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
}).strict();

export const confirmPauseInput = z.object({
  reference: id,
  operationId: id,
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
}).strict();

export const compileListingInput = z.object({
  draftId: id,
  agentId: z.string().regex(/^\d+$/),
  listingId: z.string().regex(/^[1-9]\d*$/).optional(),
  manifestUri: z.string().url().startsWith("https://").max(2048).optional(),
}).strict();

export const providerMutationResult = z.object({
  status: z.enum(["prepared", "published", "paused", "needs_attention"]),
  nextAction: nonEmpty,
  draftId: id.optional(),
  reference: id.optional(),
  operationId: id.optional(),
  transaction: z.object({
    chainId: z.string().regex(/^\d+$/),
    to: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    data: z.string().regex(/^0x[0-9a-fA-F]+$/),
    functionName: z.enum(["publish", "publishVersion", "setStatus"]),
    args: z.array(z.string()),
  }).strict().optional(),
  evidence: z.object({
    txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
    blockNumber: z.string().regex(/^\d+$/),
    logIndex: z.number().int().nonnegative(),
  }).strict().optional(),
}).strict();

export const mcpOperation = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("search_services"), input: serviceSearchInput }),
  z.object({ kind: z.literal("get_service"), reference: id }),
  z.object({ kind: z.literal("preview_hire"), input: previewHireInput }),
  z.object({ kind: z.literal("authorize_hire"), hireId: id, input: authorizeHireInput }),
  z.object({ kind: z.literal("get_work"), hireId: id }),
  z.object({ kind: z.literal("retry_or_report_work"), hireId: id, action: z.enum(["retry_delivery", "report_problem"]) }),
  z.object({ kind: z.literal("start_listing"), input: providerDraftInput }),
  z.object({ kind: z.literal("check_listing"), draftId: id }),
  z.object({ kind: z.literal("publish_listing"), input: publishListingInput }),
  z.object({ kind: z.literal("publish_listing_version"), input: publishListingVersionInput }),
  z.object({ kind: z.literal("pause_listing"), input: pauseListingInput }),
  z.object({ kind: z.literal("confirm_listing"), input: confirmListingInput }),
  z.object({ kind: z.literal("confirm_pause"), input: confirmPauseInput }),
  z.object({ kind: z.literal("compile_listing"), input: compileListingInput }),
]);

export type McpOperation = z.infer<typeof mcpOperation>;
export type ServiceSearchInput = z.infer<typeof serviceSearchInput>;
export type ServiceReference = z.infer<typeof serviceReference>;
export type ServiceTerms = z.infer<typeof serviceTerms>;
export type HireResult = z.infer<typeof hireResult>;
export type ProviderDraftInput = z.infer<typeof providerDraftInput>;
export type ProviderMutationResult = z.infer<typeof providerMutationResult>;
export type CompileListingInput = z.infer<typeof compileListingInput>;
