import {
  decodeEventLog,
  encodeFunctionData,
  encodePacked,
  getAddress,
  isAddressEqual,
  keccak256,
  type Log,
  type PublicClient,
  type TransactionReceipt,
} from "viem";
import type { AgonDeployment } from "../../config/deployments.ts";
import type { Result } from "../core/result.ts";
import type {
  BindProfileRequest,
  PauseListingRequest,
  PublishListingRequest,
  PublishListingVersionRequest,
  SubmittedOperation,
} from "../http/api-types.ts";
import type { AgonServiceError } from "../http/routes.ts";
import type { AgonWriteAdapter } from "../http/service.ts";
import type { AgonReadiness, CachedAgonReadiness } from "./readiness.ts";
import {
  type AgonListingAnchor,
  type AgonListingAnchorStore,
  type AgonOperationStore,
  type AgonTransactionIntent,
  type StoredAgonWriteOperation,
} from "./repository.ts";
import { agonProfileRegistryAbi, agonServiceRegistryAbi } from "./abi.ts";

type WriteClient = Pick<
  PublicClient,
  "readContract" | "simulateContract" | "getTransactionReceipt"
>;

type ReadinessProvider = Pick<CachedAgonReadiness, "get">;

function operationView(operation: StoredAgonWriteOperation): SubmittedOperation {
  return {
    operationId: operation.operationId,
    state: operation.state,
    transaction: operation.transaction,
    txHash: operation.txHash,
    resultReference: operation.resultReference,
    proof:
      operation.blockNumber !== null && operation.logIndex !== null
        ? { blockNumber: operation.blockNumber.toString(), logIndex: operation.logIndex }
        : null,
  };
}

function failure(code: AgonServiceError["code"], message: string): Result<never, AgonServiceError> {
  return { ok: false, error: { code, message } };
}

function unexpectedFailure(scope: string, error: unknown): Result<never, AgonServiceError> {
  console.error(`[agon] ${scope}:`, error instanceof Error ? error.message : "unknown failure");
  return failure("internal", "Agon write request failed");
}

function positive(value: string, label: string): bigint {
  if (!/^[1-9]\d*$/.test(value)) throw new Error(`${label} must be a positive decimal string`);
  return BigInt(value);
}

