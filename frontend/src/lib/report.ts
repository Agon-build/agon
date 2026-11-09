import { reportBody } from "./report-body";

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL ?? "http://localhost:8082";

export type ReportLevel = "info" | "warn" | "error";

/// Fire-and-forget activity and error report to the backend log. Never throws,
/// never blocks the user. The user sees a friendly message; the raw detail goes
/// here for the admin.
export function reportEvent(
  kind: string,
  opts: { level?: ReportLevel; message?: string; context?: unknown; address?: string } = {},
): void {
  try {
    void fetch(`${AUTH_URL}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reportBody(kind, opts)),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // logging must never break the app
  }
}

/// Logs the raw error detail to the admin events stream and console while
/// guaranteeing nothing leaks to the UI. Pair this with friendlyError() at
/// every catch site: friendlyError → UI, logRawError → admin/console.
/// The UI contract is "friendly messages only"; this helper makes that
/// pattern a one-liner.
export function logRawError(
  kind: string,
  e: unknown,
  ctx?: { address?: string; context?: unknown },
): void {
  const message = e instanceof Error ? e.message : String(e ?? "");
  if (typeof console !== "undefined") {
    // Surfaces in the browser console for developer-mode diagnostics.
    // eslint-disable-next-line no-console
    console.error(`[${kind}]`, e);
  }
  reportEvent(kind, {
    level: "error",
    message,
    address: ctx?.address,
    context: ctx?.context,
  });
}
