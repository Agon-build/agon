/// Some outside services take an input inside their address, such as
/// https://arc.blockrun.ai/api/v1/defillama/prices/{coins}. Calling the address with
/// the braces left in pays for an empty answer (job fe06bcbe on 2026-11-05), so these
/// names are required inputs, filled into the address before Agon quotes or pays.

const SLOT = /\{([A-Za-z_][A-Za-z0-9_-]{0,63})\}/g;

/// The input names an address carries in braces, in order, without repeats.
export function pathParams(url: string): string[] {
  return [...new Set([...url.matchAll(SLOT)].map((m) => m[1]!))];
}

/// The service's input schema with each address slot added as a required string field.
export function withPathParams(url: string, schema: Record<string, unknown> | null): Record<string, unknown> | null {
  const names = pathParams(url);
  if (names.length === 0) return schema;
  const base = schema && typeof schema === "object" ? schema : {};
  const props = base.properties && typeof base.properties === "object" && !Array.isArray(base.properties) ? (base.properties as Record<string, unknown>) : {};
  const required = Array.isArray(base.required) ? (base.required as unknown[]).filter((r): r is string => typeof r === "string") : [];
  const added = Object.fromEntries(names.map((n) => [n, props[n] ?? { type: "string", description: `${n}, part of the service address` }]));
  return { ...base, type: "object", properties: { ...props, ...added }, required: [...new Set([...required, ...names])] };
}

/// The address with each slot filled from the input (URL-encoded), and the input
/// without those names; or the names still missing.
export function fillPath(url: string, input: Record<string, unknown>): { ok: true; url: string; rest: Record<string, unknown> } | { ok: false; missing: string[] } {
  const names = pathParams(url);
  if (names.length === 0) return { ok: true, url, rest: input };
  const text = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
  const missing = names.filter((n) => !text(input[n]));
  if (missing.length > 0) return { ok: false, missing };
  const rest = { ...input };
  for (const n of names) delete rest[n];
  return { ok: true, url: url.replace(SLOT, (_m, n: string) => encodeURIComponent(text(input[n])).replace(/%2C/gi, ",").replace(/%3A/gi, ":")), rest };
}