function bytes32(value: string, label: string): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${label} must be bytes32`);
  return value.toLowerCase() as `0x${string}`;
}

function intentHash(
  chainId: bigint,
  actor: `0x${string}`,
  transaction: AgonTransactionIntent,
): `0x${string}` {
  return keccak256(
    encodePacked(
      ["uint256", "address", "address", "bytes"],
      [chainId, actor, transaction.to, transaction.data],
    ),
  );
}

function matchingLogs(receipt: TransactionReceipt, address: string): Log[] {
  return receipt.logs.filter((log) => isAddressEqual(log.address, address as `0x${string}`));
}

function buildListingAnchor(
  request: PublishListingRequest | PublishListingVersionRequest,
  serviceRegistry: string,
  listingId: bigint,
  version: bigint,
  providerSnapshot: string,
): AgonListingAnchor {
  return {
    chainId: BigInt(request.chainId),
    serviceRegistry,
    listingId,
    version,
    manifestHash: request.manifestHash as `0x${string}`,
    manifestUri: request.manifestUri,
    paymentRail: request.paymentRail,
    providerSnapshot: providerSnapshot as `0x${string}`,
    validatedAt: new Date(),
  };
}

export class ViemAgonWriteAdapter implements AgonWriteAdapter {
  private readonly deployment: AgonDeployment;
  private readonly client: WriteClient;
  private readonly readiness: ReadinessProvider;
  private readonly operations: AgonOperationStore;
  private readonly listingAnchors?: AgonListingAnchorStore;

  constructor(options: {
    deployment: AgonDeployment;
    client: WriteClient;
    readiness: ReadinessProvider;
    operations: AgonOperationStore;
    listingAnchors?: AgonListingAnchorStore;
  }) {
    this.deployment = options.deployment;
    this.client = options.client;
    this.readiness = options.readiness;
    this.operations = options.operations;
    this.listingAnchors = options.listingAnchors;
  }

  getReadiness(force = false): Promise<AgonReadiness> {
    return this.readiness.get(force);
  }

  async authorizeCircleExecution(
    actorInput: string,
    operationId: string,
    contractAddress: string,
    functionSignature: string,
    parameters: ReadonlyArray<string | number | boolean | string[]>,
  ): Promise<Result<true, AgonServiceError>> {
    const readiness = await this.readiness.get();
    if (!readiness.ready) return failure("capability_unavailable", "Agon writes are unavailable");
    const actor = getAddress(actorInput).toLowerCase();
    const operation = await this.operations.getForActor(operationId, actor);
    if (!operation || operation.state !== "prepared") {
      return failure("not_found", "prepared Agon operation not found");
    }
    const expectedSignature = operation.transaction.functionName === "bindProfile"
      ? "bindProfile(uint256,string)"
        : operation.transaction.functionName === "publishVersion"
          ? "publishVersion(uint256,bytes32,string,uint8)"
          : operation.transaction.functionName === "setStatus"
            ? "setStatus(uint256,uint8)"
            : "publish(uint256,bytes32,bytes32,string,uint256,uint8)";
    const normalizedParameters = parameters.map((value) => String(value));
    if (
      !isAddressEqual(operation.transaction.to, contractAddress as `0x${string}`) ||
      functionSignature !== expectedSignature ||
      JSON.stringify(normalizedParameters) !== JSON.stringify(operation.transaction.args)
    ) {
      return failure("validation_failed", "Circle call does not match the prepared Agon operation");
    }
    return { ok: true, value: true };
  }

  async bindProfile(
    actorInput: string,
    request: BindProfileRequest,
  ): Promise<Result<SubmittedOperation, AgonServiceError>> {
    try {
      const readiness = await this.readiness.get();
      if (!readiness.ready) return failure("capability_unavailable", "profile writes are unavailable");
      if (request.chainId !== String(this.deployment.chainId)) {
        return failure("validation_failed", "request chain does not match the Agon deployment");
      }
      const actor = getAddress(actorInput);
      const agentId = positive(request.agentId, "agent id");
      const data = encodeFunctionData({
        abi: agonProfileRegistryAbi,
        functionName: "bindProfile",
        args: [agentId, request.metadataUri],
      });
      const transaction: AgonTransactionIntent = {
        chainId: request.chainId,
        to: this.deployment.contracts.AgonProfileRegistry,
        data,
        functionName: "bindProfile",
        args: [request.agentId, request.metadataUri],
      };
      const payloadHash = intentHash(BigInt(request.chainId), actor, transaction);
      const existing = await this.operations.getByPayload(actor, "bind_profile", payloadHash);
      if (existing?.state === "confirmed") return { ok: true, value: operationView(existing) };
      const owner = await this.client.readContract({
        address: this.deployment.contracts.AgonProfileRegistry,
        abi: agonProfileRegistryAbi,
        functionName: "currentOwner",
        args: [agentId],
      });
      if (!isAddressEqual(actor, owner)) return failure("not_owner", "authenticated wallet is not the current ERC-8004 owner");
      await this.client.simulateContract({
        account: actor,
        address: this.deployment.contracts.AgonProfileRegistry,
        abi: agonProfileRegistryAbi,
        functionName: "bindProfile",
        args: [agentId, request.metadataUri],
      });
      const operation = await this.operations.prepare({
        actor: actor.toLowerCase() as `0x${string}`,
        kind: "bind_profile",
        payloadHash,
        request,
        transaction,
      });
      return { ok: true, value: operationView(operation) };
    } catch (error) {
      if (error instanceof Error && /revert|simulation/i.test(error.message)) {
        return failure("conflict", "profile binding simulation was refused by the contract");
      }
      if (error instanceof Error && /must be|invalid address/i.test(error.message)) {
        return failure("validation_failed", error.message);
      }
      return unexpectedFailure("profile preparation failed", error);
    }
  }

  async publishListing(
    actorInput: string,
    request: PublishListingRequest,
  ): Promise<Result<SubmittedOperation, AgonServiceError>> {
    try {
      const readiness = await this.readiness.get();
      if (!readiness.ready) return failure("capability_unavailable", "listing writes are unavailable");
      if (request.chainId !== String(this.deployment.chainId)) {
        return failure("validation_failed", "request chain does not match the Agon deployment");
      }
      const actor = getAddress(actorInput);
      const agentId = positive(request.agentId, "agent id");
      const category = positive(request.category, "category");
      const serviceKey = bytes32(request.serviceKey, "service key");
      const manifestHash = bytes32(request.manifestHash, "manifest hash");
      const { args, transaction } = this.publishIntent(request, agentId, category, serviceKey, manifestHash);
      const payloadHash = intentHash(BigInt(request.chainId), actor, transaction);
      const existing = await this.operations.getByPayload(actor, "publish_listing", payloadHash);
      if (existing?.state === "confirmed") return { ok: true, value: operationView(existing) };
      const owner = await this.client.readContract({
        address: this.deployment.contracts.AgonProfileRegistry,
        abi: agonProfileRegistryAbi,
        functionName: "currentOwner",
        args: [agentId],
      });
      if (!isAddressEqual(actor, owner)) return failure("not_owner", "authenticated wallet is not the current ERC-8004 owner");
      await this.client.simulateContract({
        account: actor,
        address: this.deployment.contracts.AgonServiceRegistry,
        abi: agonServiceRegistryAbi,
        functionName: "publish",
        args,
      });
      const operation = await this.operations.prepare({
        actor: actor.toLowerCase() as `0x${string}`,
        kind: "publish_listing",
        payloadHash,
        request: { ...request, serviceKey, manifestHash },
        transaction,
      });
      return { ok: true, value: operationView(operation) };
    } catch (error) {
      if (error instanceof Error && /revert|simulation/i.test(error.message)) {
        return failure("conflict", "listing publication simulation was refused by the contract");
      }
      if (error instanceof Error && /must be|invalid address/i.test(error.message)) {
        return failure("validation_failed", error.message);
      }
      return unexpectedFailure("listing preparation failed", error);
    }
  }

  /// The exact publish call Agon prepares; recovery rebuilds it from the chain event to find its operation.
  private publishIntent(request: PublishListingRequest, agentId: bigint, category: bigint, serviceKey: `0x${string}`, manifestHash: `0x${string}`) {
    const paymentRail = request.paymentRail === "X402" ? 0 : 1;
    const args = [agentId, serviceKey, manifestHash, request.manifestUri, category, paymentRail] as const;
    const data = encodeFunctionData({ abi: agonServiceRegistryAbi, functionName: "publish", args });
    const transaction: AgonTransactionIntent = {
      chainId: request.chainId,
      to: this.deployment.contracts.AgonServiceRegistry,
      data,
      functionName: "publish",
      args: [request.agentId, serviceKey, manifestHash, request.manifestUri, request.category, String(paymentRail)],
    };
    return { args, transaction };
  }

  /// Confirms a publish that is already on chain but was never confirmed (for example when the
  /// response that carried its transaction was lost). The operation is found by rebuilding the
  /// exact prepared intent from the ListingPublished event, so nothing is guessed and nothing is sent.
  async confirmPublishedListing(actorInput: string, txHash: `0x${string}`): Promise<Result<SubmittedOperation, AgonServiceError>> {
    let actor: `0x${string}`;
    let receipt: TransactionReceipt;
    try {
      actor = getAddress(actorInput);
      receipt = await this.client.getTransactionReceipt({ hash: txHash });
    } catch {
      return failure("receipt_unavailable", "transaction receipt is not available yet");
    }
    if (receipt.status !== "success") return failure("receipt_invalid", "transaction reverted on chain");
    for (const log of matchingLogs(receipt, this.deployment.contracts.AgonServiceRegistry)) {
      let args;
      try {
        const decoded = decodeEventLog({ abi: agonServiceRegistryAbi, ...log, strict: true });
        if (decoded.eventName !== "ListingPublished") continue;
        args = decoded.args;
      } catch {
        continue;
      }
      if (!isAddressEqual(args.providerSnapshot, actor)) continue;
      const request: PublishListingRequest = {
        chainId: String(this.deployment.chainId),
        agentId: args.agentId.toString(),
        serviceKey: args.serviceKey,
        manifestHash: args.manifestHash,
        manifestUri: args.manifestURI,
        category: args.category.toString(),
        paymentRail: args.paymentRail === 0 ? "X402" : "Escrow",
      };
      const { transaction } = this.publishIntent(request, args.agentId, args.category, args.serviceKey, args.manifestHash);
      const operation = await this.operations.getByPayload(actor, "publish_listing", intentHash(BigInt(request.chainId), actor, transaction));
      if (operation) return this.confirmOperation(actor, operation.operationId, txHash);
    }
    return failure("not_found", "no prepared publication matches this transaction");
  }

  async publishListingVersion(
    actorInput: string,
    request: PublishListingVersionRequest,
  ): Promise<Result<SubmittedOperation, AgonServiceError>> {
    try {
      const readiness = await this.readiness.get();
      if (!readiness.ready) return failure("capability_unavailable", "listing writes are unavailable");
      if (request.chainId !== String(this.deployment.chainId)) {
        return failure("validation_failed", "request chain does not match the Agon deployment");
      }
      const actor = getAddress(actorInput);
      const listingId = positive(request.listingId, "listing id");
      const manifestHash = bytes32(request.manifestHash, "manifest hash");
      const paymentRail = request.paymentRail === "X402" ? 0 : 1;
      const args = [listingId, manifestHash, request.manifestUri, paymentRail] as const;
      const data = encodeFunctionData({ abi: agonServiceRegistryAbi, functionName: "publishVersion", args });
      const transaction: AgonTransactionIntent = {
        chainId: request.chainId,
        to: this.deployment.contracts.AgonServiceRegistry,
        data,
        functionName: "publishVersion",
        args: [request.listingId, manifestHash, request.manifestUri, String(paymentRail)],
      };
      const payloadHash = intentHash(BigInt(request.chainId), actor, transaction);
      const existing = await this.operations.getByPayload(actor, "publish_listing", payloadHash);
      if (existing?.state === "confirmed") return { ok: true, value: operationView(existing) };
      const listing = await this.client.readContract({
        address: this.deployment.contracts.AgonServiceRegistry,
        abi: agonServiceRegistryAbi,
        functionName: "getListing",
        args: [listingId],
      });
      const owner = await this.client.readContract({
        address: this.deployment.contracts.AgonProfileRegistry,
        abi: agonProfileRegistryAbi,
        functionName: "currentOwner",
        args: [listing.agentId],
      });
      if (!isAddressEqual(actor, owner)) return failure("not_owner", "authenticated wallet is not the current ERC-8004 owner");
      await this.client.simulateContract({
        account: actor,
        address: this.deployment.contracts.AgonServiceRegistry,
        abi: agonServiceRegistryAbi,
        functionName: "publishVersion",
        args,
      });
      // The next version is known before signing. Persisting this exact tuple
      // gives the indexer an independent reviewed anchor for the chain event.
      if (this.listingAnchors) {
        await this.listingAnchors.insertValidatedListingVersion(
          buildListingAnchor(
            request,
            this.deployment.contracts.AgonServiceRegistry,
            listingId,
            BigInt(listing.version) + 1n,
            actor,
          ),
        );
      }
      const operation = await this.operations.prepare({
        actor: actor.toLowerCase() as `0x${string}`,
        kind: "publish_listing",
        payloadHash,
        request,
        transaction,
      });
      return { ok: true, value: operationView(operation) };
    } catch (error) {
      if (error instanceof Error && /revert|simulation/i.test(error.message)) {
        return failure("conflict", "listing version simulation was refused by the contract");
      }
      if (error instanceof Error && /must be|invalid address/i.test(error.message)) {
        return failure("validation_failed", error.message);
      }
      return unexpectedFailure("listing version preparation failed", error);
    }
  }

  async pauseListing(
    actorInput: string,
    request: PauseListingRequest,
  ): Promise<Result<SubmittedOperation, AgonServiceError>> {
    try {
      const readiness = await this.readiness.get();
      if (!readiness.ready) return failure("capability_unavailable", "listing writes are unavailable");
      if (request.chainId !== String(this.deployment.chainId)) {
        return failure("validation_failed", "request chain does not match the Agon deployment");
      }
      const actor = getAddress(actorInput);
      const listingId = positive(request.listingId, "listing id");
      const args = [listingId, 1] as const;
      const data = encodeFunctionData({ abi: agonServiceRegistryAbi, functionName: "setStatus", args });
      const transaction: AgonTransactionIntent = {
        chainId: request.chainId,
        to: this.deployment.contracts.AgonServiceRegistry,
        data,
        functionName: "setStatus",
        args: [request.listingId, "1"],
      };
      const payloadHash = intentHash(BigInt(request.chainId), actor, transaction);
      const existing = await this.operations.getByPayload(actor, "pause_listing", payloadHash);
      if (existing?.state === "confirmed") return { ok: true, value: operationView(existing) };
      const listing = await this.client.readContract({
        address: this.deployment.contracts.AgonServiceRegistry,
        abi: agonServiceRegistryAbi,
        functionName: "getListing",
        args: [listingId],
      }) as { agentId: bigint };
      const owner = await this.client.readContract({
        address: this.deployment.contracts.AgonProfileRegistry,
        abi: agonProfileRegistryAbi,
        functionName: "currentOwner",
        args: [listing.agentId],
      });
      if (!isAddressEqual(actor, owner)) return failure("not_owner", "authenticated wallet is not the current ERC-8004 owner");
      await this.client.simulateContract({
        account: actor,
        address: this.deployment.contracts.AgonServiceRegistry,
        abi: agonServiceRegistryAbi,
        functionName: "setStatus",
        args,
      });
      const operation = await this.operations.prepare({
        actor: actor.toLowerCase() as `0x${string}`,
        kind: "pause_listing",
        payloadHash,
        request,
        transaction,
      });
      return { ok: true, value: operationView(operation) };
    } catch (error) {
      if (error instanceof Error && /revert|simulation/i.test(error.message)) {
        return failure("conflict", "listing pause simulation was refused by the contract");
      }
      if (error instanceof Error && /must be|invalid address/i.test(error.message)) {
        return failure("validation_failed", error.message);
      }
      return unexpectedFailure("listing pause preparation failed", error);
    }
  }

  async confirmOperation(
    actorInput: string,
    operationId: string,
    txHash: `0x${string}`,
  ): Promise<Result<SubmittedOperation, AgonServiceError>> {
    let actor: `0x${string}`;
    let operation: StoredAgonWriteOperation | null;
    try {
      actor = getAddress(actorInput).toLowerCase() as `0x${string}`;
      operation = await this.operations.getForActor(operationId, actor);
    } catch (error) {
      return unexpectedFailure("operation lookup failed", error);
    }
    if (!operation) return failure("not_found", "write operation not found");
    if (operation.state === "confirmed") {
      if (operation.txHash !== txHash.toLowerCase()) {
        return failure("conflict", "operation is already confirmed by a different transaction");
      }
      // Re-verify the canonical receipt on retries. This also repairs durable
      // projection anchors created before an earlier confirmation response.
    }

    let receipt: TransactionReceipt;
    try {
      receipt = await this.client.getTransactionReceipt({ hash: txHash });
    } catch {
      return failure("receipt_unavailable", "transaction receipt is not available yet");
    }
    if (receipt.status !== "success") return failure("receipt_invalid", "transaction reverted on chain");

    const proof = operation.kind === "bind_profile"
      ? this.verifyProfileEvent(operation, receipt)
      : operation.transaction.functionName === "setStatus"
        ? this.verifyListingStatusEvent(operation, receipt)
        : operation.transaction.functionName === "publishVersion"
          ? this.verifyListingVersionEvent(operation, receipt)
          : this.verifyListingEvent(operation, receipt);
    if (!proof.ok) return proof;

    const proofValue = proof.value as { logIndex: number; resultReference: string | null; anchor?: AgonListingAnchor };

    if (proofValue.anchor && this.listingAnchors) {
      await this.listingAnchors.insertValidatedListingVersion(proofValue.anchor);
      await this.listingAnchors.reconcileListingAnchor?.(proofValue.anchor);
    }

    try {
      const confirmed = await this.operations.confirm({
        operationId,
        actor,
        txHash: txHash.toLowerCase() as `0x${string}`,
        resultReference: proofValue.resultReference,
        blockNumber: receipt.blockNumber,
        logIndex: proofValue.logIndex,
      });
      return { ok: true, value: operationView(confirmed) };
    } catch (error) {
      if (error instanceof Error && /different transaction|unique|duplicate/i.test(error.message)) {
        return failure("conflict", "operation confirmation conflicts with existing receipt proof");
      }
      return unexpectedFailure("operation confirmation failed", error);
    }
  }

  private verifyProfileEvent(
    operation: StoredAgonWriteOperation,
    receipt: TransactionReceipt,
  ): Result<{ logIndex: number; resultReference: null }, AgonServiceError> {
    const request = operation.request as BindProfileRequest;
    const matches: Array<{ logIndex: number; resultReference: null }> = [];
    for (const log of matchingLogs(receipt, this.deployment.contracts.AgonProfileRegistry)) {
      try {
        const decoded = decodeEventLog({ abi: agonProfileRegistryAbi, ...log, strict: true });
        if (decoded.eventName !== "ProfileBound") continue;
        const args = decoded.args;
        if (
          args.agentId === BigInt(request.agentId) &&
          isAddressEqual(args.owner, operation.actor) &&
          args.metadataURI === request.metadataUri
        ) matches.push({ logIndex: log.logIndex ?? 0, resultReference: null });
      } catch {
        // Ignore unrelated logs from the canonical contract.
      }
    }
    return matches.length === 1
      ? { ok: true, value: matches[0]! }
      : failure("receipt_invalid", "receipt does not contain exactly one matching ProfileBound event");
  }

  private verifyListingEvent(
    operation: StoredAgonWriteOperation,
    receipt: TransactionReceipt,
  ): Result<{ logIndex: number; resultReference: string; anchor: AgonListingAnchor }, AgonServiceError> {
    const request = operation.request as PublishListingRequest;
    const rail = request.paymentRail === "X402" ? 0 : 1;
    const matches: Array<{ logIndex: number; resultReference: string; anchor: AgonListingAnchor }> = [];
    for (const log of matchingLogs(receipt, this.deployment.contracts.AgonServiceRegistry)) {
      try {
        const decoded = decodeEventLog({ abi: agonServiceRegistryAbi, ...log, strict: true });
        if (decoded.eventName !== "ListingPublished") continue;
        const args = decoded.args;
        if (
          args.listingId > 0n &&
          args.agentId === BigInt(request.agentId) &&
          args.serviceKey.toLowerCase() === request.serviceKey.toLowerCase() &&
          args.manifestHash.toLowerCase() === request.manifestHash.toLowerCase() &&
          args.manifestURI === request.manifestUri &&
          args.category === BigInt(request.category) &&
          args.paymentRail === rail &&
          args.version === 1n &&
          isAddressEqual(args.providerSnapshot, operation.actor) &&
          args.status === 0 &&
          args.verification === 0
        ) {
          matches.push({
            logIndex: log.logIndex ?? 0,
            resultReference: `${request.chainId}:${this.deployment.contracts.AgonServiceRegistry.toLowerCase()}:${args.listingId}`,
            anchor: buildListingAnchor(
              request,
              this.deployment.contracts.AgonServiceRegistry,
              args.listingId,
              args.version,
              operation.actor,
            ),
          });
        }
      } catch {
        // Ignore unrelated logs from the canonical contract.
      }
    }
    return matches.length === 1
      ? { ok: true, value: matches[0]! }
      : failure("receipt_invalid", "receipt does not contain exactly one matching ListingPublished event");
  }

  private verifyListingVersionEvent(
    operation: StoredAgonWriteOperation,
    receipt: TransactionReceipt,
  ): Result<{ logIndex: number; resultReference: string; anchor: AgonListingAnchor }, AgonServiceError> {
    const request = operation.request as PublishListingVersionRequest;
    const rail = request.paymentRail === "X402" ? 0 : 1;
    const matches: Array<{ logIndex: number; resultReference: string; anchor: AgonListingAnchor }> = [];
    for (const log of matchingLogs(receipt, this.deployment.contracts.AgonServiceRegistry)) {
      try {
        const decoded = decodeEventLog({ abi: agonServiceRegistryAbi, ...log, strict: true });
        if (decoded.eventName !== "ListingVersionPublished") continue;
        const args = decoded.args as {
          listingId: bigint;
          manifestHash: `0x${string}`;
          manifestURI: string;
          paymentRail: number;
          providerSnapshot: `0x${string}`;
          version: bigint;
        };
        if (
          args.listingId === BigInt(request.listingId) &&
          args.manifestHash.toLowerCase() === request.manifestHash.toLowerCase() &&
          args.manifestURI === request.manifestUri &&
          args.paymentRail === rail &&
          isAddressEqual(args.providerSnapshot, operation.actor)
        ) {
          matches.push({
            logIndex: log.logIndex ?? 0,
            resultReference: `${request.chainId}:${this.deployment.contracts.AgonServiceRegistry.toLowerCase()}:${args.listingId}`,
            anchor: buildListingAnchor(
              request,
              this.deployment.contracts.AgonServiceRegistry,
              args.listingId,
              args.version,
              operation.actor,
            ),
          });
        }
      } catch {
        // Ignore unrelated logs from the canonical contract.
      }
    }
    return matches.length === 1
      ? { ok: true, value: matches[0]! }
      : failure("receipt_invalid", "receipt does not contain exactly one matching ListingVersionPublished event");
  }

  private verifyListingStatusEvent(
    operation: StoredAgonWriteOperation,
    receipt: TransactionReceipt,
  ): Result<{ logIndex: number; resultReference: string }, AgonServiceError> {
    const request = operation.request as PauseListingRequest;
    const matches: Array<{ logIndex: number; resultReference: string }> = [];
    for (const log of matchingLogs(receipt, this.deployment.contracts.AgonServiceRegistry)) {
      try {
        const decoded = decodeEventLog({ abi: agonServiceRegistryAbi, ...log, strict: true });
        if (decoded.eventName !== "ListingStatusChanged") continue;
        const args = decoded.args;
        if (
          args.listingId === BigInt(request.listingId) &&
          args.status === 1 &&
          isAddressEqual(args.providerSnapshot, operation.actor)
        ) {
          matches.push({
            logIndex: log.logIndex ?? 0,
            resultReference: `${request.chainId}:${this.deployment.contracts.AgonServiceRegistry.toLowerCase()}:${args.listingId}`,
          });
        }
      } catch {
        // Ignore unrelated logs from the canonical contract.
      }
    }
    return matches.length === 1
      ? { ok: true, value: matches[0]! }
      : failure("receipt_invalid", "receipt does not contain exactly one matching ListingStatusChanged event");
  }
}
