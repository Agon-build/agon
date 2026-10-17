import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createMcpTokenVerifier, type AccessTokenStore } from "../../src/agon/access-tokens.ts";
import { authorizeMcpRequest } from "../../src/agon/mcp-oauth/edge.ts";
import { TOOL_SCOPES } from "../../src/agon/mcp-oauth/tool-scopes.ts";
import { canUseAgonScope } from "../../src/auth/scope-policy.ts";

const META = "https://api.agon.surf/.well-known/oauth-protected-resource/agon/mcp";
const ALICE = `0x${"1".repeat(40)}`;
const READ = ["agon:read"];

function rpc(body: unknown, token?: string) {
  return new Request("https://api.agon.surf/agon/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
}
const call = (name: string, id = 1) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: {} } });
const verify = async (token: string) => (token === "agon_oat_read" ? { address: ALICE, client: "agon-mcp", scopes: READ } : token === "agon_oat_gone" ? { problem: "unknown" as const } : null);

test("no token gets 401 with resource_metadata and scope agon:read, including for tools/list", async () => {
  const out = await authorizeMcpRequest(rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }), { verify, resourceMetadataUrl: META });
  assert.ok(!out.ok);
  assert.equal(out.response.status, 401);
  assert.equal(out.response.headers.get("www-authenticate"), `Bearer resource_metadata="${META}", scope="agon:read"`);
});

test("a valid oauth token reaches tools; client is agon-mcp", async () => {
  const out = await authorizeMcpRequest(rpc(call("search_services"), "agon_oat_read"), { verify, resourceMetadataUrl: META });
  assert.ok(out.ok);
  assert.deepEqual(out.authInfo.extra, { address: ALICE, client: "agon-mcp" });
  assert.deepEqual(out.authInfo.scopes, READ);
});

test("a tools/call that needs wallet:execute on a read connection gets 403 insufficient_scope", async () => {
  const out = await authorizeMcpRequest(rpc(call("confirm_hire"), "agon_oat_read"), { verify, resourceMetadataUrl: META });
  assert.ok(!out.ok);
  assert.equal(out.response.status, 403);
  const header = out.response.headers.get("www-authenticate")!;
  assert.match(header, /error="insufficient_scope"/);
  assert.match(header, /scope="wallet:execute"/);
  assert.match(header, new RegExp(`resource_metadata="${META.replaceAll(".", "\.")}"`));
  const batch = await authorizeMcpRequest(rpc([call("search_services", 1), call("start_listing", 2), call("confirm_hire", 3)], "agon_oat_read"), { verify, resourceMetadataUrl: META });
  assert.ok(!batch.ok);
  assert.match(batch.response.headers.get("www-authenticate")!, /scope="listing:prepare wallet:execute"/);
});

test("an expired, revoked or unknown token gets 401 with error invalid_token", async () => {
  const out = await authorizeMcpRequest(rpc(call("search_services"), "agon_oat_gone"), { verify, resourceMetadataUrl: META });
  assert.ok(!out.ok);
  assert.equal(out.response.status, 401);
  assert.match(out.response.headers.get("www-authenticate")!, /error="invalid_token"/);
});

test("a personal token still works and oauth tokens use the oauth verifier", async () => {
  const store = { verify: async () => ({ ok: true as const, claims: { address: ALICE, client: "agon-cli" as const, scopes: READ } }) } as unknown as AccessTokenStore;
  const verifier = createMcpTokenVerifier(store, async () => null, () => new Date(), async (t) => (t === "agon_oat_x" ? { address: ALICE, client: "agon-mcp", scopes: READ } : null));
  assert.deepEqual(await verifier("agon_pat_abc"), { address: ALICE, client: "agon-cli", scopes: READ });
  assert.deepEqual(await verifier("agon_oat_x"), { address: ALICE, client: "agon-mcp", scopes: READ });
  assert.deepEqual(await verifier("agon_oat_bad"), { problem: "unknown" });
  assert.equal(canUseAgonScope({ client: "agon-mcp", scopes: READ }, "agon:read"), true);
  assert.equal(canUseAgonScope({ client: "agon-mcp", scopes: READ }, "wallet:execute"), false);
});

test("every tool that calls requireActor with a scope is listed in TOOL_SCOPES", () => {
  for (const file of ["native-server.ts", "stage-tools.ts"]) {
    const src = readFileSync(new URL(`../../src/agon/mcp/${file}`, import.meta.url), "utf8");
    for (const part of src.split('registerTool("').slice(1)) {
      const name = part.split('"')[0]!;
      const m = /requireActor\([^,]+,\s*"([a-z:]+)"\)|managed\("[a-z_]+",\s*\w+,\s*"([a-z:]+)"/.exec(part);
      const scope = m ? (m[1] ?? m[2]) : undefined;
      assert.equal(TOOL_SCOPES[name], scope, `${file} ${name}`);
    }
  }
});
