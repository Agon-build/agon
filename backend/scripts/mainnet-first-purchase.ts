/// First mainnet act at the promotion gate: the lead wallet buys BlockRun's
/// BTC price (0.002 USDC) and market search (0.0085 USDC) on Arc mainnet, and
/// reports whether the lead agent's parsers understand both responses.
/// Usage: npx tsx scripts/mainnet-first-purchase.ts
import "dotenv/config";
import { signTypedDataJson } from "../src/chain/circleDev.ts";
import { buyExact } from "../src/agon/payments/exact-buyer.ts";
import { createGuardedSigner } from "../src/agon/payments/guarded-signer.ts";
import { resolvePaymentSettings } from "../src/agon/payments/settings.ts";
import { findMarkets, priceFromPayload } from "../src/agon/lead-agent/market-parse.ts";
import { dataServicesFor } from "../src/agon/router/data-services.ts";

const resolved = resolvePaymentSettings(process.env);
if (!resolved.enabled || !resolved.ok) throw new Error(`payments not configured: ${JSON.stringify(resolved)}`);
const s = resolved.settings;
if (s.network.id !== "arc") throw new Error("set AGON_PAYMENT_NETWORK=arc for the mainnet purchase");
const data = dataServicesFor(s.network, s.publicApiUrl);
const signerFor = (payTo: `0x${string}`, maxValue: bigint) =>
  createGuardedSigner({ address: s.lead.address, walletId: s.lead.walletId, signJson: signTypedDataJson, context: () => ({ network: s.network, from: s.lead.address, payTo, maxValue, now: new Date() }) });

const price = await buyExact({ url: data.price(["coingecko:bitcoin"]), network: s.network, maxAmount: 2_000n, signerFor: (o) => signerFor(o.payTo, o.amount) });
console.log("price purchase", price.ok ? { tx: price.txHash, amount: price.amount.toString() } : price);
console.log("parsed BTC price", price.ok ? priceFromPayload(price.data, "coingecko:bitcoin") : null);
const search = await buyExact({ url: data.marketSearch("bitcoin above"), network: s.network, maxAmount: 8_500n, signerFor: (o) => signerFor(o.payTo, o.amount) });
console.log("search purchase", search.ok ? { tx: search.txHash, amount: search.amount.toString() } : search);
console.log("parsed markets", search.ok ? findMarkets(search.data).slice(0, 3) : null);
if (search.ok && findMarkets(search.data).length === 0) console.log("RAW SEARCH PAYLOAD (adjust market-parse.ts):", JSON.stringify(search.data).slice(0, 2000));
