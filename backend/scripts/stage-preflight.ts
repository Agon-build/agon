// Stage-day pre-flight (spec section 11). Run on the server 30 minutes before
// the pitch: npx tsx scripts/stage-preflight.ts
// Reads keys from the environment only; prints no secrets.
import "dotenv/config";
import { createPublicClient, http, parseAbi, type Address } from "viem";

import { createTelegramApi } from "../src/agon/channels/telegram/api.ts";
import { peekExactTerms } from "../src/agon/payments/exact-buyer.ts";
import { resolvePaymentSettings } from "../src/agon/payments/settings.ts";
import { DEFAULT_HOUSE_AGENTS, houseAgentsFromEnv } from "../src/agon/playground/seasons/house-agents.ts";
import { dataServicesFor } from "../src/agon/router/data-services.ts";
import { formatPreflight, runPreflight, type PreflightDeps } from "../src/agon/stage/preflight.ts";
import { resolveStageSettings } from "../src/agon/stage/settings.ts";
import { callModel } from "../src/runners/llm/client.js";

const BLOCKRUN_PAYTO = "0x634D274e67DafaF76C54153aa113906a606e1E0B" as Address;
const BALANCE_ABI = parseAbi(["function balanceOf(address owner) view returns (uint256)"]);

async function main(): Promise<void> {
  const payments = resolvePaymentSettings(process.env);
  if (!payments.enabled || !payments.ok) throw new Error(`payments are not configured: ${payments.enabled ? payments.problems.join("; ") : "AGON_PAYMENTS_ENABLED is not true"}`);
  const s = payments.settings;
  const { settings: stage, problems } = resolveStageSettings(process.env);
  for (const p of problems) console.error(`stage setting: ${p}`);
  const network = s.network;
  const clients = network.rpcHttp.map((url) => ({ url, client: createPublicClient({ transport: http(url) }) }));
  const read = clients[0]!.client;
  const data = dataServicesFor(network, s.publicApiUrl);
  const peek = (url: string, init?: RequestInit) => async () => {
    const out = await peekExactTerms({ url, init, network });
    if (!out.ok) return { ok: false as const, detail: out.code };
    if (!("option" in out)) return { ok: false as const, detail: "endpoint did not ask for payment" };
    return { ok: true as const, amount: out.option.amount, payTo: out.option.payTo };
  };
  const forecastBody: RequestInit = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ marketId: `0x${"0".repeat(64)}`, question: "Pre-flight price check", endDate: new Date(Date.now() + 86_400_000).toISOString(), notes: [] }) };
  const leadBody: RequestInit = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: "Pre-flight price check for the lead agent" }) };
  const seasonId = process.env.AGON_SEASON_ID ?? "1";
  let houseAgents = DEFAULT_HOUSE_AGENTS;
  try {
    houseAgents = houseAgentsFromEnv(process.env.AGON_SEASON_HOUSE_MODELS);
  } catch (error) {
    console.error(`house models: ${(error as Error).message}; checking the defaults`);
  }
  const off = [
    ...(process.env.AGON_PAYMENTS_OFF ? [`AGON_PAYMENTS_OFF=${process.env.AGON_PAYMENTS_OFF}`] : []),
    ...(process.env.AGON_CHANNELS_OFF ? [`AGON_CHANNELS_OFF=${process.env.AGON_CHANNELS_OFF}`] : []),
    ...(process.env.AGON_PROVIDER_BLOCKLIST ? [`AGON_PROVIDER_BLOCKLIST=${process.env.AGON_PROVIDER_BLOCKLIST}`] : []),
    ...(process.env.AGON_SEASON_COMMITS_OFF === "true" ? ["AGON_SEASON_COMMITS_OFF=true"] : []),
  ];

  const deps: PreflightDeps = {
    now: () => new Date(),
    rpcs: clients.map(({ url, client }) => ({ url, blockNumber: () => client.getBlockNumber() })),
    wallets: [
      { label: "Lead agent", address: s.lead.address, floor: stage.leadBalanceFloor },
      ...Object.entries(s.houseSellers).map(([key, w]) => ({ label: `${key} seller`, address: w.address, floor: stage.sellerBalanceFloor })),
      ...(s.standin ? [{ label: "Testnet stand-in", address: s.standin.address, floor: stage.sellerBalanceFloor }] : []),
    ],
    balanceOf: async (address) => {
      try { return (await read.readContract({ address: network.usdc, abi: BALANCE_ABI, functionName: "balanceOf", args: [address] })) as bigint; } catch { return null; }
    },
    endpoints: [
      { label: `${data.priceLabel} price`, peek: peek(data.price(["coingecko:bitcoin"])), maxAmount: 50_000n, ...(network.id === "arc" ? { expectPayTo: BLOCKRUN_PAYTO } : {}) },
      { label: `${data.searchLabel} market search`, peek: peek(data.marketSearch("bitcoin")), maxAmount: 50_000n, ...(network.id === "arc" ? { expectPayTo: BLOCKRUN_PAYTO } : {}) },
      { label: "Lead agent endpoint", peek: peek(`${s.publicApiUrl}/agon/agents/lead/forecast`, leadBody), expectAmount: s.leadPrice, expectPayTo: s.lead.address },
      ...Object.entries(s.houseSellers).map(([key, w]) => ({ label: `House ${key}`, peek: peek(`${s.publicApiUrl}/agon/agents/house/${key}/forecast`, forecastBody), expectAmount: s.houseAsk, expectPayTo: w.address })),
    ],
    lastCommitAt: async () => {
      const res = await fetch(`${s.publicApiUrl}/agon/seasons/${seasonId}/leaderboard?category=politics`, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`leaderboard ${res.status}`);
      const body = (await res.json()) as { lastCommitAt: string | null };
      return body.lastCommitAt ? new Date(body.lastCommitAt) : null;
    },
    telegram: stage.telegram
      ? async () => {
          const info = await createTelegramApi({ token: stage.telegram!.botToken }).call("getWebhookInfo", {});
          const lastError = typeof info?.last_error_date === "number" ? new Date(info.last_error_date * 1000) : null;
          return { url: typeof info?.url === "string" && info.url ? info.url : null, expectedUrl: `${s.publicApiUrl}/agon/telegram/webhook`, lastErrorAt: lastError };
        }
      : null,
    models: [stage.classifierModel, ...houseAgents.filter((a) => a.model).map((a) => a.model!)].map((model) => ({
      model,
      ping: async () => {
        try { return (await callModel({ model, systemPrompt: "Reply with the word OK.", userPrompt: "OK?", maxTokens: 5, temperature: 0 })).text.length > 0; } catch { return false; }
      },
    })),
    site: async () => (await fetch(`${stage.siteUrl}/`, { signal: AbortSignal.timeout(15_000) })).status,
    offSwitches: off,
  };
  const result = await runPreflight(deps);
  console.log(formatPreflight(result));
  process.exit(result.ready ? 0 : 1);
}

main().catch((error) => {
  console.error((error as Error).message);
  process.exit(1);
});
