import type { AgentActivity } from "./card-facts.ts";
import { AGON_PREVIEW_MODE } from "./client";
import {
  PREVIEW_JOB_ID, previewApproval, previewAsk, previewRoute, previewRouteQuote, previewConfig, previewEntries, previewLeaderboard, previewLive, previewRatings, previewRounds, previewSeason, previewWallet,
} from "./stage-fixtures.ts";
import type {
  ApprovalResult, ApprovalView, AskResponse, ConfirmResponse, RouteResponse, HistoryItem, LeaderboardResponse, LiveView, RatingsResponse, SeasonEntry, SeasonInfo, SeasonRoundSummary, StageConfig, StageWallet,
} from "./stage-types.ts";

/// Which Season the site shows: 9001 for the testnet dry run, 1 from the mainnet start.
export const AGON_SEASON_ID = (process.env.NEXT_PUBLIC_AGON_SEASON_ID ?? "").trim() || "1";

export const STAGE_API_URL = (process.env.NEXT_PUBLIC_AGON_API_URL ?? process.env.NEXT_PUBLIC_AUTH_URL ?? "http://localhost:8082").replace(/\/+$/, "");

export class StageApiError extends Error {
  code: string;
  status: number;
  /// A message the server wrote for people, when it sent one.
  serverMessage: string | null;
  constructor(code: string, status: number, serverMessage: string | null = null) {
    super(code);
    this.name = "StageApiError";
    this.code = code;
    this.status = status;
    this.serverMessage = serverMessage;
  }
}

/// Stage and Season routes answer { error: "code" }; older Agon routes answer
/// { error: { code } }. Both are read here.
export function stageErrorCode(status: number, body: unknown): string {
  const error = (body as { error?: unknown } | null)?.error;
  if (typeof error === "string" && error) return error;
  if (error && typeof (error as { code?: unknown }).code === "string") return (error as { code: string }).code;
  if (status === 401) return "unauthorized";
  if (status === 404) return "not_found";
  return "request_failed";
}

