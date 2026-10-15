import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import type { Address, Hex } from "viem";

import type { AgonNetwork } from "../network.ts";
import { LEAD_PROVIDER_REF, type LeadAnswer } from "../lead-agent/lead-agent.ts";
import { exactPayment, type ExactSettler, type X402Paid } from "./exact-seller.ts";
import { formatUsdc } from "./bargain.ts";
import { receiptTree } from "./jobs.ts";
import { triageEvidence } from "../lead-agent/evidence-triage.ts";
import { LISTING_BODY_LIMIT_BYTES, answerListingCheck } from "./listing-protocols.ts";
import type { PaymentsStore } from "./types.ts";

const leadBody = z.object({ question: z.string().trim().min(8).max(300) });

export function createPaymentRoutes(deps: {
  store: PaymentsStore;
  network: AgonNetwork;
  lead: { address: Address; price: bigint; settle: ExactSettler; run: (input: { parentJobId: string | null; payer: Address; question: string; payment?: { txHash: Hex; amount: bigint } }) => Promise<LeadAnswer> };
  off?: () => boolean;
  log?: (m: string) => void;
  /// Agon's own agents whose delivered jobs are shown on their cards.
  activity?: { agentId: string; providerRef: string }[];
}): Hono {
  const app = new Hono<{ Variables: { x402: X402Paid } }>();

  // Public and read on every Agents page load, so the totals are kept for a minute.
  let activityCache: { at: number; body: { network: string; agents: Record<string, { jobsCompleted: number; earnedUSDC: string }> } } | null = null;
  app.get("/agents/activity", async (c) => {
    const nowMs = Date.now();
    if (!activityCache || nowMs - activityCache.at > 60_000) {
      const agents = deps.activity ?? [];
      const stats = await deps.store.deliveredJobStats(deps.network.id, agents.map((a) => a.providerRef));
      const out: Record<string, { jobsCompleted: number; earnedUSDC: string }> = {};
      for (const a of agents) {
        const s = stats[a.providerRef];
        if (s) out[a.agentId] = { jobsCompleted: s.jobs, earnedUSDC: formatUsdc(s.earnedAtomic) };
      }
      activityCache = { at: nowMs, body: { network: deps.network.id, agents: out } };
    }
    c.header("cache-control", "public, max-age=60");
    return c.json(activityCache.body);
  });

  app.use("/agents/lead/forecast", bodyLimit({ maxSize: LISTING_BODY_LIMIT_BYTES, onError: (c) => c.json({ error: "body_too_large" }, 413) }));
  app.use("/agents/lead/forecast", async (c, next) => {
    if (deps.off?.()) return c.json({ error: "lead_agent_off" }, 503);
    const raw = await c.req.raw.clone().json().catch(() => null);
    const check = await answerListingCheck(c, raw, { agent: { name: "Agon Lead Agent", capabilities: ["analysis"] }, answer: (task) => triageEvidence(task.evidence) });
    if (check === "preflight") return next();
    if (check) return check;
    const body = leadBody.safeParse(raw);
    if (!body.success) return c.json({ error: "invalid_question" }, 400);
    return next();
  });

  app.post(
    "/agents/lead/forecast",
    exactPayment({
      network: deps.network, payTo: deps.lead.address, price: async () => deps.lead.price, settle: deps.lead.settle,
      claimNonce: (n, payer, nonce) => deps.store.claimSellerNonce(n, payer, nonce), description: "Agon Lead Agent forecast",
    }),
    async (c) => {
      const { question } = leadBody.parse(await c.req.json());
      const header = c.req.header("x-agon-job");
      const parent = header ? await deps.store.getJob(header) : null;
      const paid = c.get("x402");
      // A run may join an existing job only when the payer is that job's own budget wallet;
      // otherwise anyone who saw the job id could share its budget and take its refund.
      const parentPayment = parent && parent.providerRef === LEAD_PROVIDER_REF && parent.state === "paying"
        ? (await deps.store.listJobPayments(parent.rootId)).find((p) => p.idempotencyKey === `hire:${parent.jobId}`)
        : undefined;
      const parentJobId = parentPayment && parentPayment.payer.toLowerCase() === paid.payer.toLowerCase() ? parent!.jobId : null;
      try {
        return c.json(await deps.lead.run({ parentJobId, payer: paid.payer, question, payment: { txHash: paid.txHash, amount: paid.amount } }));
      } catch (error) {
        deps.log?.(`lead agent failed after payment: ${(error as Error).message}`);
        return c.json({ error: "lead_agent_failed" }, 500);
      }
    },
  );

  app.get("/jobs/:jobId", async (c) => {
    const job = await deps.store.getJob(c.req.param("jobId"));
    if (!job) return c.json({ error: "job_not_found" }, 404);
    const [tree, payments] = await Promise.all([deps.store.listJobTree(job.rootId), deps.store.listJobPayments(job.rootId)]);
    return c.json({ receipt: receiptTree(job.rootId, tree, payments) });
  });

  // Mounted as a plain sub-app; the x402 variable stays internal to these routes.
  return app as unknown as Hono;
}
