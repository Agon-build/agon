import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_CLASSIFIER_MODEL, hashChatUser, operatorOwnerRef, parseOwnerRef, resolveStageSettings, telegramOwnerRef,
} from "../../src/agon/stage/settings.ts";

const PEPPER = "p".repeat(40);
const TOKEN = "1234567890:AAH" + "x".repeat(32);
const SECRET = "s".repeat(40);

test("defaults are safe and nothing is reported when nothing is set", () => {
  const { settings, problems } = resolveStageSettings({});
  assert.deepEqual(problems, []);
  assert.equal(settings.siteUrl, "https://agon.surf");
  assert.equal(settings.chatIdPepper, null);
  assert.deepEqual(settings.channelsOff, { web: false, telegram: false, mcp: false });
  assert.equal(settings.providerBlocklist.size, 0);
  assert.equal(settings.classifierModel, DEFAULT_CLASSIFIER_MODEL);
  assert.equal(settings.leadBalanceFloor, 500_000n);
  assert.equal(settings.sellerBalanceFloor, 20_000n);
  assert.equal(settings.alertOperator, null);
  assert.equal(settings.telegram, null);
});

test("off switches, block list and floors are read, bad values fall back and are reported", () => {
  const { settings, problems } = resolveStageSettings({
    AGON_SITE_URL: "https://staging.agon.surf/",
    AGON_CHANNELS_OFF: "telegram, MCP,fax",
    AGON_PROVIDER_BLOCKLIST: "house:Drift, agent:0xABC",
    AGON_LEAD_BALANCE_FLOOR: "-1",
    AGON_SELLER_BALANCE_FLOOR: "30000",
    AGON_ALERT_OPERATOR: `0x${"A".repeat(40)}`,
  });
  assert.equal(settings.siteUrl, "https://staging.agon.surf");
  assert.deepEqual(settings.channelsOff, { web: false, telegram: true, mcp: true });
  assert.deepEqual([...settings.providerBlocklist].sort(), ["agent:0xabc", "house:drift"]);
  assert.equal(settings.leadBalanceFloor, 500_000n);
  assert.equal(settings.sellerBalanceFloor, 30_000n);
  assert.equal(settings.alertOperator, `0x${"a".repeat(40)}`);
  assert.deepEqual(problems, ["AGON_CHANNELS_OFF has an unknown channel: fax", "AGON_LEAD_BALANCE_FLOOR must be a positive whole number of USDC base units"]);
  assert.deepEqual(resolveStageSettings({ AGON_CHANNELS_OFF: "all" }).settings.channelsOff, { web: true, telegram: true, mcp: true });
});

test("a site URL with a path or plain http is refused, except http localhost", () => {
  assert.equal(resolveStageSettings({ AGON_SITE_URL: "https://agon.surf/app" }).settings.siteUrl, "https://agon.surf");
  assert.equal(resolveStageSettings({ AGON_SITE_URL: "http://agon.surf" }).problems.length, 1);
  assert.equal(resolveStageSettings({ AGON_SITE_URL: "http://localhost:3210" }).settings.siteUrl, "http://localhost:3210");
});

test("Telegram needs a token, a webhook secret, a bot username and the chat pepper", () => {
  const ok = resolveStageSettings({
    AGON_TELEGRAM_ENABLED: "true", AGON_TELEGRAM_BOT_TOKEN: TOKEN, AGON_TELEGRAM_WEBHOOK_SECRET: SECRET,
    AGON_TELEGRAM_BOT_USERNAME: "agon_surf_bot", AGON_CHAT_ID_PEPPER: PEPPER,
  });
  assert.deepEqual(ok.problems, []);
  assert.deepEqual(ok.settings.telegram, { botToken: TOKEN, webhookSecret: SECRET, botUsername: "agon_surf_bot" });
  assert.equal(ok.settings.chatIdPepper, PEPPER);

  const bad = resolveStageSettings({ AGON_TELEGRAM_ENABLED: "true", AGON_TELEGRAM_BOT_TOKEN: "nope", AGON_CHAT_ID_PEPPER: "short" });
  assert.equal(bad.settings.telegram, null);
  assert.deepEqual(bad.problems, [
    "AGON_CHAT_ID_PEPPER must be at least 32 characters",
    "AGON_TELEGRAM_BOT_TOKEN is not a Telegram bot token",
    "AGON_TELEGRAM_WEBHOOK_SECRET must be 32 to 256 letters, digits, _ or -",
    "AGON_TELEGRAM_BOT_USERNAME must be a Telegram bot username",
    "Telegram needs AGON_CHAT_ID_PEPPER",
  ]);
});

test("owner references round-trip and chat ids hash with the pepper only", () => {
  assert.equal(operatorOwnerRef(`0x${"B".repeat(40)}`), `op:0x${"b".repeat(40)}`);
  assert.deepEqual(parseOwnerRef(`op:0x${"b".repeat(40)}`), { kind: "operator", address: `0x${"b".repeat(40)}` });
  const h = hashChatUser(PEPPER, "telegram", "123456789");
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(h.includes("123456789"), false);
  assert.notEqual(h, hashChatUser(`${PEPPER}x`, "telegram", "123456789"));
  assert.notEqual(h, hashChatUser(PEPPER, "whatsapp", "123456789"));
  assert.equal(telegramOwnerRef(h), `tg:${h}`);
  assert.deepEqual(parseOwnerRef(`tg:${h}`), { kind: "telegram", userHash: h });
  assert.equal(parseOwnerRef("wa:abc"), null);
  assert.equal(parseOwnerRef("op:0x123"), null);
});
