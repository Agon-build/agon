import type { ClientEvmSigner } from "@x402/evm";
import type { Address, Hex } from "viem";

import { checkTransferAuthorization, type SigningContext, type SigningRefusal, type TypedDataInput } from "./signing-policy.ts";

export class SigningRefusedError extends Error {
  code: SigningRefusal;

  constructor(code: SigningRefusal) {
    super(`signing refused: ${code}`);
    this.name = "SigningRefusedError";
    this.code = code;
  }
}

const DOMAIN_FIELDS: [string, string][] = [
  ["name", "string"],
  ["version", "string"],
  ["chainId", "uint256"],
  ["verifyingContract", "address"],
];

/// An x402 client signer whose every signature passes the signing policy
/// first. The Circle wallet only ever sees documents this function approved.
export function createGuardedSigner(input: {
  address: Address;
  walletId: string;
  signJson: (walletId: string, json: string) => Promise<Hex>;
  context: () => SigningContext;
  onSigned?: (message: Record<string, unknown>) => void | Promise<void>;
}): ClientEvmSigner {
  return {
    address: input.address,
    async signTypedData(td) {
      const typed = td as unknown as TypedDataInput;
      const check = checkTransferAuthorization(typed, input.context());
      if (!check.ok) throw new SigningRefusedError(check.code);
      const domainTypes = DOMAIN_FIELDS.filter(([name]) => typed.domain[name] !== undefined).map(([name, type]) => ({ name, type }));
      const json = JSON.stringify(
        { types: { EIP712Domain: domainTypes, ...typed.types }, domain: typed.domain, primaryType: typed.primaryType, message: typed.message },
        (_key, value) => (typeof value === "bigint" ? value.toString() : value),
      );
      const signature = await input.signJson(input.walletId, json);
      await input.onSigned?.(typed.message);
      return signature;
    },
  };
}
