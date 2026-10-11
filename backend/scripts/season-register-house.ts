/// Registers each house agent wallet as an ERC-8004 identity so its season
/// entry can carry an agent id. Usage:
///   npx tsx scripts/season-register-house.ts <arc-testnet|arc> '<AGON_SEASON_HOUSE_WALLETS json>' <https metadata base>
/// Each agent's metadata URI is <base>/<key>.json, for example
/// https://agon.surf/agents/house/atlas.json
import "dotenv/config";
import { executeContractCall, getTxState } from "../src/chain/circleDev.ts";
import { agonNetwork } from "../src/agon/network.ts";

const [networkId, walletsJson, metadataBase] = process.argv.slice(2);
if (!networkId || !walletsJson || !metadataBase?.startsWith("https://")) {
  console.error("usage: tsx scripts/season-register-house.ts <network> '<wallets json>' <https metadata base>");
  process.exit(1);
}
const network = agonNetwork(networkId);
const wallets = JSON.parse(walletsJson) as Record<string, { walletId: string; address: string }>;
for (const [key, wallet] of Object.entries(wallets)) {
  const submitted = await executeContractCall({
    walletId: wallet.walletId,
    contractAddress: network.identityRegistry,
    abiFunctionSignature: "register(string)",
    abiParameters: [`${metadataBase}/${key}.json`],
    refId: `agon-house-register-${network.id}-${key}`,
  });
  let settled = false;
  for (let i = 0; i < 90 && !settled; i++) {
    const state = await getTxState(submitted.id);
    if (state.state === "CONFIRMED" || state.state === "COMPLETE") {
      console.log(`${key}: registered in ${state.txHash}`);
      settled = true;
    } else if (state.state === "FAILED") {
      console.log(`${key}: FAILED ${state.errorReason ?? ""}`);
      settled = true;
    } else {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
  if (!settled) console.log(`${key}: still pending after 3 minutes; check Circle transaction ${submitted.id}`);
}
console.log("Read each agent id from the registration transaction's Transfer event and record it for the season entry.");
