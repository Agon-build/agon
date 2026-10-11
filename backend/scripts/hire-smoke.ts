/// The stage story without WhatsApp: quote the lead agent for a budget wallet,
/// confirm with the returned code, print the answer and the receipt link.
/// Usage: npx tsx scripts/hire-smoke.ts --owner smoke:rehearsal-1 --question "What's the real chance BTC closes above $82k on Friday?" [--kill-after-sign]
import "dotenv/config";
import { startPaymentsRuntime } from "../src/agon/payments/runtime.ts";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i]!.replace(/^--/, "");
  const next = process.argv[i + 1];
  if (next && !next.startsWith("--")) { args.set(key, next); i++; } else args.set(key, "true");
}
const owner = args.get("owner") ?? `smoke:${Date.now()}`;
const question = args.get("question") ?? "What's the real chance BTC closes above $82k on Friday?";
const killAfterSign = args.get("kill-after-sign") === "true";
const show = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 2);

const runtime = startPaymentsRuntime({
  season: null,
  startLoops: false,
  wrapSignJson: (fn) => async (walletId, json) => {
    const signature = await fn(walletId, json);
    if (killAfterSign) {
      console.log("signed; exiting before the paid request is sent (interruption test)");
      process.exit(9);
    }
    return signature;
  },
});
if (!runtime) throw new Error("payments are not configured; see [payments] log above");
const started = Date.now();
const quote = await runtime.hire.quoteHire({ ownerRef: owner, providerUrl: runtime.hire.leadProviderUrl, providerRef: "agent:lead", providerLabel: "Agon Lead Agent", body: { question } });
console.log("quote", show(quote));
if (!quote.ok) process.exit(1);
if (quote.quote.step !== "confirm_code") {
  console.log("over the per-hire limit: approve via link token", quote.quote.token);
  process.exit(0);
}
const outcome = await runtime.hire.confirmHire({ ownerRef: owner, code: quote.quote.code });
console.log("outcome", show(outcome));
console.log(`receipt: ${runtime.settings.publicApiUrl}/agon/jobs/${quote.quote.jobId}`);
console.log(`elapsed: ${((Date.now() - started) / 1000).toFixed(1)}s`);
process.exit(outcome.ok ? 0 : 1);
