import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import { privateKeyToAccount } from "viem/accounts";
import { parseSignature, type Address, type Hex } from "viem";
import { decodePaymentRequiredHeader, decodePaymentResponseHeader } from "@x402/core/http";

import { createCircleExactSettler, exactPayment, type X402Paid } from "../../src/agon/payments/exact-seller.ts";
import { stableUuid } from "../../src/agon/playground/seasons/committer.ts";
import { agonNetwork } from "../../src/agon/network.ts";
import { MemoryPaymentsStore } from "./payments-memory-store.ts";
import { BUYER_KEY, OTHER_KEY, fakeSettler, signedPaymentHeader } from "./x402-test-helpers.ts";

const buyer = privateKeyToAccount(BUYER_KEY);
const other = privateKeyToAccount(OTHER_KEY);
const network = agonNetwork("arc-testnet");
const PAY_TO = `0x${"c".repeat(40)}` as Address;
const terms = { network, payTo: PAY_TO, amount: 2_000n };

function seller(opts: { beforeSettle?: (p: unknown) => Promise<string | null>; maxTimeoutSeconds?: number; log?: (m: string) => void } = {}) {
  const store = new MemoryPaymentsStore();
  const settler = fakeSettler();
  let handled = 0;
  const app = new Hono<{ Variables: { x402: X402Paid } }>();
  app.post(
    "/paid",
    exactPayment({
      network, payTo: PAY_TO, price: async () => 2_000n, settle: settler.settle,
      claimNonce: (n, payer, nonce) => store.claimSellerNonce(n, payer, nonce),
      description: "Test data", beforeSettle: opts.beforeSettle as never, maxTimeoutSeconds: opts.maxTimeoutSeconds, log: opts.log,
    }),
    (c) => {
      handled += 1;
      return c.json({ ok: true, payer: c.get("x402").payer });
    },
  );
  return { app, settler, handled: () => handled };
}

const post = (app: Hono<never>, header?: string) =>
  app.request("http://seller.test/paid", { method: "POST", headers: header ? { "PAYMENT-SIGNATURE": header } : {} });

test("an unpaid request gets a 402 with the exact USDC terms in the header and body", async () => {
  const { app } = seller();
  const res = await post(app as never);
  assert.equal(res.status, 402);
  const required = decodePaymentRequiredHeader(res.headers.get("PAYMENT-REQUIRED")!) as unknown as { x402Version: number; accepts: Record<string, unknown>[] };
  assert.equal(required.x402Version, 2);
  assert.deepEqual(required.accepts[0], {
    scheme: "exact", network: "eip155:5042002", asset: "0x3600000000000000000000000000000000000000", payTo: PAY_TO, amount: "2000",
    maxTimeoutSeconds: 600, extra: { name: "USDC", version: "2", assetTransferMethod: "eip3009" },
  });
  const body = (await res.json()) as { accepts: unknown[] };
  assert.equal(body.accepts.length, 1);
});

test("a valid payment settles once, runs the handler, and returns PAYMENT-RESPONSE", async () => {
  const { app, settler, handled } = seller();
  const res = await post(app as never, await signedPaymentHeader(buyer, terms));
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as { payer: string }).payer, buyer.address.toLowerCase());
  assert.equal(settler.calls.length, 1);
  assert.equal(settler.calls[0]!.amount, 2_000n);
  const settled = decodePaymentResponseHeader(res.headers.get("PAYMENT-RESPONSE")!) as unknown as { success: boolean; transaction: string; payer: string };
  assert.equal(settled.success, true);
  assert.equal(settled.transaction, `0x${"ab".repeat(32)}`);
  assert.equal(handled(), 1);
});

test("replayed payment is refused and never settles twice", async () => {
  const { app, settler } = seller();
  const header = await signedPaymentHeader(buyer, terms);
  assert.equal((await post(app as never, header)).status, 200);
  const replay = await post(app as never, header);
  assert.equal(replay.status, 402);
  assert.equal(((await replay.json()) as { error: string }).error, "nonce_used");
  assert.equal(settler.calls.length, 1);
});

test("each broken payment is refused with a reason and nothing settles", async () => {
  const cases: [Promise<string>, string][] = [
    [signedPaymentHeader(buyer, terms, { to: `0x${"d".repeat(40)}` }), "wrong_payee"],
    [signedPaymentHeader(buyer, terms, { value: 1_999n }), "underpaid"],
    [signedPaymentHeader(buyer, terms, { acceptedAmount: 1n }), "terms_mismatch"],
    [signedPaymentHeader(buyer, terms, { validitySeconds: 5 }), "expires_too_soon"],
    [signedPaymentHeader(buyer, terms, { validitySeconds: 7200 }), "validity_too_long"],
    [signedPaymentHeader(buyer, terms, { validAfter: BigInt(Math.floor(Date.now() / 1000) + 600) }), "not_yet_valid"],
    [signedPaymentHeader(buyer, terms, { signer: other }), "bad_signature"],
    [signedPaymentHeader(buyer, terms, { chainId: 5042 }), "bad_signature"],
  ];
  for (const [headerPromise, reason] of cases) {
    const { app, settler, handled } = seller();
    const res = await post(app as never, await headerPromise);
    assert.equal(res.status, 402, reason);
    assert.equal(((await res.json()) as { error: string }).error, reason);
    assert.equal(settler.calls.length, 0, reason);
    assert.equal(handled(), 0, reason);
  }
  const { app } = seller();
  assert.equal(((await (await post(app as never, "not-base64-json")).json()) as { error: string }).error, "invalid_payment_header");
});

