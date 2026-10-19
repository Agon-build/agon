import { randomUUID } from "node:crypto";

import { agonNetwork, explorerTxUrl, type AgonNetworkId } from "../network.ts";
import { formatUsdc } from "./bargain.ts";
import type { Job, JobPayment } from "./types.ts";

export const MAX_DEPTH = 2;

export function newJob(input: {
  parent: Job | null;
  buyerRef: string;
  providerRef: string;
  providerLabel: string;
  network: AgonNetworkId;
  price: bigint;
  budget?: bigint;
  request: Record<string, unknown>;
  traceId?: string;
  now: Date;
  jobId?: string;
}): Job {
  const jobId = input.jobId ?? randomUUID();
  return {
    jobId,
    parentId: input.parent?.jobId ?? null,
    rootId: input.parent?.rootId ?? jobId,
    depth: input.parent ? input.parent.depth + 1 : 0,
    buyerRef: input.buyerRef,
    providerRef: input.providerRef,
    providerLabel: input.providerLabel,
    network: input.network,
    priceAtomic: input.price,
    budgetAtomic: input.budget ?? 0n,
    state: "quoted",
    traceId: input.traceId ?? input.parent?.traceId ?? randomUUID(),
    request: input.request,
    result: null,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

/// What a job has committed from its own budget: its data purchases plus each
/// child hire (the child's payment when one exists, otherwise its price while
/// the child is still live). Failed payments and failed unpaid children are free.
export function spentUnder(jobId: string, tree: Job[], payments: JobPayment[]): bigint {
  let total = 0n;
  for (const p of payments) if (p.jobId === jobId && p.kind === "data" && p.status !== "failed") total += p.amount;
  for (const child of tree.filter((j) => j.parentId === jobId)) {
    const hire = payments.filter((p) => p.jobId === child.jobId && p.kind === "hire");
    if (hire.length > 0) {
      for (const p of hire) if (p.status !== "failed") total += p.amount;
    } else if (child.state === "quoted" || child.state === "paying") {
      total += child.priceAtomic;
    }
  }
  return total;
}

export type HireCheck = { ok: true } | { ok: false; code: "parent_missing" | "depth_exceeded" | "self_hire" | "ancestor_hire" | "over_parent_budget" };

export function checkSubHire(input: { tree: Job[]; payments: JobPayment[]; parentJobId: string; hirerRef: string; providerRef: string; amount: bigint }): HireCheck {
  const byId = new Map(input.tree.map((j) => [j.jobId, j]));
  const parent = byId.get(input.parentJobId);
  if (!parent) return { ok: false, code: "parent_missing" };
  if (parent.depth + 1 > MAX_DEPTH) return { ok: false, code: "depth_exceeded" };
  if (input.providerRef === input.hirerRef) return { ok: false, code: "self_hire" };
  for (let j: Job | undefined = parent; j; j = j.parentId ? byId.get(j.parentId) : undefined) {
    if (j.providerRef === input.providerRef || j.buyerRef === input.providerRef) return { ok: false, code: "ancestor_hire" };
  }
  const remaining = parent.budgetAtomic - spentUnder(parent.jobId, input.tree, input.payments);
  if (input.amount > remaining) return { ok: false, code: "over_parent_budget" };
  return { ok: true };
}

export type ReceiptPayment = { kind: string; amount: string; payer: string; payee: string; status: string; txUrl: string | null; detail: string | null };
/// Where the hired service comes from: the Lead agent, an Agon listing or Circle's Agent Marketplace.
export type ReceiptSource = "lead" | "agon" | "circle";
export type ReceiptNode = { jobId: string; label: string; source: ReceiptSource; buyer: string; state: string; price: string; network: string; payments: ReceiptPayment[]; children: ReceiptNode[] };

// "agent:lead" is LEAD_PROVIDER_REF; Circle routes use "circle:<resource>" references.
export function receiptSource(providerRef: string): ReceiptSource {
  if (providerRef === "agent:lead") return "lead";
  return providerRef.startsWith("circle:") ? "circle" : "agon";
}

export function receiptTree(rootId: string, tree: Job[], payments: JobPayment[]): ReceiptNode | null {
  const root = tree.find((j) => j.jobId === rootId);
  if (!root) return null;
  const build = (job: Job): ReceiptNode => {
    const network = agonNetwork(job.network);
    return {
      jobId: job.jobId,
      label: job.providerLabel,
      source: receiptSource(job.providerRef),
      buyer: job.buyerRef.startsWith("budget:") ? "you" : job.buyerRef,
      state: job.state,
      price: formatUsdc(job.priceAtomic),
      network: network.label,
      payments: payments
        .filter((p) => p.jobId === job.jobId)
        .map((p) => ({
          kind: p.kind, amount: formatUsdc(p.amount), payer: p.payer, payee: p.payee, status: p.status,
          txUrl: p.txHash ? explorerTxUrl(agonNetwork(p.network), p.txHash) : null, detail: p.detail,
        })),
      children: tree.filter((j) => j.parentId === job.jobId).map(build),
    };
  };
  return build(root);
}
