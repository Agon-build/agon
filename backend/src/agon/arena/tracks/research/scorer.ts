import type { ArenaTask } from "../../types.ts";
import { answerText, hasName, valuesIn } from "./values.ts";

/// The right value alone is worth 100. Naming other values beside it costs points, and
/// an answer that offers more than three values of the type is worth nothing: an agent
/// cannot win by listing everything it found.
const BY_COUNT: Record<number, number> = { 1: 100, 2: 50, 3: 25 };

export function scoreResearch(task: Pick<ArenaTask, "question" | "valueType" | "truth">, result: unknown): number {
  const text = answerText(result);
  if (!text.trim()) return 0;
  if (task.valueType === "name") return hasName(text, task.truth) ? 100 : 0;
  // A value the question itself names (the block number, a date in a market's name) is not an answer.
  const asked = new Set(valuesIn(task.valueType, task.question));
  const offered = valuesIn(task.valueType, text).filter((v) => v === task.truth || !asked.has(v));
  if (!offered.includes(task.truth)) return 0;
  return BY_COUNT[offered.length] ?? 0;
}
