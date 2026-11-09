/// The body of a browser event, trimmed to what POST /events accepts
/// (500 characters of message, 2 KB of context).
export const REPORT_LIMITS = { messageChars: 500, contextBytes: 2000 } as const;

export type ReportOptions = { level?: "info" | "warn" | "error"; message?: string; context?: unknown; address?: string };

export function reportBody(kind: string, opts: ReportOptions) {
  const message = typeof opts.message === "string" ? opts.message.slice(0, REPORT_LIMITS.messageChars) : undefined;
  let context = opts.context;
  if (context !== undefined) {
    const size = new TextEncoder().encode(JSON.stringify(context) ?? "").length;
    if (size > REPORT_LIMITS.contextBytes) context = { truncated: true };
  }
  return { kind: kind.slice(0, 64), level: opts.level, message, context, address: opts.address };
}
