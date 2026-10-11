import { z } from "zod";
import type { Address } from "viem";

import type { ModelCaller } from "../../playground/seasons/house-agents.ts";
import { parseUsdc } from "../../stage/money.ts";

export type ChatIntent =
  | { kind: "confirm"; code: string }
  | { kind: "cancel" }
  | { kind: "forecast"; question: string; maxPrice: bigint | null }
  | { kind: "balance" }
  | { kind: "deposit" }
  | { kind: "limits"; perHire: bigint | null; daily: bigint | null }
  | { kind: "history" }
  | { kind: "leaderboard" }
  | { kind: "freeze" }
  | { kind: "unfreeze" }
  | { kind: "withdraw"; to: Address | null; amount: bigint | null }
  | { kind: "help" }
  | { kind: "unknown" };

const NUMBER = "\\$?(\\d*\\.?\\d+)";
const ADDRESS = /0x[0-9a-fA-F]{40}/;

function limitsFrom(args: string): ChatIntent {
  const per = new RegExp(`${NUMBER}\\s*(?:usdc\\s*)?(?:per|a|each)?\\s*hire`, "i").exec(args);
  const day = new RegExp(`${NUMBER}\\s*(?:usdc\\s*)?(?:per|a|each)?\\s*(?:day|daily)`, "i").exec(args);
  return { kind: "limits", perHire: per ? parseUsdc(per[1]!) : null, daily: day ? parseUsdc(day[1]!) : null };
}

function withdrawFrom(args: string): ChatIntent {
  const to = ADDRESS.exec(args)?.[0]?.toLowerCase() as Address | undefined;
  const amount = new RegExp(`(?:^|\\s)${NUMBER}(?:\\s*usdc)?(?=\\s|$)`, "i").exec(args.replace(ADDRESS, " "));
  return { kind: "withdraw", to: to ?? null, amount: amount ? parseUsdc(amount[1]!) : null };
}

/// Money moves only through these exact patterns, matched by code. A Pay
/// button sends "yes:1234". The model never produces a confirmation.
export function parseCodeIntent(text: string): ChatIntent | null {
  const t = text.trim();
  const yes = /^(?:yes|y)[\s:]+(\d{4})$/i.exec(t);
  if (yes) return { kind: "confirm", code: yes[1]! };
  if (/^(?:no|cancel|stop)$/i.test(t)) return { kind: "cancel" };
  const words = t.replace(/^\//, "").replace(/^(\w+)@\w+/, "$1");
  const [head = "", ...rest] = words.split(/\s+/);
  const args = rest.join(" ");
  switch (head.toLowerCase()) {
    case "balance": return rest.length === 0 ? { kind: "balance" } : null;
    case "deposit": return rest.length === 0 ? { kind: "deposit" } : null;
    case "history": return rest.length === 0 ? { kind: "history" } : null;
    case "leaderboard": return rest.length === 0 ? { kind: "leaderboard" } : null;
    case "freeze": return rest.length === 0 ? { kind: "freeze" } : null;
    case "unfreeze": return rest.length === 0 ? { kind: "unfreeze" } : null;
    case "help": return rest.length === 0 ? { kind: "help" } : null;
    case "limits":
    case "limit": return rest.length === 0 ? { kind: "limits", perHire: null, daily: null } : limitsFrom(args);
    case "withdraw": return rest.length === 0 ? { kind: "withdraw", to: null, amount: null } : withdrawFrom(args);
    default: return null;
  }
}

const BUDGET = /[.,;]?\s*(?:spend|pay|budget|max(?:imum)?)\s*(?:up\s*to\s*)?\$?(\d*\.?\d+)\s*(?:usdc)?\.?\s*$/i;

export function keywordIntent(text: string): ChatIntent {
  const coded = parseCodeIntent(text);
  if (coded) return coded;
  const t = text.trim();
  const budget = BUDGET.exec(t);
  const question = (budget ? t.slice(0, budget.index) : t).trim();
  if (question.length >= 8 && question.length <= 300 && (/\?$/.test(question) || /\b(chance|odds|probability|will|forecast|likely)\b/i.test(question))) {
    return { kind: "forecast", question, maxPrice: budget ? parseUsdc(budget[1]!) : null };
  }
  return { kind: "unknown" };
}

const modelAnswer = z.object({
  intent: z.enum(["forecast", "balance", "deposit", "limits", "history", "leaderboard", "freeze", "unfreeze", "withdraw", "help", "unknown"]),
  question: z.string().max(300).optional(),
  maxPrice: z.string().max(32).optional(),
  perHire: z.string().max(32).optional(),
  daily: z.string().max(32).optional(),
  to: z.string().max(64).optional(),
  amount: z.string().max(32).optional(),
});

const SYSTEM =
  "You route chat messages for Agon, where agents forecast market questions for a small USDC fee. " +
  'Reply with JSON only: {"intent": one of forecast, balance, deposit, limits, history, leaderboard, freeze, unfreeze, withdraw, help, unknown, ' +
  'and only the fields that apply: "question", "maxPrice", "perHire", "daily", "to", "amount"}. ' +
  "Use forecast for any question about the chance of a future market outcome; put the question in question without budget words, and a stated spending cap in maxPrice as a plain USDC number. " +
  "Never invent amounts or addresses.";

function fromModel(a: z.infer<typeof modelAnswer>, text: string): ChatIntent {
  const money = (v: string | undefined) => (v === undefined ? null : parseUsdc(v));
  // Amounts and addresses that move or limit money are kept only when the user typed them.
  const lower = text.toLowerCase();
  const typed = (v: string | undefined) => (v !== undefined && v.trim() !== "" && lower.includes(v.trim().toLowerCase().replace(/^\$/, "")) ? v : undefined);
  switch (a.intent) {
    case "forecast": {
      const question = (a.question ?? text).trim();
      return question.length >= 8 && question.length <= 300 ? { kind: "forecast", question, maxPrice: money(a.maxPrice) } : keywordIntent(text);
    }
    case "limits": return { kind: "limits", perHire: money(typed(a.perHire)), daily: money(typed(a.daily)) };
    case "withdraw": {
      const to = typed(a.to);
      return { kind: "withdraw", to: to && /^0x[0-9a-fA-F]{40}$/.test(to) ? (to.toLowerCase() as Address) : null, amount: money(typed(a.amount)) };
    }
    default: return { kind: a.intent };
  }
}

export async function classifyIntent(text: string, deps: { callModel: ModelCaller; model: string; log?: (m: string) => void }): Promise<ChatIntent> {
  const coded = parseCodeIntent(text);
  if (coded) return coded;
  try {
    const reply = await deps.callModel({ model: deps.model, systemPrompt: SYSTEM, userPrompt: text.slice(0, 600), maxTokens: 200, temperature: 0 });
    const json = /\{[\s\S]*\}/.exec(reply.text)?.[0];
    const parsed = modelAnswer.safeParse(json ? JSON.parse(json) : null);
    return parsed.success ? fromModel(parsed.data, text) : keywordIntent(text);
  } catch (error) {
    deps.log?.(`chat classifier fell back to keywords: ${(error as Error).message}`);
    return keywordIntent(text);
  }
}
