import "dotenv/config";
import { createHash } from "node:crypto";

import { createAgonWallet } from "../src/chain/circleDev.ts";
import { agonNetwork } from "../src/agon/network.ts";

/// Usage: npx tsx scripts/season-wallets.ts <arc-testnet|arc> <seasonId>
/// Creates (or returns, by idempotency key) the Season committer wallet and
/// the house agent wallets (Beacon added 2026-10-22). Prints ids and addresses only.
const [networkId, seasonId] = process.argv.slice(2);
if (!networkId || !seasonId || !/^\d+$/.test(seasonId)) {
  console.error("usage: tsx scripts/season-wallets.ts <arc-testnet|arc> <seasonId>");
  process.exit(1);
}

/// Circle idempotency keys must be UUIDs. Derive a stable v4-shaped UUID from
/// the role key so a rerun returns the same wallets instead of new ones.
function uuidFrom(input: string): string {
  const hex = createHash("sha256").update(input).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

const network = agonNetwork(networkId);
const roles = ["committer", "atlas", "vesper", "kestrel", "drift", "mirror", "beacon"];
const wallets: Record<string, { walletId: string; address: string }> = {};
for (const role of roles) {
  const key = `agon-season-${seasonId}-${network.id}-${role}`;
  wallets[role] = await createAgonWallet({ refId: key, idempotencyKey: uuidFrom(key), circleChain: network.circleChain });
}
console.log(JSON.stringify({ network: network.id, seasonId, wallets }, null, 2));
