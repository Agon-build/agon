import assert from "node:assert/strict";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import { verifyTypedData, type Address } from "viem";

import { checkTransferAuthorization, type SigningContext } from "../../src/agon/payments/signing-policy.ts";
import { SigningRefusedError, createGuardedSigner } from "../../src/agon/payments/guarded-signer.ts";
import { agonNetwork } from "../../src/agon/network.ts";
import { BUYER_KEY, authorizationTypedData, circleSignJson } from "./x402-test-helpers.ts";

const buyer = privateKeyToAccount(BUYER_KEY);
const network = agonNetwork("arc");
const PAYEE = "0x634d274e67dafaf76c54153aa113906a606e1e0b" as Address;
const now = new Date("2026-10-27T12:00:00Z");
const nowSec = BigInt(Math.floor(now.getTime() / 1000));
const ctx: SigningContext = { network, from: buyer.address, payTo: PAYEE, maxValue: 2_000n, now };
const td = (o: Partial<Parameters<typeof authorizationTypedData>[0]> = {}) =>
  authorizationTypedData({ network, from: buyer.address, to: PAYEE, value: 2_000n, validBefore: nowSec + 300n, ...o });

test("a quoted authorization within limits is allowed", () => {
  assert.deepEqual(checkTransferAuthorization(td(), ctx), { ok: true });
  assert.deepEqual(checkTransferAuthorization(td({ to: PAYEE.toUpperCase().replace("0X", "0x") as Address }), ctx), { ok: true });
});

test("every refusal is named", () => {
  const cases: [ReturnType<typeof td>, string][] = [
    [{ ...td(), primaryType: "Permit" }, "not_transfer_authorization"],
    [{ ...td(), types: { TransferWithAuthorization: [{ name: "from", type: "address" }] } }, "not_transfer_authorization"],
    [td({ domainOverrides: { name: "Not USDC" } }), "wrong_domain"],
    [td({ domainOverrides: { chainId: 5_042_002 } }), "wrong_domain"],
    [td({ domainOverrides: { verifyingContract: "0x1111111111111111111111111111111111111111" } }), "wrong_domain"],
    [td({ from: "0x2222222222222222222222222222222222222222" }), "wrong_from"],
    [td({ to: "0x3333333333333333333333333333333333333333" }), "payee_not_quoted"],
    [td({ value: 2_001n }), "over_limit"],
    [td({ value: 0n }), "over_limit"],
    [td({ validAfter: nowSec + 60n }), "not_yet_valid"],
    [td({ validBefore: nowSec }), "expired"],
    [td({ validBefore: nowSec + 601n }), "validity_too_long"],
  ];
  for (const [input, code] of cases) assert.deepEqual(checkTransferAuthorization(input, ctx), { ok: false, code }, code);
});

test("malformed integers are refused, not thrown", () => {
  const bad = td();
  bad.message.value = "lots";
  assert.deepEqual(checkTransferAuthorization(bad, ctx), { ok: false, code: "not_transfer_authorization" });
});

test("the guarded signer refuses before Circle is called", async () => {
  let calls = 0;
  const signer = createGuardedSigner({
    address: buyer.address,
    walletId: "w-1",
    signJson: async () => {
      calls += 1;
      return "0x00";
    },
    context: () => ctx,
  });
  await assert.rejects(() => signer.signTypedData(td({ to: "0x3333333333333333333333333333333333333333" }) as never), (e) => e instanceof SigningRefusedError && e.code === "payee_not_quoted");
  assert.equal(calls, 0);
});

test("the guarded signer sends Circle a faithful EIP-712 document and reports the signed message", async () => {
  const seen: Record<string, unknown>[] = [];
  const signer = createGuardedSigner({
    address: buyer.address,
    walletId: "w-1",
    signJson: circleSignJson(buyer),
    context: () => ctx,
    onSigned: (m) => {
      seen.push(m);
    },
  });
  const input = td();
  const signature = await signer.signTypedData(input as never);
  const valid = await verifyTypedData({ address: buyer.address, domain: input.domain as never, types: input.types as never, primaryType: "TransferWithAuthorization", message: input.message as never, signature });
  assert.equal(valid, true);
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.nonce, input.message.nonce);
});
