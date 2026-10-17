import assert from "node:assert/strict";
import test from "node:test";

import { resolvePaymentSettings } from "../../src/agon/payments/settings.ts";

const handle = (id: string, hex: string) => JSON.stringify({ walletId: id, address: `0x${hex.repeat(40)}` });
const valid = {
  AGON_PAYMENTS_ENABLED: "true",
  AGON_PAYMENT_NETWORK: "arc-testnet",
  AGON_PUBLIC_API_URL: "https://api.agon.surf",
  AGON_LEAD_WALLET: handle("w-lead", "a"),
  AGON_STANDIN_SELLER_WALLET: handle("w-standin", "b"),
  AGON_HOUSE_SELLER_WALLETS: JSON.stringify({ atlas: { walletId: "w-atlas", address: `0x${"c".repeat(40)}` } }),
};

test("disabled unless AGON_PAYMENTS_ENABLED is exactly true", () => {
  assert.deepEqual(resolvePaymentSettings({}), { enabled: false });
  assert.deepEqual(resolvePaymentSettings({ ...valid, AGON_PAYMENTS_ENABLED: "1" }), { enabled: false });
});

test("a complete testnet env resolves with the spec defaults", () => {
  const out = resolvePaymentSettings(valid);
  if (!out.enabled || !out.ok) throw new Error(JSON.stringify(out));
  const s = out.settings;
  assert.equal(s.network.id, "arc-testnet");
  assert.equal(s.publicApiUrl, "https://api.agon.surf");
  assert.equal(s.lead.address, `0x${"a".repeat(40)}`);
  assert.equal(s.standin!.walletId, "w-standin");
  assert.deepEqual(Object.keys(s.houseSellers), ["atlas"]);
  assert.equal(s.leadPrice, 300_000n);
  assert.equal(s.subHireBudget, 250_000n);
  assert.equal(s.houseAsk, 220_000n);
  assert.equal(s.houseFloor, 160_000n);
  assert.deepEqual(s.off, { all: false, budget: false, lead: false });
});

test("mainnet does not need a stand-in seller; off switches parse", () => {
  const out = resolvePaymentSettings({ ...valid, AGON_PAYMENT_NETWORK: "arc", AGON_STANDIN_SELLER_WALLET: "", AGON_PAYMENTS_OFF: "budget, lead" });
  if (!out.enabled || !out.ok) throw new Error(JSON.stringify(out));
  assert.equal(out.settings.standin, null);
  assert.deepEqual(out.settings.off, { all: false, budget: true, lead: true });
});

test("bad values come back as named problems instead of throwing", () => {
  const cases: [Record<string, string>, RegExp][] = [
    [{ AGON_PAYMENT_NETWORK: "base" }, /AGON_PAYMENT_NETWORK/],
    [{ AGON_PUBLIC_API_URL: "http://api.agon.surf" }, /AGON_PUBLIC_API_URL/],
    [{ AGON_LEAD_WALLET: "{bad" }, /AGON_LEAD_WALLET/],
    [{ AGON_STANDIN_SELLER_WALLET: "" }, /AGON_STANDIN_SELLER_WALLET/],
    [{ AGON_HOUSE_SELLER_WALLETS: JSON.stringify({ mirror: { walletId: "w", address: `0x${"d".repeat(40)}` } }) }, /AGON_HOUSE_SELLER_WALLETS/],
    [{ AGON_LEAD_SUBHIRE_BUDGET: "400000" }, /AGON_LEAD_SUBHIRE_BUDGET/],
    [{ AGON_HOUSE_FLOOR: "300000" }, /AGON_HOUSE_FLOOR/],
    [{ AGON_LEAD_PRICE: "-1" }, /AGON_LEAD_PRICE/],
    [{ AGON_PAYMENTS_OFF: "everything" }, /AGON_PAYMENTS_OFF/],
  ];
  for (const [patch, pattern] of cases) {
    const out = resolvePaymentSettings({ ...valid, ...patch });
    if (!out.enabled || out.ok) throw new Error(`expected problems for ${JSON.stringify(patch)}`);
    assert.ok(out.problems.some((p) => pattern.test(p)), `${JSON.stringify(patch)} -> ${out.problems.join("; ")}`);
  }
});

test("specialist agent wallets are optional; only pitch and scout are accepted", () => {
  const none = resolvePaymentSettings(valid);
  if (!none.enabled || !none.ok) throw new Error(JSON.stringify(none));
  assert.deepEqual(none.settings.specialistSellers, {});
  const both = resolvePaymentSettings({ ...valid, AGON_SPECIALIST_WALLETS: JSON.stringify({ pitch: { walletId: "w-pitch", address: `0x${"D".repeat(40)}` }, scout: { walletId: "w-scout", address: `0x${"e".repeat(40)}` } }) });
  if (!both.enabled || !both.ok) throw new Error(JSON.stringify(both));
  assert.equal(both.settings.specialistSellers.pitch!.address, `0x${"d".repeat(40)}`);
  assert.equal(both.settings.specialistSellers.scout!.walletId, "w-scout");
  const bad = resolvePaymentSettings({ ...valid, AGON_SPECIALIST_WALLETS: JSON.stringify({ striker: { walletId: "w", address: `0x${"d".repeat(40)}` } }) });
  assert.ok(bad.enabled && !bad.ok && bad.problems.some((p) => p.includes("AGON_SPECIALIST_WALLETS")));
});
