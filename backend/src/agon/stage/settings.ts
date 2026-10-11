import { createHmac } from "node:crypto";
import type { Address } from "viem";

export type StageChannel = "web" | "telegram" | "mcp";
export type TelegramSettings = { botToken: string; webhookSecret: string; botUsername: string };
export type StageSettings = {
  siteUrl: string;
  chatIdPepper: string | null;
  channelsOff: Record<StageChannel, boolean>;
  providerBlocklist: ReadonlySet<string>;
  classifierModel: string;
  leadBalanceFloor: bigint;
  sellerBalanceFloor: bigint;
  alertOperator: Address | null;
  telegram: TelegramSettings | null;
};

/// Verified on the OpenRouter model list on 2026-10-11 (Plan 1 house agents).
export const DEFAULT_CLASSIFIER_MODEL = "google/gemini-3.8-flash";
const DEFAULT_SITE_URL = "https://agon.surf";
const CHANNELS: readonly StageChannel[] = ["web", "telegram", "mcp"];

const list = (raw: string | undefined) => (raw ?? "").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
const atomic = (raw: string | undefined, fallback: bigint): bigint | null => {
  if (raw === undefined || raw.trim() === "") return fallback;
  return /^[1-9]\d{0,17}$/.test(raw.trim()) ? BigInt(raw.trim()) : null;
};

/// Reads stage settings without ever throwing. A bad value switches its own
/// feature off or falls back to a safe default and is reported in `problems`;
/// it never stops the service that hosts the channels.
export function resolveStageSettings(env: Record<string, string | undefined>): { settings: StageSettings; problems: string[] } {
  const problems: string[] = [];

  let siteUrl = (env.AGON_SITE_URL ?? DEFAULT_SITE_URL).trim().replace(/\/+$/, "");
  if (!/^https:\/\/[^\s/]+$/.test(siteUrl) && !/^http:\/\/localhost(:\d+)?$/.test(siteUrl)) {
    problems.push("AGON_SITE_URL must be an https origin with no path");
    siteUrl = DEFAULT_SITE_URL;
  }

  const pepperRaw = env.AGON_CHAT_ID_PEPPER ?? "";
  const chatIdPepper = pepperRaw.length >= 32 ? pepperRaw : null;
  if (pepperRaw && !chatIdPepper) problems.push("AGON_CHAT_ID_PEPPER must be at least 32 characters");

  const off = list(env.AGON_CHANNELS_OFF);
  for (const token of off) if (token !== "all" && !CHANNELS.includes(token as StageChannel)) problems.push(`AGON_CHANNELS_OFF has an unknown channel: ${token}`);
  const all = off.includes("all");
  const channelsOff = { web: all || off.includes("web"), telegram: all || off.includes("telegram"), mcp: all || off.includes("mcp") };

  const providerBlocklist: ReadonlySet<string> = new Set(list(env.AGON_PROVIDER_BLOCKLIST));
  const classifierModel = (env.AGON_CLASSIFIER_MODEL ?? "").trim() || DEFAULT_CLASSIFIER_MODEL;

  let leadBalanceFloor = atomic(env.AGON_LEAD_BALANCE_FLOOR, 500_000n);
  if (leadBalanceFloor === null) {
    problems.push("AGON_LEAD_BALANCE_FLOOR must be a positive whole number of USDC base units");
    leadBalanceFloor = 500_000n;
  }
  let sellerBalanceFloor = atomic(env.AGON_SELLER_BALANCE_FLOOR, 20_000n);
  if (sellerBalanceFloor === null) {
    problems.push("AGON_SELLER_BALANCE_FLOOR must be a positive whole number of USDC base units");
    sellerBalanceFloor = 20_000n;
  }

  const operatorRaw = (env.AGON_ALERT_OPERATOR ?? "").trim().toLowerCase();
  const alertOperator = /^0x[0-9a-f]{40}$/.test(operatorRaw) ? (operatorRaw as Address) : null;
  if (operatorRaw && !alertOperator) problems.push("AGON_ALERT_OPERATOR must be an address");

  let telegram: TelegramSettings | null = null;
  if (env.AGON_TELEGRAM_ENABLED === "true") {
    const botToken = (env.AGON_TELEGRAM_BOT_TOKEN ?? "").trim();
    const webhookSecret = (env.AGON_TELEGRAM_WEBHOOK_SECRET ?? "").trim();
    const botUsername = (env.AGON_TELEGRAM_BOT_USERNAME ?? "").trim().replace(/^@/, "");
    const before = problems.length;
    if (!/^\d{6,12}:[A-Za-z0-9_-]{30,}$/.test(botToken)) problems.push("AGON_TELEGRAM_BOT_TOKEN is not a Telegram bot token");
    if (!/^[A-Za-z0-9_-]{32,256}$/.test(webhookSecret)) problems.push("AGON_TELEGRAM_WEBHOOK_SECRET must be 32 to 256 letters, digits, _ or -");
    if (!/^[A-Za-z][A-Za-z0-9_]{3,30}bot$/i.test(botUsername)) problems.push("AGON_TELEGRAM_BOT_USERNAME must be a Telegram bot username");
    if (!chatIdPepper) problems.push("Telegram needs AGON_CHAT_ID_PEPPER");
    if (problems.length === before) telegram = { botToken, webhookSecret, botUsername };
  }

  return {
    settings: { siteUrl, chatIdPepper, channelsOff, providerBlocklist, classifierModel, leadBalanceFloor, sellerBalanceFloor, alertOperator, telegram },
    problems,
  };
}

export const operatorOwnerRef = (address: string) => `op:${address.toLowerCase()}`;
export const telegramOwnerRef = (userHash: string) => `tg:${userHash}`;

export function parseOwnerRef(ownerRef: string): { kind: "operator"; address: Address } | { kind: "telegram"; userHash: string } | null {
  const op = /^op:(0x[0-9a-f]{40})$/.exec(ownerRef);
  if (op) return { kind: "operator", address: op[1] as Address };
  const tg = /^tg:([0-9a-f]{64})$/.exec(ownerRef);
  if (tg) return { kind: "telegram", userHash: tg[1]! };
  return null;
}

/// Chat user ids are kept only as a keyed hash. The channel name is part of
/// the input so one person's Telegram and WhatsApp ids never collide.
export function hashChatUser(pepper: string, channel: "telegram" | "whatsapp", id: string): string {
  return createHmac("sha256", pepper).update(`${channel}:${id}`).digest("hex");
}
