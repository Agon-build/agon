import { getAddress, parseAbi } from "viem";

const listingVerifierAbi = parseAbi([
  "function VERIFIER_ROLE() view returns (bytes32)",
  "function hasRole(bytes32 role,address account) view returns (bool)",
  "function verificationScopeSupported() view returns (bool)",
  "function getListing(uint256 id) view returns ((uint256 listingId,uint256 agentId,bytes32 serviceKey,bytes32 manifestHash,string manifestURI,uint256 category,uint8 paymentRail,uint256 version,address providerSnapshot,uint8 status,uint8 verification,uint64 createdAt,uint64 updatedAt))",
  "function setVerificationForVersion(uint256 id,uint256 expectedVersion,bytes32 expectedManifestHash,uint8 verification)",
]);

export type AgonListingVerifierReadClient = {
  readContract(input: {
    address: `0x${string}`;
    abi: readonly unknown[];
    functionName: "VERIFIER_ROLE" | "hasRole" | "verificationScopeSupported" | "getListing";
    args?: readonly unknown[];
  }): Promise<unknown>;
  waitForTransactionReceipt(input: { hash: `0x${string}`; timeout?: number }): Promise<{ status: "success" | "reverted" }>;
};

export type AgonListingVerifierWallet = {
  writeContract(input: {
    address: `0x${string}`;
    abi: readonly unknown[];
    functionName: "setVerificationForVersion";
    args: readonly [bigint, bigint, `0x${string}`, number];
  }): Promise<`0x${string}`>;
};

export type AgonListingVerificationRequest = {
  listingId: string;
  agentId: string;
  listingVersion: string;
  manifestHash: `0x${string}`;
  priorTransactionHash?: `0x${string}`;
  /** True when the certification cycle itself suspended this version and it has since passed again. Then, and only then, a Suspended listing is promoted. */
  liftOwnSuspension?: boolean;
  onSubmitted?: (transactionHash: `0x${string}`) => Promise<void>;
};

export type AgonListingVerificationResult = {
  status: "confirmed" | "already_verified" | "already_suspended";
  transactionHash: `0x${string}` | null;
};

export type AgonListingVerifierAdapter = {
  readonly enabled: boolean;
  verify(input: AgonListingVerificationRequest): Promise<AgonListingVerificationResult>;
  suspend(input: AgonListingVerificationRequest): Promise<AgonListingVerificationResult>;
};

export type AgonListingVerifierReadiness = {
  enabled: boolean;
  registryAddress: `0x${string}`;
  verifierAddress: `0x${string}` | null;
  role: `0x${string}` | null;
  assigned: boolean;
  reason: "assigned" | "verifier_not_configured" | "role_not_assigned" | "scoped_verification_unsupported" | "read_failed" | "disabled";
};

export class AgonListingVerificationError extends Error {
  readonly code: "disabled" | "scope_mismatch" | "reverted" | "unknown_outcome" | "postcondition_failed";
  readonly transactionHash: `0x${string}` | null;

  constructor(code: AgonListingVerificationError["code"], message: string, transactionHash: `0x${string}` | null = null) {
    super(message);
    this.name = "AgonListingVerificationError";
    this.code = code;
    this.transactionHash = transactionHash;
  }
}

type ListingSnapshot = {
  listingId: bigint;
  agentId: bigint;
  manifestHash: `0x${string}`;
  version: bigint;
  status: number;
  verification: number;
};

function address(value: string, label: string): `0x${string}` {
  try {
    return getAddress(value).toLowerCase() as `0x${string}`;
  } catch {
    throw new Error(`${label} must be a valid EVM address`);
  }
}

function positiveId(value: string, label: string): bigint {
  if (!/^[1-9]\d*$/.test(value)) throw new Error(`${label} must be positive`);
  return BigInt(value);
}

