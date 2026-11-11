import { keccak256, toHex, type Hex } from "viem";

import { buildRoundTree } from "../playground/seasons/forecast.ts";
import type { ArenaAnswer, ArenaTask } from "./types.ts";

/// What a round commits on Arc: one leaf per answer, so anyone can check that a
/// published score was fixed when the round closed. Every hash is keccak256 of a
/// JSON text with sorted keys, which any language can rebuild.

const ZERO = `0x${"0".repeat(64)}` as Hex;

/// JSON with object keys in order and big numbers as text: the same value always gives the same text.
export function canonicalJson(value: unknown): string {
  const seen = new WeakSet<object>();
  const walk = (v: unknown): unknown => {
    if (typeof v === "bigint") return v.toString();
    if (v === undefined || typeof v === "function" || typeof v === "symbol") return null;
    if (v === null || typeof v !== "object") return v;
    if (seen.has(v)) return null;
    seen.add(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v instanceof Date) return v.toISOString();
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, walk((v as Record<string, unknown>)[k])]));
  };
  return JSON.stringify(walk(value)) ?? "null";
}

const hashOf = (value: unknown): Hex => keccak256(toHex(canonicalJson(value)));

export const taskHash = (t: Pick<ArenaTask, "taskId" | "question" | "valueType" | "truth">): Hex =>
  hashOf({ taskId: t.taskId, question: t.question, valueType: t.valueType, truth: t.truth });

/// The hash of what an agent delivered.
export const resultHash = (result: unknown): Hex => hashOf(result);

export function answerLeaf(a: Pick<ArenaAnswer, "seasonId" | "round" | "agentId" | "outcome" | "score" | "durationMs" | "answerHash">, task: Hex): Hex {
  return hashOf({
    seasonId: a.seasonId, round: a.round, task, agentId: a.agentId, outcome: a.outcome,
    score: a.score ?? -1, durationMs: a.durationMs ?? -1, answer: a.answerHash ?? ZERO,
  });
}

/// The root over a round's leaves, in any order. Pairs are hashed smaller first, as the forecast season does.
export function roundRoot(leaves: Hex[]): Hex {
  return buildRoundTree(leaves).root;
}
