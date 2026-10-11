import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import { privateKeyToAccount } from "viem/accounts";
import type { Address } from "viem";
import { encodePaymentRequiredHeader, encodePaymentResponseHeader } from "@x402/core/http";

import { buyExact, peekExactTerms, selectExactOption } from "../../src/agon/payments/exact-buyer.ts";
import { exactPayment, type X402Paid } from "../../src/agon/payments/exact-seller.ts";
import { createGuardedSigner } from "../../src/agon/payments/guarded-signer.ts";
import { agonNetwork } from "../../src/agon/network.ts";
import { MemoryPaymentsStore } from "./payments-memory-store.ts";
import { BUYER_KEY, circleSignJson, fakeSettler, localSigner, show } from "./x402-test-helpers.ts";

const buyer = privateKeyToAccount(BUYER_KEY);
const network = agonNetwork("arc-testnet");
const PAY_TO = `0x${"c".repeat(40)}` as Address;

function sellerApp(opts: { price?: bigint; maxTimeoutSeconds?: number } = {}) {
  const store = new MemoryPaymentsStore();
  const settler = fakeSettler();
  const app = new Hono<{ Variables: { x402: X402Paid } }>();
  app.get(
    "/data",
    exactPayment({
      network, payTo: PAY_TO, price: async () => opts.price ?? 2_000n, settle: settler.settle,
      claimNonce: (n, p, nonce) => store.claimSellerNonce(n, p, nonce), description: "BTC price", maxTimeoutSeconds: opts.maxTimeoutSeconds,
    }),
    (c) => c.json({ coins: { "coingecko:bitcoin": { price: 82953.3 } }, payer: c.get("x402").payer }),
  );
  app.get("/free", (c) => c.json({ hello: "world" }));
  app.get("/gateway-only", (c) => {
    const required = {
      x402Version: 2,
      resource: { url: c.req.url, description: "gateway", mimeType: "application/json" },
      accepts: [{ scheme: "exact", network: network.caip2, asset: network.usdc, payTo: PAY_TO, amount: "1000", maxTimeoutSeconds: 604900, extra: { name: "GatewayWalletBatched", version: "1" } }],
    };
    c.header("PAYMENT-REQUIRED", encodePaymentRequiredHeader(required as never));
    return c.json(required, 402);
  });
  const fetchImpl = ((url: string, init?: RequestInit) => app.request(url, init)) as typeof fetch;
  return { fetchImpl, settler };
}

test("peek reads the exact terms without paying", async () => {
  const { fetchImpl, settler } = sellerApp();
  const peek = await peekExactTerms({ url: "http://seller.test/data", network, fetchImpl });
  assert.ok(peek.ok && "option" in peek);
  assert.equal(peek.option.amount, 2_000n);
  assert.equal(peek.option.payTo.toLowerCase(), PAY_TO);
  assert.equal(settler.calls.length, 0);
});

test("buys end to end with the real x402 client and gets the tx hash and data", async () => {
  const { fetchImpl, settler } = sellerApp();
  const out = await buyExact({ url: "http://seller.test/data", network, maxAmount: 2_000n, signerFor: () => localSigner(buyer), fetchImpl });
  assert.ok(out.ok, show(out));
  assert.equal(out.amount, 2_000n);
  assert.equal(out.txHash, `0x${"ab".repeat(32)}`);
  assert.equal((out.data as { coins: Record<string, { price: number }> }).coins["coingecko:bitcoin"]!.price, 82953.3);
  assert.equal(settler.calls.length, 1);
});

test("a price above the buyer's limit is refused before signing", async () => {
  const { fetchImpl, settler } = sellerApp({ price: 3_000n });
  const out = await buyExact({ url: "http://seller.test/data", network, maxAmount: 2_000n, signerFor: () => localSigner(buyer), fetchImpl });
  assert.deepEqual(out.ok ? null : out.code, "price_over_limit");
  assert.equal(settler.calls.length, 0);
});

test("a payee that differs from the quote is refused before signing", async () => {
  const { fetchImpl } = sellerApp();
  const out = await buyExact({ url: "http://seller.test/data", network, maxAmount: 2_000n, expectedPayTo: `0x${"e".repeat(40)}`, signerFor: () => localSigner(buyer), fetchImpl });
  assert.equal(out.ok ? null : out.code, "payee_mismatch");
});

