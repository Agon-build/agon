/// Usage: npx tsx scripts/payment-wallets.ts <arc-testnet|arc>
/// Creates (or returns, by idempotency key) the lead agent wallet, the testnet
/// stand-in seller wallet and the four house seller wallets, and prints the
/// env values. Prints ids and addresses only.
import "dotenv/config";
import { createAgonWallet } from "../src/chain/circleDev.ts";
import { agonNetwork } from "../src/agon/network.ts";
import { stableUuid } from "../src/agon/playground/seasons/committer.ts";

const network = agonNetwork(process.argv[2] ?? "");
const make = async (role: string) => {
  const refId = `agon-pay-${network.id}-${role}`;
  return createAgonWallet({ refId, idempotencyKey: stableUuid(refId), circleChain: network.circleChain });
};
const lead = await make("lead");
const standin = network.id === "arc-testnet" ? await make("standin") : null;
const house: Record<string, { walletId: string; address: string }> = {};
for (const key of ["atlas", "vesper", "kestrel", "drift"]) house[key] = await make(`house-${key}`);
console.log(`AGON_PAYMENT_NETWORK=${network.id}`);
console.log(`AGON_LEAD_WALLET=${JSON.stringify(lead)}`);
if (standin) console.log(`AGON_STANDIN_SELLER_WALLET=${JSON.stringify(standin)}`);
console.log(`AGON_HOUSE_SELLER_WALLETS=${JSON.stringify(house)}`);
