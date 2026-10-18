/// Text that people or outside channels see (notifications, alerts, Telegram,
/// email) must never carry an RPC key, a request body, calldata or a token.
/// Library errors (viem in particular) put all of these in their message, so
/// every such text passes through here before it is stored or shown.

/// Sections viem appends after the short message; everything from the first one on is dropped.
const DETAIL_SECTION = /\s*(Request body:|Request Arguments:|Raw Call Arguments:|Contract Call:|Docs:|Details:|Version: viem)/;

export function redactSensitive(text: string): string {
  let out = text;
  const cut = out.search(DETAIL_SECTION);
  if (cut >= 0) out = out.slice(0, cut);
  out = out
    // A URL keeps only its host: keys live in paths and query strings.
    .replace(/\b(https?:\/\/[^\s/"'?#]+)[^\s"']*/g, "$1")
    .replace(/\b(agon_o[ar]t_)[A-Za-z0-9_-]+/g, "$1[redacted]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [redacted]")
    .replace(/\b(sk|pk|swrm)_[A-Za-z0-9]{8,}/g, "[redacted]")
    // Calldata and signed transactions; addresses (40) and hashes (64) stay.
    .replace(/0x[0-9a-fA-F]{70,}/g, "0x…")
    .replace(/[ \t]*\n[ \t]*/g, " ")
    .replace(/ {2,}/g, " ")
    .trim();
  return out.length > 600 ? `${out.slice(0, 599)}…` : out;
}

/// The same, applied to every string inside a JSON-shaped value.
export function redactDeep<T>(value: T): T {
  if (typeof value === "string") return redactSensitive(value) as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, redactDeep(v)])) as T;
  }
  return value;
}
