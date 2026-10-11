import assert from "node:assert/strict";
import test from "node:test";
import type { Address } from "viem";

import { formatPreflight, runPreflight, type PreflightDeps } from "../../src/agon/stage/preflight.ts";

const NOW = new Date("2026-11-03T07:30:00Z");
const PAYTO = "0x634d274e67dafaf76c54153aa113906a606e1e0b" as Address;

function healthy(): PreflightDeps {
  return {
    now: () => NOW,
    rpcs: [{ url: "https://rpc.mainnet.arc.io", blockNumber: async () => 123n }],
    wallets: [{ label: "Lead agent", address: `0x${"c".repeat(40)}` as Address, floor: 500_000n }],
    balanceOf: async () => 1_000_000n,
    endpoints: [
      { label: "BlockRun price", peek: async () => ({ ok: true, amount: 2_000n, payTo: PAYTO }), expectPayTo: PAYTO, maxAmount: 50_000n },
      { label: "Lead agent endpoint", peek: async () => ({ ok: true, amount: 300_000n, payTo: `0x${"c".repeat(40)}` as Address }), expectAmount: 300_000n },
    ],
    lastCommitAt: async () => new Date(NOW.getTime() - 2 * 3_600_000),
    telegram: async () => ({ url: "https://api.agon.surf/agon/telegram/webhook", expectedUrl: "https://api.agon.surf/agon/telegram/webhook", lastErrorAt: null }),
    models: [{ model: "google/gemini-3.8-flash", ping: async () => true }],
    site: async () => 200,
    offSwitches: [],
  };
}

test("a healthy stage is ready and every check passes", async () => {
  const result = await runPreflight(healthy());
  assert.equal(result.ready, true);
  assert.ok(result.checks.every((c) => c.status === "pass"), formatPreflight(result));
  assert.match(formatPreflight(result), /READY$/);
});

test("each failure is named and makes the stage not ready", async () => {
  const deps = healthy();
  deps.rpcs = [{ url: "https://rpc.mainnet.arc.io", blockNumber: async () => { throw new Error("timeout"); } }];
  deps.balanceOf = async () => 100_000n;
  deps.endpoints[0]!.peek = async () => ({ ok: true, amount: 2_000n, payTo: `0x${"1".repeat(40)}` as Address });
  deps.endpoints[1]!.peek = async () => ({ ok: false, detail: "network_error" });
  deps.lastCommitAt = async () => new Date(NOW.getTime() - 7 * 3_600_000);
  deps.telegram = async () => ({ url: null, expectedUrl: "https://api.agon.surf/agon/telegram/webhook", lastErrorAt: null });
  deps.models[0]!.ping = async () => false;
  deps.site = async () => 502;
  deps.offSwitches = ["AGON_CHANNELS_OFF=telegram"];
  const result = await runPreflight(deps);
  assert.equal(result.ready, false);
  const byName = Object.fromEntries(result.checks.map((c) => [c.name, c.status]));
  assert.deepEqual(byName, {
    "RPC https://rpc.mainnet.arc.io": "fail", "Wallet Lead agent": "fail", "BlockRun price": "fail", "Lead agent endpoint": "fail",
    "Leaderboard": "fail", "Telegram webhook": "fail", "Model google/gemini-3.8-flash": "fail", "Site /ask": "fail", "Off switches": "warn",
  });
  assert.match(formatPreflight(result), /NOT READY$/);
});
