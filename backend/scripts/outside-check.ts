/// Owner-run mainnet check for the aggregator: hires one Circle service at or
/// under 0.01 USDC through the Arc mainnet runtime, with Agon's routing fee,
/// and prints the outcome and the receipt link. Moves real USDC.
/// Needs AGON_OUTSIDE_ENABLED=true and AGON_OUTSIDE_FEE_ADDRESS set, and a
/// funded mainnet agent wallet for the owner (the first run prints its address).
/// Usage: npx tsx scripts/outside-check.ts --owner check:outside-1 [--url <service url>] [--input '{"q":"bitcoin"}'] [--yes]
import "dotenv/config";
import { formatUnits } from "viem";

import { startOutsideRuntime } from "../src/agon/payments/runtime.ts";
import { resolveOutsideSettings } from "../src/agon/payments/settings.ts";
import { createCircleSource } from "../src/agon/routing/circle-source.ts";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i]!.replace(/^--/, "");
  const next = process.argv[i + 1];
  if (next && !next.startsWith("--")) { args.set(key, next); i++; } else args.set(key, "true");
}
const owner = args.get("owner") ?? "check:outside-1";
const show = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 2);
const usdc = (v: bigint) => formatUnits(v, 6);
const MAX_PRICE = 10_000n; // 0.01 USDC

const settings = resolveOutsideSettings(process.env);
if (!settings.enabled || !settings.ok) throw new Error(`outside hires are off or misconfigured: ${show(settings)}`);
if (!settings.settings.feeAddress) throw new Error("AGON_OUTSIDE_FEE_ADDRESS is not set; the fee would have nowhere to go");
const runtime = startOutsideRuntime({ startLoops: false });
if (!runtime) throw new Error("the mainnet runtime did not start; see [outside] log above");

const wallet = await runtime.hire.wallets.ensure(owner);
const balance = await runtime.balanceOf(wallet.address);
console.log(`mainnet agent wallet for ${owner}: ${wallet.address}, balance ${balance === null ? "unknown" : usdc(balance)} USDC`);

const circle = createCircleSource();
await circle.refresh();
const wanted = args.get("url");
const cheap = circle.entries()
  .filter((e) => (wanted ? e.url === wanted : e.price > 0n && e.price <= MAX_PRICE))
  .sort((a, b) => {
    const req = (e: typeof a) => ((e.inputSchema as { required?: string[] } | null)?.required?.length ?? 0);
    return req(a) - req(b) || Number(a.price - b.price);
  });
const entry = cheap[0];
if (!entry) throw new Error(wanted ? `no payable Circle service at ${wanted}` : "no payable Circle service at or under 0.01 USDC right now");
if (entry.price > MAX_PRICE) throw new Error(`${entry.url} costs ${usdc(entry.price)} USDC, over the 0.01 USDC check limit`);
const input = args.get("input") ? (JSON.parse(args.get("input")!) as Record<string, unknown>) : entry.method === "GET" ? { q: "bitcoin" } : { query: "bitcoin" };
console.log(`service: ${entry.name} by ${entry.provider}\n  ${entry.method} ${entry.url}\n  price ${usdc(entry.price)} USDC, input ${show(input)}, schema ${show(entry.inputSchema)}`);

const quote = await runtime.hire.quoteHire({
  ownerRef: owner, providerUrl: entry.url, providerRef: entry.reference, providerLabel: entry.name, body: input, method: entry.method,
  feeBps: settings.settings.routingFeeBps, feeAddress: settings.settings.feeAddress,
});
console.log("quote", show(quote));
if (!quote.ok) process.exit(1);
const q = quote.quote;
if (q.amount !== entry.price || q.payTo.toLowerCase() !== entry.payTo?.toLowerCase()) {
  console.log("the live terms differ from Circle's catalog; stopping before any payment");
  process.exit(1);
}
if (balance !== null && balance < q.total) {
  console.log(`fund ${wallet.address} with at least ${usdc(q.total)} USDC on Arc mainnet, then run again`);
  process.exit(1);
}
if (q.step !== "confirm_code") {
  console.log("over the per-hire limit; approve in the browser with this token:", q.token);
  process.exit(0);
}
console.log(`about to pay ${usdc(q.amount)} USDC to ${q.payTo} and ${usdc(q.fee)} USDC fee to ${settings.settings.feeAddress}, real USDC on Arc mainnet`);
if (args.get("yes") !== "true") {
  console.log("dry run: add --yes to pay");
  process.exit(0);
}
const outcome = await runtime.hire.confirmHire({ ownerRef: owner, code: q.code });
console.log("outcome", show(outcome));
console.log(`receipt: ${(process.env.AGON_PUBLIC_API_URL ?? "https://api.agon.surf").replace(/\/$/, "")}/agon/jobs/${q.jobId}`);
console.log(`explorer: ${runtime.hire.network.explorer}/address/${wallet.address}`);
process.exit(outcome.ok ? 0 : 1);
