import { fallback, http } from "wagmi";
import {
  arbitrumSepolia,
  arcTestnet,
  avalancheFuji,
  baseSepolia,
  optimismSepolia,
  polygonAmoy,
  sepolia,
  unichainSepolia,
} from "wagmi/chains";
import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { injectedWallet } from "@rainbow-me/rainbowkit/wallets";
import { PRODUCT_NAME } from "./product";

/// wagmi config, built through RainbowKit's `getDefaultConfig` so the wallet
/// picker is populated with the full branded list (MetaMask, Rabby, Coinbase,
/// Rainbow, WalletConnect + the mobile QR path), not just whichever EIP-6963
/// extension happens to be installed. A plain `injected()` connector produced a
/// one-row modal; this is the rich picker.
///
/// getDefaultConfig is client-only, so this module must NOT be imported into a
/// server component (e.g. for cookieToInitialState) — it throws there. With
/// ssr:true it persists the connection in cookieStorage, so a returning user
/// reconnects from cookies on the client. The session detector in useAuth waits
/// for that reconnect (the walletSettled gate) before judging the wallet
/// missing, which is what keeps a full-page navigation from signing the user
/// out mid-reconnect.
///
/// WalletConnect needs a project id from cloud.reown.com
/// (NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID). When it is absent, expose only the
/// injected browser-wallet connector. This keeps email and extension-wallet
/// sign-in usable without sending broken placeholder requests to Reown.
///
/// Arc Testnet is Agon's network. The other testnets are bridge sources only.
///
/// The Arc transport is the hot path (every wallet read — balances, contract
/// reads — goes through it), and the public Arc RPC rate-limits bursts. So it gets
/// JSON-RPC batching (coalesce concurrent reads into one request), a retry for the
/// 429/5xx, and dedicated endpoint(s) via NEXT_PUBLIC_ARC_RPC_HTTP (comma-separated,
/// primary first). When set, the transport is a `fallback([...])` that tries the
/// dedicated endpoint(s) then the public RPC, so one endpoint failing never breaks
/// wallet reads. The bridge source chains stay on their bare public RPCs — they're
/// touched only during an occasional bridge, not on every page.
const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim();
const projectId = walletConnectProjectId || "agon-walletconnect-disabled";
const wallets = walletConnectProjectId
  ? undefined
  : [{ groupName: "Browser wallet", wallets: [injectedWallet] }];
const arcDedicatedRpc = (process.env.NEXT_PUBLIC_ARC_RPC_HTTP || "")
  .split(",")
  .map((u) => u.trim())
  .filter(Boolean);
const ARC_RPC_OPTS = { batch: true, retryCount: 3 } as const;
const arcTransport = arcDedicatedRpc.length
  ? fallback([...arcDedicatedRpc.map((u) => http(u, ARC_RPC_OPTS)), http(undefined, ARC_RPC_OPTS)])
  : http(undefined, ARC_RPC_OPTS);

export const config = getDefaultConfig({
  appName: PRODUCT_NAME,
  projectId,
  wallets,
  chains: [
    arcTestnet,
    sepolia,
    baseSepolia,
    arbitrumSepolia,
    optimismSepolia,
    polygonAmoy,
    avalancheFuji,
    unichainSepolia,
  ],
  transports: {
    [arcTestnet.id]: arcTransport,
    [sepolia.id]: http(),
    [baseSepolia.id]: http(),
    [arbitrumSepolia.id]: http(),
    [optimismSepolia.id]: http(),
    [polygonAmoy.id]: http(),
    [avalancheFuji.id]: http(),
    [unichainSepolia.id]: http(),
  },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof config;
  }
}
