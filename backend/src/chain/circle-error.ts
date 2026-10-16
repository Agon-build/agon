/// A readable reason from a failed Circle API call: Circle's own code and message
/// when it sent them, otherwise the error's message. Never echoes request headers.
export function circleErrorText(error: unknown): string {
  const response = (error as { response?: { status?: unknown; data?: unknown } } | null)?.response;
  if (response && typeof response.status === "number") {
    const data = (response.data ?? {}) as { code?: unknown; message?: unknown };
    const code = typeof data.code === "number" || typeof data.code === "string" ? `, code ${data.code}` : "";
    const message = typeof data.message === "string" && data.message ? `: ${data.message.slice(0, 300)}` : "";
    return `Circle rejected the request (HTTP ${response.status}${code})${message}`;
  }
  return error instanceof Error ? error.message : String(error);
}
