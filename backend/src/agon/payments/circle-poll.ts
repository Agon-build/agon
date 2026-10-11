import type { Hex } from "viem";

const DONE = new Set(["CONFIRMED", "COMPLETE"]);
const FAILED = new Set(["FAILED", "DENIED", "CANCELLED"]);

/// Polls a Circle developer-wallet transaction until it has an on-chain hash,
/// or throws with Circle's reason. A failed status read is retried until the
/// timeout: the transaction may still be mining.
export async function waitForCircleTx(input: {
  id: string;
  label: string;
  getTxState: (id: string) => Promise<{ state: string; txHash?: string | null; errorReason?: string | null }>;
  pollMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}): Promise<Hex> {
  const sleep = input.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = input.now ?? Date.now;
  const started = now();
  for (;;) {
    let state: { state: string; txHash?: string | null; errorReason?: string | null };
    try {
      state = await input.getTxState(input.id);
    } catch (error) {
      if (now() - started > (input.timeoutMs ?? 120_000)) throw error;
      await sleep(input.pollMs ?? 1_500);
      continue;
    }
    if (FAILED.has(state.state)) throw new Error(`${input.label} failed: ${state.errorReason ?? state.state}`);
    if (DONE.has(state.state) && state.txHash) return state.txHash.toLowerCase() as Hex;
    if (now() - started > (input.timeoutMs ?? 120_000)) throw new Error(`${input.label} did not confirm in time`);
    await sleep(input.pollMs ?? 1_500);
  }
}
