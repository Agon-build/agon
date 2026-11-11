import type { ArenaTask } from "../../types.ts";

/// Research tasks about the Arc chain: facts about one finished block, which never change.

export type ChainBlock = { gasUsed: bigint; txCount: number; timestamp: Date };
export type ChainReader = { block(n: bigint): Promise<ChainBlock | null>; latest(): Promise<bigint> };

export const CHAIN_KINDS = ["block-gas", "block-tx-count", "block-date"] as const;
export type ChainKind = (typeof CHAIN_KINDS)[number];

/// Tasks use blocks at least this far behind the newest one, so every reader sees the same block.
export const BLOCK_SETTLE_DEPTH = 1_000n;
const BLOCK_SPAN = 200_000;

const WORDINGS: Record<ChainKind, readonly ((block: bigint) => string)[]> = {
  "block-gas": [
    (b) => `How much gas did block ${b} on Arc Testnet use? Reply with the number only.`,
    (b) => `What is the total gas used in Arc Testnet block ${b}? Give just the number.`,
    (b) => `On Arc Testnet, find block ${b} and report its gas used as a plain number.`,
  ],
  "block-tx-count": [
    (b) => `How many transactions are in block ${b} on Arc Testnet? Reply with the number only.`,
    (b) => `Count the transactions in Arc Testnet block ${b}. Give just the number.`,
    (b) => `On Arc Testnet, what is the transaction count of block ${b}? Answer with a plain number.`,
  ],
  "block-date": [
    (b) => `On what date (UTC) was block ${b} on Arc Testnet produced? Reply with the date as YYYY-MM-DD.`,
    (b) => `Which UTC day does Arc Testnet block ${b} belong to? Give the date as YYYY-MM-DD.`,
    (b) => `Find Arc Testnet block ${b} and report the UTC date of its timestamp as YYYY-MM-DD.`,
  ],
};

export const chainTruth = (kind: ChainKind, block: ChainBlock): string =>
  kind === "block-gas" ? block.gasUsed.toString() : kind === "block-tx-count" ? String(block.txCount) : block.timestamp.toISOString().slice(0, 10);

export const isChainKind = (kind: string): kind is ChainKind => (CHAIN_KINDS as readonly string[]).includes(kind);

/// One chain task, or null when no unused block could be read in a few tries.
export async function chainTask(deps: { chain: ChainReader; pick: (key: string, n: number) => number }, key: string, used: ReadonlySet<string>): Promise<ArenaTask | null> {
  const latest = await deps.chain.latest().catch(() => null);
  if (latest === null || latest <= BLOCK_SETTLE_DEPTH) return null;
  const newest = latest - BLOCK_SETTLE_DEPTH;
  const kind = CHAIN_KINDS[deps.pick(`${key}:kind`, CHAIN_KINDS.length)]!;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const back = BigInt(deps.pick(`${key}:block:${attempt}`, BLOCK_SPAN));
    const n = newest > back ? newest - back : 1n;
    const taskId = `${kind}:${n}`;
    if (used.has(taskId)) continue;
    const block = await deps.chain.block(n).catch(() => null);
    if (!block) continue;
    // An empty block makes a dull question; take one only on the last try.
    if (block.txCount === 0 && attempt < 5) continue;
    const wordings = WORDINGS[kind];
    return { taskId, family: kind, question: wordings[deps.pick(`${key}:wording`, wordings.length)]!(n), valueType: kind === "block-date" ? "date" : "integer", truth: chainTruth(kind, block) };
  }
  return null;
}

/// The truth of a chain task as the chain reads now, or null when it cannot be read.
export async function chainTruthNow(chain: ChainReader, kind: ChainKind, subject: string): Promise<string | null> {
  if (!/^\d{1,20}$/.test(subject)) return null;
  const block = await chain.block(BigInt(subject)).catch(() => null);
  return block ? chainTruth(kind, block) : null;
}
