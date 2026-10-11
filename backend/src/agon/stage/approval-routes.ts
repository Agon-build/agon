import { Hono, type MiddlewareHandler } from "hono";
import type { Address } from "viem";

import type { HireService } from "../payments/runtime.ts";
import { authorizeApprover, describeApproval, type ApprovalGateDeps } from "./approvals.ts";

export function createApprovalRoutes(deps: {
  gate: ApprovalGateDeps;
  hire: Pick<HireService, "completeApprovedHire" | "wallets">;
  requireAuth: MiddlewareHandler<{ Variables: { address: string } }>;
}): Hono {
  const app = new Hono<{ Variables: { address: string } }>();
  const gone = (code: "unknown" | "used" | "expired") => (code === "unknown" ? 404 : 410);

  app.get("/approvals/:token", async (c) => {
    c.header("Cache-Control", "no-store");
    const described = await describeApproval(deps.gate, c.req.param("token"));
    return described.ok ? c.json({ approval: described.view }) : c.json({ error: described.code }, gone(described.code));
  });

  app.post("/approvals/:token", deps.requireAuth, async (c) => {
    c.header("Cache-Control", "no-store");
    const token = c.req.param("token");
    const described = await describeApproval(deps.gate, token);
    if (!described.ok) return c.json({ error: described.code }, gone(described.code));
    const allowed = await authorizeApprover(deps.gate, described.walletRef, c.get("address") as Address);
    if (!allowed.ok) return c.json({ error: allowed.code }, 403);
    const action = described.view.action;
    if (action === "over_limit_hire") {
      const out = await deps.hire.completeApprovedHire({ token });
      if (!out.ok && (out.code === "used" || out.code === "expired")) return c.json({ error: out.code }, 410);
      return c.json(out.ok ? { action, ok: true, jobId: out.jobId } : { action, ok: false, code: out.code, ...(out.jobId ? { jobId: out.jobId } : {}) });
    }
    if (action === "withdraw") {
      const out = await deps.hire.wallets.completeWithdraw(token);
      if (!out.ok && (out.code === "used" || out.code === "expired")) return c.json({ error: out.code }, 410);
      return c.json(out.ok ? { action, ok: true, transferId: out.transferId } : { action, ok: false, code: out.code });
    }
    const out = await deps.hire.wallets.completeUnfreeze(token);
    if (!out.ok && (out.code === "used" || out.code === "expired")) return c.json({ error: out.code }, 410);
    return c.json(out.ok ? { action, ok: true } : { action, ok: false, code: out.code });
  });

  // Mounted as a plain sub-app; the session variable stays internal (Plan 2 ruling).
  return app as unknown as Hono;
}
