import { createPublicClient, fallback, http, webSocket } from "viem";
import { arcTestnet } from "viem/chains";
import { config } from "../config/index.js";

/// Re-export viem's built-in Arc testnet (chain id 5042002). A custom
/// `defineChain` is not required since viem ships the chain natively.
/// RPC URLs come from env via `config.rpcHttp` and
/// `config.rpcWs`, passed explicitly to the transports below so a paid or
/// regional RPC can override the canonical one without redefining the chain.
if (config.chainId !== arcTestnet.id) {
  console.warn(
    `chain mismatch: config.chainId=${config.chainId} but viem's arcTestnet.id=${arcTestnet.id}. ` +
      "Reads/writes will still target arcTestnet; update CHAIN_ID in .env to align.",
  );
}
export { arcTestnet };

/// HTTP client for reads and log polling. `batch` coalesces concurrent JSON-RPC
/// calls (e.g. a `Promise.all` of balance reads) into a SINGLE HTTP request. The
/// public Arc RPC rate-limits bursts (observed 429s under a fan-out of eth_calls),
/// which surfaced as slow loads and funded wallets reading 0. Batching cuts the
/// request count sharply; the Arc RPC supports it. retryCount backs off on the
/// transient 429/5xx that remain.
/// Each configured HTTP RPC becomes a batching, retrying transport. With more than
/// one URL they are wrapped in `fallback([...])`: viem uses the primary and fails
/// over to the next on error, so a dedicated endpoint and the public RPC back each
/// other up. Set `ARC_RPC_HTTP` to a comma-separated list (primary first).
const httpTransports = config.rpcHttpList.map((url) =>
  http(url, { batch: { wait: 16 }, retryCount: 3, timeout: 15_000 }),
);
const httpTransport = httpTransports.length > 1 ? fallback(httpTransports) : httpTransports[0]!;

/// Transactions fail over too: when the primary RPC cannot relay, the same signed transaction
/// goes to the next configured URL (resending identical bytes cannot create a second transaction).
const writeTransports = config.rpcHttpList.map((url) => http(url, { retryCount: 2, timeout: 20_000 }));
export const arcWriteTransport = writeTransports.length > 1 ? fallback(writeTransports) : writeTransports[0]!;

export const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: httpTransport,
  // Multicall aggregates concurrent CONTRACT reads (readContract scheduled in the
  // same tick) into ONE Multicall3 eth_call. Combined with the transport's
  // JSON-RPC batching above, a parallelized scan (e.g. reading 100 contests to
  // find the due ones) becomes a single round-trip instead of 100. Multicall3 is
  // deployed on Arc at the canonical address.
  batch: { multicall: { wait: 16, batchSize: 4_096 } },
});

/// WebSocket client for live event subscriptions (eth_subscribe is WS-only on Arc).
/// Same fallback treatment when multiple WS URLs are configured via ARC_RPC_WS.
const wsTransports = config.rpcWsList.map((url) => webSocket(url, { retryCount: 3 }));
const wsTransport = wsTransports.length > 1 ? fallback(wsTransports) : wsTransports[0]!;

export const wsClient = createPublicClient({
  chain: arcTestnet,
  transport: wsTransport,
});