async function call<T>(path: string, init: { method?: "GET" | "POST" | "DELETE"; body?: unknown; timeoutMs?: number } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${STAGE_API_URL}${path}`, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      credentials: "include",
      cache: "no-store",
      headers: init.body === undefined ? undefined : { "content-type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(init.timeoutMs ?? 15_000),
    });
  } catch {
    throw new StageApiError("network_unavailable", 0);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (body as { message?: unknown } | null)?.message;
    throw new StageApiError(stageErrorCode(res.status, body), res.status, typeof message === "string" ? message : null);
  }
  return body as T;
}

/// The shared Agon API caller (browser session cookie), for other Agon modules.
export const agonCall = call;

const previewStarts = new Map<string, number>();
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function getStageConfig(): Promise<StageConfig> {
  return AGON_PREVIEW_MODE ? previewConfig : call<StageConfig>("/agon/app/config");
}
export async function getWallet(network?: "arc"): Promise<StageWallet> {
  if (AGON_PREVIEW_MODE) return previewWallet;
  return call<StageWallet>(network === "arc" ? "/agon/app/wallet?network=arc" : "/agon/app/wallet");
}
/// The aggregator: Agon reads the request and picks the best agent across Agon and Circle.
export async function routeRequest(request: string): Promise<RouteResponse> {
  if (AGON_PREVIEW_MODE) return previewRoute(request);
  return call<RouteResponse>("/agon/app/route", { body: { request } });
}
/// The person chose this agent on its page: Agon makes the pick card for it, with no routing fee.
export async function routeDirect(reference: string, request: string): Promise<RouteResponse> {
  if (AGON_PREVIEW_MODE) return previewRoute(request);
  return call<RouteResponse>("/agon/app/route/direct", { body: { reference, request } });
}
export async function quoteRoute(routeId: string, reference: string, input?: Record<string, unknown>): Promise<AskResponse> {
  if (AGON_PREVIEW_MODE) return previewRouteQuote(reference);
  return call<AskResponse>("/agon/app/route/quote", { body: { routeId, reference, ...(input ? { input } : {}) } });
}
export type WalletTerms = { version: string; lines: string[]; accepted: boolean };
export async function getTerms(): Promise<WalletTerms> {
  return AGON_PREVIEW_MODE ? { version: "preview", lines: [], accepted: true } : call<WalletTerms>("/agon/app/terms");
}
export async function acceptTerms(version: string): Promise<void> {
  if (!AGON_PREVIEW_MODE) await call("/agon/app/terms", { body: { version } });
}
export async function askLead(question: string, maxPrice?: string): Promise<AskResponse> {
  if (AGON_PREVIEW_MODE) return previewAsk(question);
  return call<AskResponse>("/agon/app/ask", { body: { question, ...(maxPrice ? { maxPrice } : {}) } });
}
/// Paying runs the whole job on the server, so it can take minutes.
export async function confirmHire(jobId: string, code: string): Promise<ConfirmResponse> {
  if (AGON_PREVIEW_MODE) {
    previewStarts.set(jobId, Date.now());
    await wait(9_500);
    return { ok: true, jobId, amount: "0.30", txHash: `0x${"1".repeat(64)}` };
  }
  return call<ConfirmResponse>(`/agon/app/hires/${encodeURIComponent(jobId)}/confirm`, { body: { code }, timeoutMs: 200_000 });
}
export async function getLive(jobId: string): Promise<LiveView> {
  if (AGON_PREVIEW_MODE) return previewLive(jobId === PREVIEW_JOB_ID ? jobId : PREVIEW_JOB_ID, previewStarts.get(jobId) ?? null, Date.now());
  return call<LiveView>(`/agon/app/live/${encodeURIComponent(jobId)}`);
}
/// One page of the signed-in account's hires, newest first.
/// Where finished work is sent: email (masked) and the AGON bot on Telegram.
export type DeliverySettings = { email: { on: boolean; address: string | null }; telegram: { available: boolean; connected: boolean } };
export async function getDeliveries(): Promise<DeliverySettings> {
  if (AGON_PREVIEW_MODE) return { email: { on: true, address: "yo***@example.com" }, telegram: { available: true, connected: false } };
  return call<DeliverySettings>("/agon/app/deliveries");
}
/// A one-time link that opens the AGON bot and connects this account's chat.
export async function connectTelegram(): Promise<{ url: string }> {
  return call<{ url: string }>("/agon/app/deliveries/telegram", { body: {} });
}
export async function disconnectTelegram(): Promise<void> {
  await call("/agon/app/deliveries/telegram", { method: "DELETE" });
}
export async function getHistory(page = 1, limit = 10): Promise<{ items: HistoryItem[]; page: number; hasMore: boolean }> {
  if (AGON_PREVIEW_MODE) return { page, hasMore: false, items: page > 1 ? [] : [{ jobId: PREVIEW_JOB_ID, question: "What's the real chance BTC closes above $120k on Friday?", state: "delivered", price: "0.30", createdAt: new Date().toISOString(), receiptUrl: `/r/${PREVIEW_JOB_ID}` }] };
  return call(`/agon/app/history?page=${page}&limit=${limit}`);
}
export async function lowerLimits(input: { perHire?: string; daily?: string }): Promise<{ ok: boolean; code?: string }> {
  return AGON_PREVIEW_MODE ? { ok: true } : call("/agon/app/wallet/limits", { body: input });
}
export async function freezeWallet(): Promise<{ frozen: boolean }> {
  return AGON_PREVIEW_MODE ? { frozen: true } : call("/agon/app/wallet/freeze", { body: {} });
}
export async function requestUnfreeze(): Promise<{ approvalUrl: string; expiresAt: string }> {
  return AGON_PREVIEW_MODE ? { approvalUrl: "/approve?t=preview", expiresAt: new Date(Date.now() + 900_000).toISOString() } : call("/agon/app/wallet/unfreeze", { body: {} });
}
export async function requestWithdraw(to: string, amount: string): Promise<{ ok: boolean; approvalUrl?: string; code?: string }> {
  return AGON_PREVIEW_MODE ? { ok: true, approvalUrl: "/approve?t=preview" } : call("/agon/app/wallet/withdraw", { body: { to, amount } });
}
export async function getApproval(token: string): Promise<{ approval: ApprovalView }> {
  return AGON_PREVIEW_MODE ? { approval: previewApproval } : call(`/agon/approvals/${encodeURIComponent(token)}`);
}
export async function approve(token: string): Promise<ApprovalResult> {
  if (AGON_PREVIEW_MODE) {
    previewStarts.set(PREVIEW_JOB_ID, Date.now());
    return { action: "over_limit_hire", ok: true, jobId: PREVIEW_JOB_ID };
  }
  return call(`/agon/approvals/${encodeURIComponent(token)}`, { body: {}, timeoutMs: 200_000 });
}
export async function getSeason(seasonId = AGON_SEASON_ID): Promise<SeasonInfo> {
  return AGON_PREVIEW_MODE ? previewSeason : call(`/agon/seasons/${seasonId}`);
}
export async function getLeaderboard(seasonId = AGON_SEASON_ID, category?: string): Promise<LeaderboardResponse> {
  const query = category && category !== "overall" ? `?category=${encodeURIComponent(category)}` : "";
  return AGON_PREVIEW_MODE ? previewLeaderboard : call(`/agon/seasons/${seasonId}/leaderboard${query}`);
}
export async function getRatings(seasonId = AGON_SEASON_ID): Promise<RatingsResponse> {
  return AGON_PREVIEW_MODE ? previewRatings : call(`/agon/seasons/${seasonId}/ratings`);
}
/// Delivered jobs for Agon's own agents, keyed by ERC-8004 id.
export async function getAgentActivity(): Promise<{ network: string; agents: Record<string, AgentActivity> }> {
  return AGON_PREVIEW_MODE ? { network: "arc-testnet", agents: {} } : call("/agon/agents/activity");
}
export async function getEntries(seasonId = AGON_SEASON_ID): Promise<{ entries: SeasonEntry[] }> {
  return AGON_PREVIEW_MODE ? { entries: previewEntries } : call(`/agon/seasons/${seasonId}/entries`);
}
export async function getRounds(seasonId = AGON_SEASON_ID, limit = 8): Promise<{ rounds: SeasonRoundSummary[] }> {
  return AGON_PREVIEW_MODE ? { rounds: previewRounds } : call(`/agon/seasons/${seasonId}/rounds?limit=${limit}`);
}
