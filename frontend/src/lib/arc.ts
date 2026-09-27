import { createPublicClient, fallback, http } from "viem";
import { arcTestnet } from "viem/chains";

/// Re-export viem's built-in Arc testnet chain. viem ships `arcTestnet`
/// natively (chain id 5042002, RPC, explorer, 18-dec USDC native gas), so a
/// custom `defineChain` is never required.
export { arcTestnet };

export const EXPLORER = "https://testnet.arcscan.app";

/// Arc system contracts: the ERC-8004 IdentityRegistry mints the ERC-721 NFT
/// that backs every ArcRun agent. The token id is stored on the agent's row in
/// AgentRegistry as `erc8004TokenId` and is what other Arc contracts read for
/// trustless agent identity.
export const ERC8004_IDENTITY_REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e" as const;

/// Arcscan token page for a given ERC-721 token. Most explorers accept the
/// `?a=tokenId` parameter on the contract page.
export function nftLink(tokenId: bigint | number | string): string {
  return `${EXPLORER}/token/${ERC8004_IDENTITY_REGISTRY}?a=${String(tokenId)}`;
}

/// Native USDC on Arc (6 decimals as an ERC-20). Used for agent upgrades.
export const USDC = "0x3600000000000000000000000000000000000000" as const;

/// Dedicated Arc RPC(s) for the browser, comma-separated (primary first), set on
/// Vercel as NEXT_PUBLIC_ARC_RPC_HTTP. The public RPC (rpc.testnet.arc.network)
/// rate-limits bursts (429) and runs ~0.65s/call, so a dedicated endpoint is the
/// real fix. The chain's public RPC is ALWAYS appended as a final backstop.
const RPC_OPTS = { batch: { wait: 16 }, retryCount: 3, timeout: 15_000 } as const;
const dedicatedRpc = (process.env.NEXT_PUBLIC_ARC_RPC_HTTP || "")
  .split(",")
  .map((u) => u.trim())
  .filter(Boolean);

/// Read-only client for fetching on-chain state (no wallet needed).
///
/// TWO layers of batching, both load-bearing against the rate-limited public RPC:
///  - `batch.multicall` aggregates CONTRACT reads (readContract) through
///    Multicall3, so a list page reading every contest/challenge (2 eth_calls
///    each, hundreds of items) is a handful of round-trips, not 600.
///  - `batch` on the transport (JSON-RPC batching) coalesces everything ELSE
///    scheduled in the same tick — getBalance, getBlock, non-multicall reads —
///    into ONE HTTP request. Without it those still burst the RPC and 429, which
///    is what made pages crawl and balances read 0. `retryCount` backs off on the
///    429/5xx that remain.
///
/// When a dedicated RPC is set, the transport is a `fallback([...])`: viem uses
/// the dedicated endpoint(s) first and fails over to the public RPC on error, so
/// one endpoint going down never takes reads with it.
export const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: dedicatedRpc.length
    ? fallback([...dedicatedRpc.map((u) => http(u, RPC_OPTS)), http(undefined, RPC_OPTS)])
    : http(undefined, RPC_OPTS),
  batch: { multicall: { wait: 16, batchSize: 4_096 } },
});

/// Wait for a write's receipt and throw if the tx reverted on chain.
///
/// viem's `waitForTransactionReceipt` RESOLVES even when the transaction
/// reverted — it returns a receipt with `status: "reverted"` rather than
/// rejecting. A caller that only awaited it would sail past a failed write and
/// treat it as success (e.g. show "challenge #N is live" after the create tx
/// actually reverted). Route every write that must land before the UI advances
/// through this helper so a revert becomes a thrown error the catch can show.
export async function confirmTx(hash: `0x${string}`) {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error("the transaction reverted on chain.");
  }
  return receipt;
}

