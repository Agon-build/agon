import { timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";

type AuthVariables = { Variables: { address: string } };

/// What the operator console's ADMIN_TOKEN may do on Agon routes. The token acts
/// only as the listed operator wallets (AGON_ADMIN_ACTORS), and each use is logged.
export type AgonAdminAccess = {
  token: string | undefined;
  actors: readonly string[];
  log?: (line: string) => void;
};

function secretMatches(received: string, expected: string): boolean {
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

const ADDRESS = /^0x[a-fA-F0-9]{40}$/;

/// Comma separated operator wallets; anything that is not an address is dropped.
export function adminActorsFromEnv(value: string | undefined): string[] {
  return (value ?? "").split(",").map((part) => part.trim()).filter((part) => ADDRESS.test(part)).map((part) => part.toLowerCase());
}

/// Lets the operator console use its in-memory ADMIN_TOKEN as one of the
/// operator wallets in AGON_ADMIN_ACTORS (audit B6, 2026-11-09: before this a
/// leaked token was every user's identity). A normal SIWE or bearer session
/// remains the fallback for everyone else.
export function createAgonAuthMiddleware(
  admin: AgonAdminAccess,
  fallback: MiddlewareHandler<AuthVariables>,
): MiddlewareHandler<AuthVariables> {
  const allowed = new Set(admin.actors.map((actor) => actor.toLowerCase()));
  const log = admin.log ?? ((line: string) => console.log(line));
  return async (context, next) => {
    const received = context.req.header("x-admin-token") ?? "";
    if (admin.token && received && secretMatches(received, admin.token)) {
      const actor = context.req.header("x-agon-actor") ?? "";
      if (!ADDRESS.test(actor)) {
        return context.json({ error: "valid x-agon-actor wallet address required" }, 400);
      }
      const address = actor.toLowerCase();
      if (!allowed.has(address)) {
        log(`[agon admin actor] refused ${address} ${context.req.method} ${new URL(context.req.url).pathname}`);
        return context.json({ error: "actor_not_allowed", message: "This wallet is not an Agon operator wallet." }, 403);
      }
      log(`[agon admin actor] ${address} ${context.req.method} ${new URL(context.req.url).pathname}`);
      context.set("address", address);
      await next();
      return;
    }
    return fallback(context, next);
  };
}
