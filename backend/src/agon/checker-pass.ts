import { randomBytes, timingSafeEqual } from "node:crypto";

/// Agon's own checkers (certification, scheduled Agon checks, Playground runs) call
/// Agon's own endpoints through the public proxy, so the endpoints see a forwarded
/// address and would rate-limit Agon like an outside caller. That turned every
/// check after the sixth in an hour into a 429 and a failed check (seen 2026-11-06).
///
/// The fix is a pass made fresh in memory when the process starts. It is never
/// stored, logged or configured, and it is only ever sent to Agon's own origins,
/// so an outside provider never receives it.

export const CHECKER_HEADER = "x-agon-checker";

export type CheckerPass = {
  /// A fetch that adds the pass when, and only when, the request goes to one of Agon's own origins.
  wrap(base: typeof fetch): typeof fetch;
  /// True when a request carries this process's pass.
  accepts(value: string | null | undefined): boolean;
};

const originOf = (value: string): string | null => {
  try {
    const u = new URL(value);
    return u.protocol === "https:" ? u.origin : null;
  } catch {
    return null;
  }
};

export function createCheckerPass(ownOrigins: readonly string[], secret: string = randomBytes(32).toString("hex")): CheckerPass {
  const origins = new Set(ownOrigins.map(originOf).filter((o): o is string => o !== null));
  const expected = Buffer.from(secret);
  return {
    wrap(base) {
      return ((input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        const origin = originOf(url);
        if (!origin || !origins.has(origin)) return base(input, init);
        const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
        headers.set(CHECKER_HEADER, secret);
        // A redirect would carry the pass to another host, and Agon's endpoints never redirect.
        return base(input, { ...init, headers, redirect: "error" });
      }) as typeof fetch;
    },
    accepts(value) {
      if (!value) return false;
      const given = Buffer.from(value);
      return given.length === expected.length && timingSafeEqual(given, expected);
    },
  };
}

let processPass: CheckerPass | null = null;

/// The one pass for this process, made on first use with Agon's own origins.
export function processCheckerPass(ownOrigins: readonly string[]): CheckerPass {
  processPass ??= createCheckerPass(ownOrigins);
  return processPass;
}

/// True when a request carries this process's pass; false before any pass exists.
export function acceptsProcessChecker(value: string | null | undefined): boolean {
  return processPass?.accepts(value) ?? false;
}
