/// Whether what an outside service sent back for a paid call is an answer at all.
/// Agon cannot judge whether an outside answer is right; it can tell that there is none.
/// Null means the answer stands. Otherwise the plain reason it does not.
export function answerProblem(data: unknown): "empty answer" | "error in place of an answer" | null {
  if (data === null || data === undefined) return "empty answer";
  if (typeof data === "string") return data.trim() === "" ? "empty answer" : null;
  if (typeof data !== "object") return null;
  if (Array.isArray(data)) return data.length === 0 ? "empty answer" : null;
  const r = data as Record<string, unknown>;
  const keys = Object.keys(r);
  if (keys.length === 0) return "empty answer";
  // A text or file answer as the buyer keeps it (exact-buyer readAnswer).
  if (typeof r.contentType === "string" && typeof r.text === "string" && keys.length === 2) return r.text.trim() === "" ? "empty answer" : null;
  if (typeof r.contentType === "string" && typeof r.bytes === "number" && keys.length === 2) return r.bytes > 0 ? null : "empty answer";
  // Every field is null, an empty text, an empty list or an empty object: nothing was sent.
  const blank = (v: unknown): boolean =>
    v === null || v === undefined || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0)
    || (typeof v === "object" && v !== null && !Array.isArray(v) && Object.keys(v).length === 0);
  if (keys.every((k) => blank(r[k]))) return "empty answer";
  // A 200 that carries only an error: {"error": "..."} with nothing but its message, code or status beside it.
  const said = (v: unknown) => (typeof v === "string" && v.trim() !== "") || (typeof v === "object" && v !== null && Object.keys(v).length > 0);
  const ERROR_ONLY = new Set(["error", "errors", "message", "detail", "details", "code", "status", "statuscode", "success", "ok"]);
  if (said(r.error) && keys.every((k) => ERROR_ONLY.has(k.toLowerCase())) && r.success !== true && r.ok !== true) return "error in place of an answer";
  return null;
}

/// Outside services are the ones Agon routes to and cannot refund or test.
export const isOutsideRef = (providerRef: string): boolean => providerRef.startsWith("circle:");
