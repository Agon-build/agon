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

/// Wraps a Circle SDK client so every failed call rejects with circleErrorText
/// only. The SDK's own errors carry the request, including the API key header.
export function withCleanErrors<T extends object>(client: T): T {
  return new Proxy(client, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown;
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        try {
          const out = (value as (...a: unknown[]) => unknown).apply(target, args);
          return out instanceof Promise ? out.catch((error: unknown) => { throw new Error(circleErrorText(error)); }) : out;
        } catch (error) {
          throw new Error(circleErrorText(error));
        }
      };
    },
  });
}

export type CircleKeys = { apiKey?: string; entitySecret?: string; walletSetId?: string };

/// Circle keeps test and live apart: a TEST_API key is refused on mainnets, so
/// Arc mainnet (ARC) uses the live keys and Arc Testnet the test keys.
export function circleKeysFor(chain: "ARC" | "ARC-TESTNET", circle: CircleKeys & { live: CircleKeys }): CircleKeys {
  const keys = chain === "ARC" ? circle.live : circle;
  return { apiKey: keys.apiKey, entitySecret: keys.entitySecret, walletSetId: keys.walletSetId };
}
