import type { Address } from "viem";

import { formatUsdc } from "../payments/bargain.ts";

export type PreflightCheck = { name: string; status: "pass" | "fail" | "warn"; detail: string };
export type PreflightDeps = {
  rpcs: { url: string; blockNumber: () => Promise<bigint> }[];
  wallets: { label: string; address: Address; floor: bigint }[];
  balanceOf: (a: Address) => Promise<bigint | null>;
  endpoints: { label: string; peek: () => Promise<{ ok: true; amount: bigint; payTo: Address } | { ok: false; detail: string }>; expectAmount?: bigint; expectPayTo?: Address; maxAmount?: bigint }[];
  lastCommitAt: () => Promise<Date | null>;
  telegram: (() => Promise<{ url: string | null; expectedUrl: string; lastErrorAt: Date | null }>) | null;
  models: { model: string; ping: () => Promise<boolean> }[];
  site: () => Promise<number>;
  offSwitches: string[];
  now: () => Date;
};

const pass = (name: string, detail: string): PreflightCheck => ({ name, status: "pass", detail });
const fail = (name: string, detail: string): PreflightCheck => ({ name, status: "fail", detail });

async function guard(name: string, run: () => Promise<PreflightCheck>): Promise<PreflightCheck> {
  try {
    return await run();
  } catch (error) {
    return fail(name, (error as Error).message);
  }
}

export async function runPreflight(deps: PreflightDeps): Promise<{ checks: PreflightCheck[]; ready: boolean }> {
  const checks: PreflightCheck[] = [];
  for (const rpc of deps.rpcs) {
    const name = `RPC ${rpc.url}`;
    checks.push(await guard(name, async () => pass(name, `block ${await rpc.blockNumber()}`)));
  }
  for (const w of deps.wallets) {
    const name = `Wallet ${w.label}`;
    checks.push(await guard(name, async () => {
      const balance = await deps.balanceOf(w.address);
      if (balance === null) return fail(name, `could not read ${w.address}`);
      return balance >= w.floor ? pass(name, `${formatUsdc(balance)} USDC`) : fail(name, `${formatUsdc(balance)} USDC, below ${formatUsdc(w.floor)}`);
    }));
  }
  for (const e of deps.endpoints) {
    checks.push(await guard(e.label, async () => {
      const terms = await e.peek();
      if (!terms.ok) return fail(e.label, terms.detail);
      if (e.expectPayTo && terms.payTo.toLowerCase() !== e.expectPayTo.toLowerCase()) return fail(e.label, `payee changed to ${terms.payTo}`);
      if (e.expectAmount !== undefined && terms.amount !== e.expectAmount) return fail(e.label, `price ${formatUsdc(terms.amount)}, expected ${formatUsdc(e.expectAmount)}`);
      if (e.maxAmount !== undefined && terms.amount > e.maxAmount) return fail(e.label, `price ${formatUsdc(terms.amount)} is over ${formatUsdc(e.maxAmount)}`);
      return pass(e.label, `${formatUsdc(terms.amount)} USDC to ${terms.payTo}`);
    }));
  }
  checks.push(await guard("Leaderboard", async () => {
    const last = await deps.lastCommitAt();
    if (!last) return fail("Leaderboard", "no Season commit yet");
    const hours = (deps.now().getTime() - last.getTime()) / 3_600_000;
    return hours <= 6 ? pass("Leaderboard", `last commit ${hours.toFixed(1)} h ago`) : fail("Leaderboard", `last commit ${hours.toFixed(1)} h ago`);
  }));
  if (deps.telegram) {
    const telegram = deps.telegram;
    checks.push(await guard("Telegram webhook", async () => {
      const info = await telegram();
      if (info.url !== info.expectedUrl) return fail("Telegram webhook", `webhook is ${info.url ?? "not set"}`);
      if (info.lastErrorAt && deps.now().getTime() - info.lastErrorAt.getTime() < 10 * 60_000) return fail("Telegram webhook", `delivery error at ${info.lastErrorAt.toISOString()}`);
      return pass("Telegram webhook", info.url);
    }));
  }
  for (const m of deps.models) {
    const name = `Model ${m.model}`;
    checks.push(await guard(name, async () => ((await m.ping()) ? pass(name, "answered") : fail(name, "no answer"))));
  }
  checks.push(await guard("Site home", async () => {
    const status = await deps.site();
    return status === 200 ? pass("Site home", "200") : fail("Site home", String(status));
  }));
  checks.push(deps.offSwitches.length > 0 ? { name: "Off switches", status: "warn", detail: deps.offSwitches.join(", ") } : pass("Off switches", "none on"));
  return { checks, ready: checks.every((c) => c.status !== "fail") };
}

export function formatPreflight(result: { checks: PreflightCheck[]; ready: boolean }): string {
  return [...result.checks.map((c) => `${c.status.toUpperCase().padEnd(4)}  ${c.name.padEnd(36)}  ${c.detail}`), result.ready ? "READY" : "NOT READY"].join("\n");
}
