import type { AuthInfo } from "@modelcontextprotocol/server";

import { canUseAgonScope } from "../../auth/scope-policy.ts";

export function result(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

export function failure(code: string, message: string) {
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: { code, message } }, null, 2) }], isError: true };
}

export function adapterResult(value: { ok: true; value: unknown } | { ok: false; code: string; message: string }) {
  return value.ok ? result(value.value) : failure(value.code, value.message);
}

export function actor(authInfo: AuthInfo | undefined): string | null {
  const address = authInfo?.extra?.address;
  return typeof address === "string" && address ? address : null;
}

export function requireActor(authInfo: AuthInfo | undefined, scope: string): string | ReturnType<typeof failure> {
  const problem = authInfo?.extra?.tokenProblem;
  if (problem === "expired" || problem === "revoked" || problem === "unknown") {
    return failure(`token_${problem}`, problem === "unknown"
      ? "This connection is not recognised. Reconnect Agon from your agent."
      : `This connection was ${problem}. Reconnect Agon from your agent.`);
  }
  const address = actor(authInfo);
  if (!address) return failure("authentication_required", "Connect Agon from your agent; it opens a sign-in page in your browser.");
  const client = authInfo?.extra?.client;
  const claims = {
    client: client === null ? null : typeof client === "string" ? client : "agon-cli",
    scopes: authInfo?.scopes ?? [],
  };
  return canUseAgonScope(claims, scope)
    ? address
    : failure("scope_required", `This connection needs the ${scope} capability. Reconnect Agon and choose a level that includes it.`);
}
