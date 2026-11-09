import assert from "node:assert/strict";
import test from "node:test";

import { SECURITY_HEADERS } from "./security-headers.mjs";

// Audit F1 (2026-11-09): the site sent no script-src at all.
test("the content security policy limits where scripts can load from", () => {
  const csp = SECURITY_HEADERS.find((h) => h.key === "Content-Security-Policy")!.value;
  const script = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src "));
  assert.ok(script, "a script-src directive is present");
  assert.match(script!, /'self'/);
  assert.doesNotMatch(script!, /\*|https:(\s|$)|'unsafe-eval'/, "no wildcard sources and no eval");
  for (const kept of ["frame-ancestors 'none'", "base-uri 'self'", "object-src 'none'"]) assert.ok(csp.includes(kept), kept);
});

test("the other baseline headers stay in place", () => {
  const keys = SECURITY_HEADERS.map((h) => h.key);
  for (const key of ["X-Frame-Options", "X-Content-Type-Options", "Referrer-Policy", "Permissions-Policy"]) assert.ok(keys.includes(key), key);
});
