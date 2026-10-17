import type { AuthInfo } from "@modelcontextprotocol/server";

import type { McpTokenResult } from "../access-tokens.ts";
import { canUseAgonScope } from "../../auth/scope-policy.ts";
import { TOOL_SCOPES } from "./tool-scopes.ts";

function challenge(status: 401 | 403, header: string, error: string, message: string): Response {
  return new Response(JSON.stringify({ error, error_description: message }), {
    status,
    headers: { "content-type": "application/json", "www-authenticate": header },
  });
}

async function toolNames(request: Request): Promise<string[]> {
  if (request.method !== "POST") return [];
  const body = await request.clone().json().catch(() => null) as unknown;
  const calls = Array.isArray(body) ? body : [body];
  return calls
    .filter((m): m is { method: string; params?: { name?: unknown } } => Boolean(m) && typeof m === "object" && (m as { method?: unknown }).method === "tools/call")
    .map((m) => (typeof m.params?.name === "string" ? m.params.name : ""))
    .filter(Boolean);
}

/// Every MCP request needs a connection. No token starts sign-in (401);
/// a tool call beyond the connection's access asks the person to step up (403).
export async function authorizeMcpRequest(
  request: Request,
  deps: { verify: (token: string) => Promise<McpTokenResult>; resourceMetadataUrl: string },
): Promise<{ ok: true; authInfo: AuthInfo } | { ok: false; response: Response }> {
  const meta = `resource_metadata="${deps.resourceMetadataUrl}"`;
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) return { ok: false, response: challenge(401, `Bearer ${meta}, scope="agon:read"`, "invalid_token", "Connect Agon from your agent to continue.") };
  const verified = await deps.verify(token);
  if (!verified || "problem" in verified) {
    return { ok: false, response: challenge(401, `Bearer error="invalid_token", ${meta}, scope="agon:read"`, "invalid_token", "Sign in to Agon again from your agent.") };
  }
  const claims = { client: verified.client, scopes: verified.scopes };
  const missing = [...new Set((await toolNames(request)).map((name) => TOOL_SCOPES[name]).filter((s): s is string => Boolean(s) && !canUseAgonScope(claims, s!)))].sort();
  if (missing.length) {
    return { ok: false, response: challenge(403, `Bearer error="insufficient_scope", scope="${missing.join(" ")}", ${meta}, error_description="Reconnect Agon with more access"`, "insufficient_scope", `This needs ${missing.join(" and ")}. Reconnect Agon and choose a level that includes it.`) };
  }
  return {
    ok: true,
    authInfo: { token, clientId: verified.client ?? verified.address, scopes: verified.scopes, extra: { address: verified.address, client: verified.client } },
  };
}
