import assert from "node:assert/strict";
import test from "node:test";

import { resolveSeasonSettings } from "../../src/agon/playground/seasons/settings.ts";

const wallets = JSON.stringify({
  atlas: { walletId: "w-atlas", address: "0xAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaa" },
  mirror: { walletId: "w-mirror", address: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
});
const valid = {
  AGON_SEASON_ENABLED: "true",
  AGON_SEASON_ID: "1",
  AGON_SEASON_NETWORK: "arc",
  AGON_SEASON_COMMITS_ADDRESS: "0x1111111111111111111111111111111111111111",
  AGON_SEASON_COMMITTER_WALLET_ID: "w-committer",
  AGON_SEASON_HOUSE_WALLETS: wallets,
  AGON_SEASON_STARTS_AT: "2026-10-20T00:00:00Z",
  AGON_SEASON_ENDS_AT: "2026-11-17T00:00:00+00:00",
};

test("disabled unless AGON_SEASON_ENABLED is exactly true", () => {
  assert.deepEqual(resolveSeasonSettings({}), { enabled: false });
  assert.deepEqual(resolveSeasonSettings({ ...valid, AGON_SEASON_ENABLED: "false" }), { enabled: false });
});

test("a complete env resolves, accepting UTC offsets, and keeps only house agents with wallets", () => {
  const out = resolveSeasonSettings(valid);
  assert.equal(out.enabled, true);
  if (!out.enabled || !out.ok) throw new Error("expected settings");
  assert.equal(out.settings.seasonId, 1n);
  assert.equal(out.settings.network.chainId, 5042);
  assert.equal(out.settings.endsAt.toISOString(), "2026-11-17T00:00:00.000Z");
  assert.equal(out.settings.tickMs, 60_000);
  assert.deepEqual(out.settings.house.map((h) => [h.spec.key, h.walletId, h.address]), [
    ["atlas", "w-atlas", "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
    ["mirror", "w-mirror", "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],
  ]);
});

test("bad or missing values come back as named problems instead of throwing", () => {
  const cases: [Record<string, string>, RegExp][] = [
    [{ AGON_SEASON_HOUSE_WALLETS: "{not json" }, /AGON_SEASON_HOUSE_WALLETS/],
    [{ AGON_SEASON_HOUSE_WALLETS: '{"atlas":{"walletId":"w"}}' }, /AGON_SEASON_HOUSE_WALLETS/],
    [{ AGON_SEASON_HOUSE_MODELS: "nope" }, /AGON_SEASON_HOUSE_MODELS/],
    [{ AGON_SEASON_RPC_HTTP: "http://insecure.example" }, /AGON_SEASON_RPC_HTTP/],
    [{ AGON_SEASON_COMMITS_ADDRESS: "" }, /AGON_SEASON_COMMITS_ADDRESS/],
    [{ AGON_SEASON_NETWORK: "base" }, /AGON_SEASON_NETWORK/],
    [{ AGON_SEASON_STARTS_AT: "yesterday" }, /AGON_SEASON_STARTS_AT/],
    [{ AGON_SEASON_ENDS_AT: "2026-10-19T00:00:00Z" }, /AGON_SEASON_ENDS_AT/],
  ];
  for (const [patch, pattern] of cases) {
    const out = resolveSeasonSettings({ ...valid, ...patch });
    assert.equal(out.enabled, true);
    if (!out.enabled || out.ok) throw new Error(`expected problems for ${JSON.stringify(patch)}`);
    assert.ok(out.problems.some((p) => pattern.test(p)), `${JSON.stringify(patch)} -> ${out.problems.join("; ")}`);
  }
});