test("beforeSettle can refuse a payment before money moves", async () => {
  const { app, settler } = seller({ beforeSettle: async () => "quote_invalid" });
  const res = await post(app as never, await signedPaymentHeader(buyer, terms));
  assert.equal(((await res.json()) as { error: string }).error, "quote_invalid");
  assert.equal(settler.calls.length, 0);
});

test("a settlement failure returns 402 and the handler never runs", async () => {
  const { app, settler, handled } = seller();
  settler.fail(true);
  const res = await post(app as never, await signedPaymentHeader(buyer, terms));
  assert.equal(((await res.json()) as { error: string }).error, "settlement_failed");
  assert.equal(handled(), 0);
});

test("a settlement failure is logged with the seller wallet and the reason, so an unfunded seller is visible", async () => {
  const lines: string[] = [];
  const { app, settler } = seller({ log: (m) => lines.push(m) });
  settler.fail(true);
  await post(app as never, await signedPaymentHeader(buyer, terms));
  assert.equal(lines.length, 1);
  assert.match(lines[0]!, new RegExp(PAY_TO, "i"));
  assert.match(lines[0]!, /settlement failed/);
});

test("the Circle settler calls transferWithAuthorization with split v, r, s and an idempotency key bound to payee, payer and nonce", async () => {
  const calls: { abiFunctionSignature: string; abiParameters: string[]; idempotencyKey: string; contractAddress: string }[] = [];
  const states = ["INITIATED", "CONFIRMED"];
  const settle = createCircleExactSettler({
    walletId: "w-seller",
    network,
    execute: async (input) => {
      calls.push(input);
      return { id: "c-1", state: "INITIATED" };
    },
    getTxState: async () => {
      const s = states.shift() ?? "CONFIRMED";
      return { state: s, txHash: s === "CONFIRMED" ? `0x${"12".repeat(32)}` : null };
    },
    pollMs: 1,
    sleep: async () => {},
  });
  const signature = (await buyer.signMessage({ message: "x" })) as Hex;
  const nonce = `0x${"77".repeat(32)}` as Hex;
  const tx = await settle({
    payer: buyer.address, amount: 2_000n, signature,
    authorization: { from: buyer.address, to: PAY_TO, value: "2000", validAfter: "0", validBefore: "1900000000", nonce },
  });
  assert.equal(tx, `0x${"12".repeat(32)}`);
  const parts = parseSignature(signature);
  const v = parts.v ?? (parts.yParity === 1 ? 28n : 27n);
  assert.deepEqual(calls[0], {
    walletId: "w-seller",
    contractAddress: network.usdc,
    abiFunctionSignature: "transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)",
    abiParameters: [buyer.address, PAY_TO, "2000", "0", "1900000000", nonce, v.toString(), parts.r, parts.s],
    refId: `agon-x402-${stableUuid(`settle:${network.id}:${PAY_TO.toLowerCase()}:${buyer.address.toLowerCase()}:${nonce}`)}`,
    idempotencyKey: stableUuid(`settle:${network.id}:${PAY_TO.toLowerCase()}:${buyer.address.toLowerCase()}:${nonce}`),
  });
});

test("another payer reusing a settled nonce gets its own Circle request, never the earlier settlement", async () => {
  const keys: string[] = [];
  const refIds: string[] = [];
  const settle = createCircleExactSettler({
    walletId: "w-seller",
    network,
    execute: async (input) => {
      keys.push(input.idempotencyKey);
      refIds.push(input.refId);
      return { id: `c-${keys.length}`, state: "INITIATED" };
    },
    getTxState: async () => ({ state: "CONFIRMED", txHash: `0x${"12".repeat(32)}` }),
    pollMs: 1,
    sleep: async () => {},
  });
  const signature = (await buyer.signMessage({ message: "x" })) as Hex;
  const nonce = `0x${"77".repeat(32)}` as Hex;
  for (const from of [buyer.address, other.address]) {
    await settle({ payer: from, amount: 2_000n, signature, authorization: { from, to: PAY_TO, value: "2000", validAfter: "0", validBefore: "1900000000", nonce } });
  }
  assert.notEqual(keys[0], keys[1]);
  assert.notEqual(refIds[0], refIds[1]);
});

test("the Circle settler keeps polling through a transient status error", async () => {
  let polls = 0;
  const settle = createCircleExactSettler({
    walletId: "w-seller",
    network,
    execute: async () => ({ id: "c-1", state: "INITIATED" }),
    getTxState: async () => {
      polls += 1;
      if (polls === 1) throw new Error("circle 503");
      return { state: "CONFIRMED", txHash: `0x${"12".repeat(32)}` };
    },
    pollMs: 1,
    sleep: async () => {},
  });
  const signature = (await buyer.signMessage({ message: "x" })) as Hex;
  const tx = await settle({
    payer: buyer.address, amount: 2_000n, signature,
    authorization: { from: buyer.address, to: PAY_TO, value: "2000", validAfter: "0", validBefore: "1900000000", nonce: `0x${"78".repeat(32)}` },
  });
  assert.equal(tx, `0x${"12".repeat(32)}`);
});