/// The chain's latest block timestamp in seconds.
///
/// Anchor any ON-CHAIN deadline to this, never to the client's `Date.now()`:
/// Arc's block clock can run several minutes ahead of a user's machine, and a
/// deadline computed from a slow local clock lands in the chain's past, so the
/// contract reverts (ChallengeArena `BadDeadlines`). Reading block time makes
/// the deadline math agree with the clock the contract actually checks against.
export async function chainNowSeconds(): Promise<number> {
  const block = await publicClient.getBlock({ blockTag: "latest" });
  return Number(block.timestamp);
}

/// Chain-vs-local clock skew, in seconds (chain block time minus the viewer's
/// Date.now()). Measured once on the client and refreshed periodically. A
/// viewer's machine clock can be minutes off; on-chain deadlines are stamped in
/// CHAIN time, so a countdown computed against raw Date.now() shows the wrong
/// "time left" (a slow local clock makes every deadline look further away).
/// All user-facing countdowns tick against `chainAlignedNow()` instead.
let chainSkewSec = 0;
let skewInFlight: Promise<void> | null = null;

/// Re-measure the chain skew. Singleton-guarded, so many countdowns mounting at
/// once still make a single RPC call. Keeps the prior value on failure.
export function refreshChainSkew(): Promise<void> {
  if (skewInFlight) return skewInFlight;
  skewInFlight = (async () => {
    try {
      const chain = await chainNowSeconds();
      chainSkewSec = chain - Math.floor(Date.now() / 1000);
    } catch {
      /* keep the prior skew; a transient RPC miss shouldn't reset alignment */
    } finally {
      skewInFlight = null;
    }
  })();
  return skewInFlight;
}

/// `now` in seconds, aligned to the chain block clock. Falls back to local time
/// (skew 0) until the first measurement lands; countdowns tick every second, so
/// they self-correct on the next tick once skew is known.
export function chainAlignedNow(): number {
  return Math.floor(Date.now() / 1000) + chainSkewSec;
}

// Kick off the first measurement as soon as this module loads in the browser.
// SSR-guarded so it never runs during server render.
if (typeof window !== "undefined") {
  void refreshChainSkew();
}

/// Deployed ArcRun contracts on Arc testnet. Public addresses; the canonical
/// record is contracts/deployments/arc-testnet.json.
export const CONTRACTS = {
  ContestEngine: "0xCeFD67616fac0A4eeb244C7EDf6cc63E3962Afba",
  ChallengeArena: "0xa3658A8001182bB0556B93193B00A1272F7D3322",
  AgentRegistry: "0x99306f3f4C1608915f07eDE24F5e6515F6eeE281",
  PrizeEscrow: "0x9A81C86aA4E548EC322889cdE7E489fBEb0a215F",
  SyndicateFactory: "0x611E5b5ccECe86bB092Bd363F065abE0D3b739B3",
  PointsLedger: "0xd1b822137391f40bc70c8BC1EF5690fD62Fe7AD5",
} as const;

/// Current Agon protocol contracts. Keep these separate from the archived
/// ArcRun contracts above so a legacy surface can never silently write into a
/// new Agon contract or vice versa. ServiceRegistry and Arena are the linked
/// V2 pair the backend treats as active; `deployment-alignment.test.ts` fails
/// if these drift from contracts/deployments/agon-arc-testnet.json.
export const AGON_CONTRACTS = {
  ProfileRegistry: "0xE0c7A2545C2f4eE6d2bD797B6f2742c73E640574",
  ServiceRegistry: "0xf017290A267A3CEb693544882464a188D9e4a516",
  JobEscrow: "0x6373E576AcFC9DE6cB182dA201d8e857D2A918aD",
  Arena: "0x05B81dF2F1615BBDEbd837991BAB199F65eCCB83",
  SyndicateRegistry: "0xD77312288E4019bD3Fc7a6C0234B9c84D09C1Ab4",
  PrizeVault: "0xd3a538fD48FA81CF102E5b5381B47e46eC176D3b",
} as const;
