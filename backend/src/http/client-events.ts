import type pg from "pg";

import { createRateLimiter } from "../agon/stage/rate-limit.ts";

/// Events the browser reports (sign-ins, page errors) through POST /events.
/// Signed-out pages report too, so no session is required; instead each event is
/// small, each address and all callers together are limited, and old rows are
/// removed (audit B5, 2026-11-09).
export const CLIENT_EVENT_LIMITS = {
  perIpPerMinute: 30,
  globalPerMinute: 600,
  messageChars: 500,
  contextBytes: 2048,
  retentionDays: 30,
} as const;

export type ClientEvent = { level: "info" | "warn" | "error"; kind: string; message: string | undefined; context: unknown; address: string | undefined };

export function readClientEvent(body: unknown):
  | { ok: true; event: ClientEvent }
  | { ok: false; status: 400 | 413; error: "kind required" | "bad kind" | "too large" } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (typeof b.kind !== "string" || !b.kind) return { ok: false, status: 400, error: "kind required" };
  if (!/^[A-Za-z0-9_.:-]{1,64}$/.test(b.kind)) return { ok: false, status: 400, error: "bad kind" };
  const message = typeof b.message === "string" ? b.message : undefined;
  if (message !== undefined && message.length > CLIENT_EVENT_LIMITS.messageChars) return { ok: false, status: 413, error: "too large" };
  const context = b.context ?? undefined;
  if (context !== undefined && Buffer.byteLength(JSON.stringify(context) ?? "", "utf8") > CLIENT_EVENT_LIMITS.contextBytes) {
    return { ok: false, status: 413, error: "too large" };
  }
  const level = b.level === "error" || b.level === "warn" ? b.level : "info";
  const address = typeof b.address === "string" && /^0x[0-9a-fA-F]{40}$/.test(b.address) ? b.address : undefined;
  return { ok: true, event: { level, kind: b.kind, message, context, address } };
}

/// True when this caller may record one more event now.
export function createClientEventGate(): (ip: string, nowMs?: number) => boolean {
  const perIp = createRateLimiter({ limit: CLIENT_EVENT_LIMITS.perIpPerMinute, windowMs: 60_000 });
  const all = createRateLimiter({ limit: CLIENT_EVENT_LIMITS.globalPerMinute, windowMs: 60_000 });
  return (ip, nowMs = Date.now()) => perIp(ip, nowMs) && all("all", nowMs);
}

/// Removes browser events older than the retention window; returns how many.
export async function pruneClientEvents(db: Pick<pg.Pool, "query">, now: Date): Promise<number> {
  const before = new Date(now.getTime() - CLIENT_EVENT_LIMITS.retentionDays * 86_400_000);
  const { rowCount } = await db.query("delete from events where source = 'web' and created_at < $1", [before]);
  return rowCount ?? 0;
}
