"use client";
import { erc20Abi } from "viem";
import { useAccount, useSwitchChain, useWriteContract } from "wagmi";

import { useAuth } from "@/hooks/useAuth";
import { fundingPath } from "@/lib/agon/add-funds";

const USDC_ON_ARC = "0x3600000000000000000000000000000000000000" as const;
const ARC_TESTNET_ID = 5_042_002;
const AUTH_URL = (process.env.NEXT_PUBLIC_AUTH_URL ?? "http://localhost:8082").replace(/\/+$/, "");

/// Sends USDC on Arc from the signed-in account's own wallet: a browser wallet
/// signs the transfer, a Circle sign-in wallet confirms it through Agon.
/// Throws Error("connect") when a browser wallet is not connected.
export function useUsdcSend(testnet: boolean) {
  const { me } = useAuth();
  const path = fundingPath(me?.walletKind, testnet);
  const { isConnected, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();

  async function send(to: string, atomic: bigint): Promise<{ tx: string | null }> {
    if (path === "wallet") {
      if (!isConnected) throw new Error("connect");
      if (chainId !== ARC_TESTNET_ID) await switchChainAsync({ chainId: ARC_TESTNET_ID as never });
      const tx = await writeContractAsync({ address: USDC_ON_ARC, abi: erc20Abi, functionName: "transfer", args: [to as `0x${string}`, atomic], chainId: ARC_TESTNET_ID as never });
      return { tx };
    }
    if (path === "circle") {
      const res = await fetch(`${AUTH_URL}/wallet/execute`, {
        method: "POST", credentials: "include", headers: { "content-type": "application/json" },
        body: JSON.stringify({ contractAddress: USDC_ON_ARC, abiFunctionSignature: "transfer(address,uint256)", abiParameters: [to, atomic.toString()] }),
      });
      if (!res.ok) throw new Error("circle");
      return { tx: null };
    }
    throw new Error("address-only");
  }

  return { path, send };
}

/// One plain sentence for a failed send.
export function sendErrorText(e: unknown): string {
  const text = e instanceof Error ? e.message : "";
  if (text === "connect") return "Connect your wallet first, then try again.";
  if (text === "address-only") return "Send the USDC from your own wallet to the address shown.";
  if (/reject|denied/i.test(text)) return "You declined the transfer. Nothing was sent.";
  return "Transfer failed. Nothing was sent.";
}