function bytes32(value: unknown, label: string): `0x${string}` {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${label} is invalid`);
  return value.toLowerCase() as `0x${string}`;
}

function listingSnapshot(value: unknown): ListingSnapshot {
  const record = value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
  const raw = (name: string, index: number) => Array.isArray(value) ? value[index] : record?.[name];
  const listingId = BigInt(raw("listingId", 0) as bigint | string | number);
  const agentId = BigInt(raw("agentId", 1) as bigint | string | number);
  const version = BigInt(raw("version", 7) as bigint | string | number);
  const status = Number(raw("status", 9));
  const verification = Number(raw("verification", 10));
  if (!Number.isInteger(status) || !Number.isInteger(verification)) throw new Error("ServiceRegistry returned an invalid listing state");
  return { listingId, agentId, manifestHash: bytes32(raw("manifestHash", 3), "manifest hash"), version, status, verification };
}

function assertExactScope(actual: ListingSnapshot, expected: { listingId: bigint; agentId: bigint; version: bigint; manifestHash: `0x${string}` }): void {
  if (actual.listingId !== expected.listingId) throw new AgonListingVerificationError("scope_mismatch", "ServiceRegistry listing id changed before verification");
  if (actual.agentId !== expected.agentId) throw new AgonListingVerificationError("scope_mismatch", "ServiceRegistry agent changed before verification");
  if (actual.version !== expected.version) throw new AgonListingVerificationError("scope_mismatch", "ServiceRegistry version changed before verification");
  if (actual.manifestHash !== expected.manifestHash) throw new AgonListingVerificationError("scope_mismatch", "ServiceRegistry manifest changed before verification");
  if (actual.status !== 0) throw new AgonListingVerificationError("scope_mismatch", "ServiceRegistry listing is no longer listed");
}

export async function readAgonListingVerifierReadiness(input: {
  enabled: boolean;
  client?: Pick<AgonListingVerifierReadClient, "readContract">;
  registryAddress: string;
  verifierAddress?: string;
}): Promise<AgonListingVerifierReadiness> {
  const registryAddress = address(input.registryAddress, "ServiceRegistry address");
  const verifierAddress = input.verifierAddress ? address(input.verifierAddress, "verifier address") : null;
  if (!input.enabled || !input.client) return { enabled: false, registryAddress, verifierAddress, role: null, assigned: false, reason: "disabled" };
  if (!verifierAddress) return { enabled: true, registryAddress, verifierAddress: null, role: null, assigned: false, reason: "verifier_not_configured" };
  let role: `0x${string}`;
  try {
    role = bytes32(await input.client.readContract({ address: registryAddress, abi: listingVerifierAbi, functionName: "VERIFIER_ROLE" }), "VERIFIER_ROLE");
  } catch {
    return { enabled: true, registryAddress, verifierAddress, role: null, assigned: false, reason: "read_failed" };
  }
  let scoped: unknown;
  try {
    scoped = await input.client.readContract({ address: registryAddress, abi: listingVerifierAbi, functionName: "verificationScopeSupported" });
  } catch {
    return { enabled: true, registryAddress, verifierAddress, role, assigned: false, reason: "scoped_verification_unsupported" };
  }
  if (scoped !== true) return { enabled: true, registryAddress, verifierAddress, role, assigned: false, reason: "scoped_verification_unsupported" };
  try {
    const assigned = await input.client.readContract({ address: registryAddress, abi: listingVerifierAbi, functionName: "hasRole", args: [role, verifierAddress] });
    if (assigned !== true && assigned !== false) throw new Error("ServiceRegistry returned an invalid role result");
    return { enabled: true, registryAddress, verifierAddress, role, assigned, reason: assigned ? "assigned" : "role_not_assigned" };
  } catch {
    return { enabled: true, registryAddress, verifierAddress, role: null, assigned: false, reason: "read_failed" };
  }
}

export function createViemAgonListingVerifier(input: {
  enabled: boolean;
  registryAddress: string;
  verifierAddress: string;
  client?: AgonListingVerifierReadClient;
  wallet?: AgonListingVerifierWallet;
  receiptTimeoutMs?: number;
}): AgonListingVerifierAdapter {
  const registryAddress = address(input.registryAddress, "ServiceRegistry address");
  address(input.verifierAddress, "verifier address");
  const enabled = input.enabled && Boolean(input.client) && Boolean(input.wallet);
  const receiptTimeoutMs = input.receiptTimeoutMs ?? 60_000;

  return {
    enabled,
    async verify(request) {
      if (!enabled || !input.client || !input.wallet) throw new AgonListingVerificationError("disabled", "automatic marketplace verification is disabled");
      const expected = {
        listingId: positiveId(request.listingId, "listing id"),
        agentId: positiveId(request.agentId, "agent id"),
        version: positiveId(request.listingVersion, "listing version"),
        manifestHash: bytes32(request.manifestHash, "manifest hash"),
      };
      let scoped: unknown;
      try {
        scoped = await input.client.readContract({ address: registryAddress, abi: listingVerifierAbi, functionName: "verificationScopeSupported" });
      } catch {
        throw new AgonListingVerificationError("disabled", "ServiceRegistry does not support exact-version verification");
      }
      if (scoped !== true) throw new AgonListingVerificationError("disabled", "ServiceRegistry does not support exact-version verification");
      const before = listingSnapshot(await input.client.readContract({ address: registryAddress, abi: listingVerifierAbi, functionName: "getListing", args: [expected.listingId] }));
      assertExactScope(before, expected);
      if (before.verification === 2) return { status: "already_verified", transactionHash: null };
      // Unverified and Pending are promoted. Suspended (4) is promoted only when the cycle wrote that
      // suspension itself; one an operator set by hand, Expired and Revoked stay as they are.
      const ownSuspension = before.verification === 4 && request.liftOwnSuspension === true;
      if (before.verification !== 0 && before.verification !== 1 && !ownSuspension) {
        throw new AgonListingVerificationError("scope_mismatch", "ServiceRegistry verification state does not allow automatic promotion");
      }

      let transactionHash = request.priorTransactionHash;
      if (!transactionHash) {
        try {
          transactionHash = await input.wallet.writeContract({
            address: registryAddress,
            abi: listingVerifierAbi,
            functionName: "setVerificationForVersion",
            args: [expected.listingId, expected.version, expected.manifestHash, 2],
          });
        } catch (error) {
          throw new AgonListingVerificationError("unknown_outcome", `marketplace verification submission is unknown: ${error instanceof Error ? error.message : "submission failed"}`);
        }
        try {
          await request.onSubmitted?.(transactionHash);
        } catch (error) {
          throw new AgonListingVerificationError(
            "unknown_outcome",
            `marketplace verification submission could not be recorded: ${error instanceof Error ? error.message : "persistence failed"}`,
            transactionHash,
          );
        }
      }
      let receipt: { status: "success" | "reverted" };
      try {
        receipt = await input.client.waitForTransactionReceipt({ hash: transactionHash, timeout: receiptTimeoutMs });
      } catch (error) {
        throw new AgonListingVerificationError("unknown_outcome", `marketplace verification receipt is unknown: ${error instanceof Error ? error.message : "receipt lookup failed"}`, transactionHash);
      }
      if (receipt.status !== "success") throw new AgonListingVerificationError("reverted", "marketplace verification transaction reverted", transactionHash);
      let after: ListingSnapshot;
      try {
        after = listingSnapshot(await input.client.readContract({ address: registryAddress, abi: listingVerifierAbi, functionName: "getListing", args: [expected.listingId] }));
      } catch (error) {
        throw new AgonListingVerificationError("unknown_outcome", `marketplace verification final state is unknown: ${error instanceof Error ? error.message : "state read failed"}`, transactionHash);
      }
      assertExactScope(after, expected);
      if (after.verification !== 2) throw new AgonListingVerificationError("postcondition_failed", "ServiceRegistry did not confirm the verified state");
      return { status: "confirmed", transactionHash };
    },
    async suspend(request) {
      if (!enabled || !input.client || !input.wallet) throw new AgonListingVerificationError("disabled", "automatic marketplace verification is disabled");
      const expected = {
        listingId: positiveId(request.listingId, "listing id"),
        agentId: positiveId(request.agentId, "agent id"),
        version: positiveId(request.listingVersion, "listing version"),
        manifestHash: bytes32(request.manifestHash, "manifest hash"),
      };
      let scoped: unknown;
      try {
        scoped = await input.client.readContract({ address: registryAddress, abi: listingVerifierAbi, functionName: "verificationScopeSupported" });
      } catch {
        throw new AgonListingVerificationError("disabled", "ServiceRegistry does not support exact-version verification");
      }
      if (scoped !== true) throw new AgonListingVerificationError("disabled", "ServiceRegistry does not support exact-version verification");
      const before = listingSnapshot(await input.client.readContract({ address: registryAddress, abi: listingVerifierAbi, functionName: "getListing", args: [expected.listingId] }));
      assertExactScope(before, expected);
      if (before.verification === 4) return { status: "already_suspended", transactionHash: null };
      if (before.verification === 5) throw new AgonListingVerificationError("scope_mismatch", "ServiceRegistry listing is revoked");

      let transactionHash = request.priorTransactionHash;
      if (!transactionHash) {
        try {
          transactionHash = await input.wallet.writeContract({
            address: registryAddress,
            abi: listingVerifierAbi,
            functionName: "setVerificationForVersion",
            args: [expected.listingId, expected.version, expected.manifestHash, 4],
          });
        } catch (error) {
          throw new AgonListingVerificationError("unknown_outcome", `marketplace suspension submission is unknown: ${error instanceof Error ? error.message : "submission failed"}`);
        }
        try {
          await request.onSubmitted?.(transactionHash);
        } catch (error) {
          throw new AgonListingVerificationError("unknown_outcome", `marketplace suspension could not be recorded: ${error instanceof Error ? error.message : "persistence failed"}`, transactionHash);
        }
      }
      let receipt: { status: "success" | "reverted" };
      try {
        receipt = await input.client.waitForTransactionReceipt({ hash: transactionHash, timeout: receiptTimeoutMs });
      } catch (error) {
        throw new AgonListingVerificationError("unknown_outcome", `marketplace suspension receipt is unknown: ${error instanceof Error ? error.message : "receipt lookup failed"}`, transactionHash);
      }
      if (receipt.status !== "success") throw new AgonListingVerificationError("reverted", "marketplace suspension transaction reverted", transactionHash);
      const after = listingSnapshot(await input.client.readContract({ address: registryAddress, abi: listingVerifierAbi, functionName: "getListing", args: [expected.listingId] }));
      assertExactScope(after, expected);
      if (after.verification !== 4) throw new AgonListingVerificationError("postcondition_failed", "ServiceRegistry did not confirm the suspended state");
      return { status: "confirmed", transactionHash };
    },
  };
}