test("guarded signer blocks a swapped payee even if the buyer code is fooled", async () => {
  const { fetchImpl, settler } = sellerApp();
  const out = await buyExact({
    url: "http://seller.test/data", network, maxAmount: 2_000n, fetchImpl,
    signerFor: (opt) =>
      createGuardedSigner({
        address: buyer.address, walletId: "w", signJson: circleSignJson(buyer),
        context: () => ({ network, from: buyer.address, payTo: `0x${"e".repeat(40)}`, maxValue: opt.amount, now: new Date() }),
      }),
  });
  assert.ok(!out.ok && out.code === "signing_refused" && out.detail.includes("payee_not_quoted"), show(out));
  assert.equal(settler.calls.length, 0);
});

test("a long seller timeout is clamped so the guarded signer still signs", async () => {
  const { fetchImpl, settler } = sellerApp({ maxTimeoutSeconds: 3600 });
  const out = await buyExact({
    url: "http://seller.test/data", network, maxAmount: 2_000n, fetchImpl,
    signerFor: (opt) =>
      createGuardedSigner({
        address: buyer.address, walletId: "w", signJson: circleSignJson(buyer),
        context: () => ({ network, from: buyer.address, payTo: opt.payTo, maxValue: opt.amount, now: new Date() }),
      }),
  });
  assert.ok(out.ok, show(out));
  const validFor = Number(settler.calls[0]!.authorization.validBefore) - Math.floor(Date.now() / 1000);
  assert.ok(validFor <= 600 && validFor > 500, String(validFor));
});

test("Gateway-only sellers are not bought from; free endpoints return data at no cost", async () => {
  const { fetchImpl } = sellerApp();
  const gateway = await buyExact({ url: "http://seller.test/gateway-only", network, maxAmount: 10_000n, signerFor: () => localSigner(buyer), fetchImpl });
  assert.equal(gateway.ok ? null : gateway.code, "no_matching_option");
  const free = await buyExact({ url: "http://seller.test/free", network, maxAmount: 10_000n, signerFor: () => localSigner(buyer), fetchImpl });
  assert.ok(free.ok && free.amount === 0n && free.txHash === null);
});

test("a zero-price option is never chosen", () => {
  const accepts = [{ scheme: "exact", network: network.caip2, asset: network.usdc, payTo: PAY_TO, amount: "0", maxTimeoutSeconds: 300, extra: { name: "USDC", version: "2" } }];
  assert.equal(selectExactOption(accepts, network), null);
});

test("a settlement header whose transaction is not a hash is reported as no hash", async () => {
  const { fetchImpl: real } = sellerApp();
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const res = await real(url, init);
    if (res.status === 402) return res;
    const headers = new Headers(res.headers);
    headers.set("PAYMENT-RESPONSE", encodePaymentResponseHeader({ success: true, transaction: "not-a-hash", network: network.caip2, payer: buyer.address } as never));
    return new Response(await res.text(), { status: res.status, headers });
  }) as typeof fetch;
  const out = await buyExact({ url: "http://seller.test/data", network, maxAmount: 2_000n, signerFor: () => localSigner(buyer), fetchImpl });
  assert.ok(out.ok, show(out));
  assert.equal(out.txHash, null);
});

test("failures after the payment was sent are marked sent; failures before signing are not", async () => {
  const { fetchImpl, settler } = sellerApp();
  settler.fail(true);
  const sent = await buyExact({ url: "http://seller.test/data", network, maxAmount: 2_000n, signerFor: () => localSigner(buyer), fetchImpl });
  assert.ok(!sent.ok && sent.code === "paid_request_failed" && sent.sent === true && sent.txHash === null, show(sent));
  const refused = await buyExact({ url: "http://seller.test/data", network, maxAmount: 1_000n, signerFor: () => localSigner(buyer), fetchImpl });
  assert.ok(!refused.ok && refused.code === "price_over_limit" && !refused.sent, show(refused));
});

test("the paid request timeout is configurable and a timeout counts as sent", async () => {
  const { fetchImpl: real } = sellerApp();
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    if (!headers["PAYMENT-SIGNATURE"] && !headers["payment-signature"]) return real(url, init);
    return new Promise<Response>((_resolve, reject) => {
      // AbortSignal.timeout does not hold the event loop open; this timer does.
      const hold = setTimeout(() => {}, 5_000);
      init?.signal?.addEventListener("abort", () => {
        clearTimeout(hold);
        reject(new Error("timed out"));
      });
    });
  }) as typeof fetch;
  const out = await buyExact({ url: "http://seller.test/data", network, maxAmount: 2_000n, signerFor: () => localSigner(buyer), fetchImpl, paidTimeoutMs: 30 });
  assert.ok(!out.ok && out.code === "network_error" && out.sent === true, show(out));
});
