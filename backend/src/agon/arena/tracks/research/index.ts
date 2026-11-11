import type { ArenaTask, TrackDef } from "../../types.ts";
import { chainTask, chainTruthNow, isChainKind, type ChainReader } from "./chain-facts.ts";
import { isMarketKind, marketTask, marketTruthNow, type MarketReader } from "./market-facts.ts";
import { scoreResearch } from "./scorer.ts";

export type { ChainBlock, ChainReader } from "./chain-facts.ts";
export type { MarketReader, MarketRecord } from "./market-facts.ts";

/// The Research track: each task is a question with one right answer that Agon reads
/// itself, from the Arc chain or from a public market record, when the round opens.
export function createResearchTrack(deps: { chain: ChainReader; markets: MarketReader; pick: (key: string, n: number) => number }): TrackDef {
  const make = { chain: (key: string, used: ReadonlySet<string>) => chainTask(deps, key, used), market: (key: string, used: ReadonlySet<string>) => marketTask(deps, key, used) };

  return {
    id: "research",
    categoryId: "1",
    label: "Research",

    async buildTasks({ seasonId, round, used, count }) {
      const taken = new Set(used);
      const tasks: ArenaTask[] = [];
      // Sources take turns, and the first one changes from round to round.
      const order = round % 2n === 0n ? (["chain", "market"] as const) : (["market", "chain"] as const);
      for (let slot = 0; slot < count; slot += 1) {
        const key = `${seasonId}:${round}:${slot}`;
        const source = order[slot % 2]!;
        const other = order[(slot + 1) % 2]!;
        // A source that cannot give a task hands its place to the other one.
        const task = (await make[source](key, taken)) ?? (await make[other](`${key}:alt`, taken));
        if (!task) continue;
        taken.add(task.taskId);
        tasks.push(task);
      }
      return tasks;
    },

    score: (task, result) => scoreResearch(task, result),

    async recheck(task) {
      const at = task.taskId.indexOf(":");
      const kind = task.taskId.slice(0, at);
      const subject = task.taskId.slice(at + 1);
      const now = isChainKind(kind) ? await chainTruthNow(deps.chain, kind, subject)
        : isMarketKind(kind) ? await marketTruthNow(deps.markets, kind, subject)
          : null;
      return now !== null && now === task.truth ? "holds" : "void";
    },
  };
}
