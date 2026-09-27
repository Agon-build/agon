/**
 * Which contract calls the server may sign with a user's Circle wallet.
 *
 * `/wallet/execute` signs on behalf of email-login users, so it must never act
 * as a general signer. Each contract gets an explicit rule:
 *
 * - AGON registry and Arena: allowed, because the route also requires a stored
 *   prepared intent for the exact call.
 * - USDC: `transfer` (the signed-in user's own send and withdraw action) and
 *   `approve` to a known spender contract. `transferFrom`, `permit`, and
 *   allowance changes are refused.
 * - ERC-8004 identity: `register` only. Transfers and approvals are refused.
 * - Legacy ArcRun contracts: their game actions stay available; token and NFT
 *   transfer or approval functions are refused.
 *
 * CLI and agent tokens may sign only the intent-bound AGON calls, so a token
 * handed to a coding agent can never move the wallet's USDC or identities.
 */

type Address = string;

export type WalletExecutePolicy = {
  usdc: string;
  identityRegistry: string | null;
  intentBound: Set<string>;
  usdcSpenders: Set<string>;
  legacy: Set<string>;
};

export type WalletExecuteRequest = {
  client: string | null;
  contractAddress: string;
  abiFunctionSignature: string;
  abiParameters: ReadonlyArray<unknown>;
};

export type WalletExecuteDecision = { ok: true } | { ok: false; status: 400 | 403; message: string };

const ASSET_MOVING_FUNCTIONS = new Set([
  "transfer",
  "transferFrom",
  "safeTransferFrom",
  "approve",
  "setApprovalForAll",
  "permit",
  "increaseAllowance",
  "transferWithAuthorization",
  "receiveWithAuthorization",
]);

const lower = (values: ReadonlyArray<Address>) => new Set(values.map((value) => value.toLowerCase()));

export function createWalletExecutePolicy(input: {
  usdc: Address;
  identityRegistry: Address | null;
  intentBound: ReadonlyArray<Address>;
  usdcSpenders: ReadonlyArray<Address>;
  legacy: ReadonlyArray<Address>;
}): WalletExecutePolicy {
  return {
    usdc: input.usdc.toLowerCase(),
    identityRegistry: input.identityRegistry?.toLowerCase() ?? null,
    intentBound: lower(input.intentBound),
    usdcSpenders: lower(input.usdcSpenders),
    legacy: lower(input.legacy),
  };
}

function refuse(message: string, status: 400 | 403 = 403): WalletExecuteDecision {
  return { ok: false, status, message };
}

export function authorizeWalletExecute(policy: WalletExecutePolicy, request: WalletExecuteRequest): WalletExecuteDecision {
  const contract = request.contractAddress.toLowerCase();
  const signature = request.abiFunctionSignature.replace(/\s+/g, "");
  const functionName = signature.split("(")[0] ?? "";

  const known = policy.intentBound.has(contract) || contract === policy.usdc
    || contract === policy.identityRegistry || policy.legacy.has(contract);
  if (!known) return refuse("This contract is not one AGON signs for.", 400);

  if (request.client !== null) {
    return policy.intentBound.has(contract)
      ? { ok: true }
      : refuse("CLI and agent tokens can only sign prepared AGON listing and Arena actions.");
  }

  if (policy.intentBound.has(contract)) return { ok: true };

  if (contract === policy.usdc) {
    const spender = typeof request.abiParameters[0] === "string" ? request.abiParameters[0].toLowerCase() : "";
    if (signature === "transfer(address,uint256)") return { ok: true };
    if (signature === "approve(address,uint256)" && policy.usdcSpenders.has(spender)) return { ok: true };
    return refuse("AGON only signs USDC sends and approvals to its own contracts.");
  }

  if (contract === policy.identityRegistry) {
    return signature === "register(string)"
      ? { ok: true }
      : refuse("AGON only signs agent identity registration.");
  }

  return ASSET_MOVING_FUNCTIONS.has(functionName)
    ? refuse("AGON does not sign token or NFT transfers and approvals on legacy contracts.")
    : { ok: true };
}
