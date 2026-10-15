import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import type { Address, Hex } from "viem";

import type { AgonNetwork } from "../network.ts";
import { LEAD_PROVIDER_REF, type LeadAnswer } from "../lead-agent/lead-agent.ts";
import { exactPayment, type ExactSettler, type X402Paid } from "./exact-seller.ts";
import { receiptTree } from "./jobs.ts";
import { LISTING_BODY_LIMIT_BYTES, answerListingCheck, createCertificationGate, type CertifyModelCaller } from "./listing-protocols.ts";
import type { PaymentsStore } from "./types.ts";

const leadBody = z.object({ question: z.string().trim().min(8).max(300) });

export function createPaymentRoutes(deps: {
  store: PaymentsStore;
  network: AgonNetwork;
  lead: { address: Address; price: bigint; settle: ExactSettler; run: (input: { parentJobId: string | null; payer: Address; question: string; payment?: { txHash: Hex; amount: bigint } }) => Promise<LeadAnswer> };
  off?: () => boolean;
  log?: (m: string) => void;
  /// The model that answers the listing certification call for the Lead.
  certify?: { model: string; callModel: CertifyModelCaller };
}): Hono {
  const app = new Hono<{ Variables: { x402: X402Paid } }>();

  const certifyGate = createCertificationGate();
  app.use("/agents/lead/forecast", bodyLimit({ maxSize: LISTING_BODY_LIMIT_BYTES, onError: (c) => c.json({ error: "body_too_large" }, 413) }));
  app.use("/agents/lead/forecast", async (c, next) => {
    if (deps.off?.()) return c.json({ error: "lead_agent_off" }, 503);
    const raw = await c.req.raw.clone().json().catch(() => null);
    const check = await answerListingCheck(c, raw, deps.certify ? { agent: { name: "Agon Lead Agent", capabilities: ["analysis"] }, ...deps.certify, gate: certifyGate } : null);
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
