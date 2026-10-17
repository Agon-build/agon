import { createHash } from "node:crypto";
import { decodeEventLog, encodeFunctionData, parseAbi, type Transaction, type TransactionReceipt } from "viem";
import type { ProviderDraftStore } from "./provider-draft-store.ts";
import type { createMcpAccessAdapter } from "./adapter.ts";
import { publisherKey, type ManagedPublisherRecord, type ManagedPublisherState, type ManagedPublisherStore, type PinnedFee } from "./managed-publisher-store.ts";

const identityAbi = parseAbi([
  "function register(string agentURI) returns (uint256 agentId)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
]);
const chainId = 5042002;
/// Hard per-action gas ceiling, checked against gasLimit x maxFee: 1 native USDC, Circle's own default
/// per-transaction limit (error 155211). Kestrel's publish (17 Oct 2026) had a 0.474 worst case at a
/// 528 gwei tip and paid 0.348; at Circle's HIGH tip that day (693 gwei) it would reach about 0.63.
const maxGasFeeWei = 1_000_000_000_000_000_000n;
const GWEI = 1_000_000_000n;
/// Circle's answer when it refuses a fee. On Arc it refuses any tip under its own floating
/// minimum (probed 17 Oct 2026), so the publisher sends Circle's LOW estimate and, if that
/// went stale before submission, estimates once more.
const FEE_REFUSED = /code 2\): API parameter invalid/;
/// A builder's fee limit: a USDC amount above 0 and at most 1, with up to 6 decimals.
export const FEE_LIMIT_PATTERN = String.raw`^(?:0\.(?!0{1,6}$)\d{1,6}|1(?:\.0{1,6})?)$`;
const FEE_LIMIT = new RegExp(FEE_LIMIT_PATTERN);

type Access = ReturnType<typeof createMcpAccessAdapter>;
type Address = `0x${string}`;
type Hash = `0x${string}`;

export type ManagedPublisherCircle = {
  createWallet(refId: string, idempotencyKey: string): Promise<{ walletId: string; address: Address }>;
  /** Circle's current LOW fee for this exact call from this wallet, in gwei. */
  estimateFee(input: { walletId: string; contractAddress: Address; callData: Hash }): Promise<PinnedFee>;
  execute(input: { walletId: string; contractAddress: Address; callData: Hash; idempotencyKey: string; refId: string; fee: PinnedFee }): Promise<{ id: string; state: string }>;
  transaction(id: string): Promise<{ state: string; txHash?: string | null; errorReason?: string | null }>;
};

export type ManagedPublisherChain = {
  balance(address: Address): Promise<bigint>;
  hasCode(address: Address): Promise<boolean>;
  receipt(hash: Hash): Promise<TransactionReceipt | null>;
  transaction(hash: Hash): Promise<Transaction>;
  ownerOf(agentId: bigint): Promise<Address>;
  agentURI(agentId: bigint): Promise<string>;
};

export type ManagedPublisherResult = {
  status: "fund_wallet" | "review_terms" | "pending" | "ready" | "published" | "needs_attention";
  nextAction: string;
  draftId: string;
  chainId: number;
  fundingAddress: Address | null;
  fundingAsset: "Arc Testnet native USDC";
  balanceUSDC: string | null;
  termsDigest: Hash;
  custody: "AGON-managed Circle developer-controlled wallet";
  agentId: string | null;
  reference: string | null;
  txHash: Hash | null;
  /** The most any one write may cost: the builder's limit, or the 1 USDC hard cap. */
  feeLimitUSDC: string;
  /** The worst case of the next write (gas limit x max fee), when known. */
  nextFee: { action: "register" | "publish"; worstCaseUSDC: string } | null;
};

function digest(value: unknown): Hash {
  return `0x${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function formatUSDC(wei: bigint): string {
  const whole = wei / 1_000_000_000_000_000_000n;
  const decimal = (wei % 1_000_000_000_000_000_000n).toString().padStart(18, "0").replace(/0+$/, "");
  return decimal ? `${whole}.${decimal}` : whole.toString();
}

function usdcWei(text: string): bigint {
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole!) * 1_000_000_000_000_000_000n + BigInt(fraction.padEnd(18, "0"));
}

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function hash(value: string | null | undefined): Hash | null {
  return value && /^0x[0-9a-fA-F]{64}$/.test(value) ? value.toLowerCase() as Hash : null;
}

function assertTransaction(tx: Transaction, from: Address, to: Address, callData: Hash): void {
  if (!sameAddress(tx.from, from) || !tx.to || !sameAddress(tx.to, to) || tx.input.toLowerCase() !== callData.toLowerCase()) {
    throw new Error("Circle transaction does not match the approved publisher action");
  }
}

export function createManagedPublisher(options: {
  store: ManagedPublisherStore;
  draftStore: ProviderDraftStore;
  access: Access;
  circle: ManagedPublisherCircle;
  chain: ManagedPublisherChain;
  identityRegistry: Address;
  serviceRegistry: Address;
  publicApiUrl: string;
  publicationReady(): Promise<boolean>;
  /** The builder's approval needs a recent passing listing check (Plan 3e). */
  checksPassed?: (actor: string, draftId: string) => Promise<boolean>;
  /** Finds and confirms this wallet's listing for the agent if it is already on chain. */
  recoverPublished?: (walletAddress: Address, agentId: string) => Promise<{ reference: string; txHash: Hash } | null>;
}) {
  const origin = new URL(options.publicApiUrl);
  if (origin.protocol !== "https:" || origin.pathname !== "/" || origin.search || origin.hash) throw new Error("managed publisher requires a public HTTPS API origin");
  const identityUri = (record: ManagedPublisherRecord) => `${origin.origin}/agon/identities/${record.publicId}`;

  async function save(record: ManagedPublisherRecord, next: ManagedPublisherState): Promise<ManagedPublisherRecord> {
    const saved = await options.store.save(record, next);
    if (!saved) throw new Error("Publisher state changed concurrently. Read its status and retry.");
    return saved;
  }

  const gweiWei = (text: string) => {
    const [whole, fractional = ""] = text.split(".");
    if (!whole || !/^\d+$/.test(whole) || !/^\d{0,9}$/.test(fractional)) throw new Error("Invalid pinned gas quote");
    return BigInt(whole) * GWEI + BigInt(fractional.padEnd(9, "0"));
  };
  /// A fee pinned before the switch to EIP-1559 fees (gasLimit with gasPrice) is never sent.
  const isPinnedFee = (fee: unknown): fee is PinnedFee =>
    Boolean(fee && typeof fee === "object" && "maxFee" in fee && "priorityFee" in fee && "gasLimit" in fee);

  /// The most this write can ever cost: every unit of its gas limit at its max fee.
  function feeCeiling(fee: PinnedFee): bigint {
    if (!/^\d+$/.test(fee.gasLimit)) throw new Error("Invalid pinned gas quote");
    return BigInt(fee.gasLimit) * gweiWei(fee.maxFee);
  }

  async function quoteFee(walletId: string, to: Address, data: Hash): Promise<PinnedFee> {
    const estimate = await options.circle.estimateFee({ walletId, contractAddress: to, callData: data });
    // Circle's gas limit already has headroom: an identity register estimated at 243,418 used 200,748 (17 Oct 2026).
    const fee = { gasLimit: estimate.gasLimit, maxFee: estimate.maxFee, priorityFee: estimate.priorityFee };
    const ceiling = feeCeiling(fee);
    if (ceiling <= 0n || ceiling > maxGasFeeWei) {
      throw new Error(`Gas quote exceeds the managed publisher limit: Circle's fee for this write could reach ${formatUSDC(ceiling)} USDC, over the ${formatUSDC(maxGasFeeWei)} USDC cap. Nothing was sent; check again later.`);
    }
    return fee;
  }

  const feeLimitWei = (state: ManagedPublisherState) => state.maxFeeUSDC ? usdcWei(state.maxFeeUSDC) : maxGasFeeWei;

  async function view(record: ManagedPublisherRecord, status: ManagedPublisherResult["status"], nextAction: string, txHash: Hash | null = null, nextFee?: ManagedPublisherResult["nextFee"]): Promise<ManagedPublisherResult> {
    const balance = record.state.walletAddress ? await options.chain.balance(record.state.walletAddress).catch(() => null) : null;
    const pinned = record.state[record.state.agentId ? "publishFee" : "registerFee"];
    const fee = nextFee !== undefined ? nextFee
      : !record.state.reference && isPinnedFee(pinned) ? { action: record.state.agentId ? "publish" as const : "register" as const, worstCaseUSDC: formatUSDC(feeCeiling(pinned)) } : null;
    return {
      status, nextAction, draftId: record.draftId, chainId,
      fundingAddress: record.state.walletAddress, fundingAsset: "Arc Testnet native USDC",
      balanceUSDC: balance === null ? null : formatUSDC(balance), termsDigest: record.state.draftDigest,
      custody: "AGON-managed Circle developer-controlled wallet", agentId: record.state.agentId,
      reference: record.state.reference, txHash,
      feeLimitUSDC: formatUSDC(feeLimitWei(record.state)), nextFee: fee,
    };
  }

  async function submit(record: ManagedPublisherRecord, action: "register" | "publish", to: Address, data: Hash): Promise<ManagedPublisherRecord | ManagedPublisherResult> {
    const state = record.state;
    if (!state.walletAddress || !state.walletId) throw new Error("Publisher wallet is not ready");
    const txField = action === "register" ? "registerTxId" : "publishTxId";
    const feeField = action === "register" ? "registerFee" : "publishFee";
    if (state[txField]) return record;
    if (await options.chain.balance(state.walletAddress) === 0n) {
      return view(record, "fund_wallet", "Fund the publisher address with Arc Testnet native USDC. AGON checks the current gas estimate before each write.");
    }
    // Pin the Circle fee parameters before submission so a lost response can be retried
    // with the same idempotency key and the same bounded transaction body.
    const idempotencyKey = publisherKey(record.publicId, action === "publish" ? `publish:${state.operationId}` : action);
    for (let attempt = 1; ; attempt++) {
      if (!isPinnedFee(record.state[feeField])) {
        let fee: PinnedFee;
        try { fee = await quoteFee(state.walletId, to, data); }
        catch (error) {
          if (error instanceof Error && /insufficient|not enough funds/i.test(error.message)) {
            return view(record, "fund_wallet", "Add Arc Testnet native USDC to the publisher wallet, then check again. Circle could not estimate the fee with its current balance.");
          }
          throw error;
        }
        if (feeCeiling(fee) > feeLimitWei(record.state)) return overLimit(record, action, fee);
        record = await save(record, { ...record.state, [feeField]: fee });
      }
      const fee = record.state[feeField]!;
      // A limit lowered after this fee was pinned still applies: the pin is dropped, nothing is sent.
      if (feeCeiling(fee) > feeLimitWei(record.state)) return overLimit(await save(record, { ...record.state, [feeField]: null }), action, fee);
      const balance = await options.chain.balance(state.walletAddress);
      const required = feeCeiling(fee);
      if (required <= 0n || required > maxGasFeeWei) throw new Error("Pinned gas quote exceeds the managed publisher limit");
      if (balance < required) return view(record, "fund_wallet", `Fund ${formatUSDC(required - balance)} more Arc Testnet native USDC for the next contract action. The estimate can change before submission.`);
      try {
        const submitted = await options.circle.execute({
          walletId: state.walletId, contractAddress: to, callData: data, idempotencyKey,
          refId: `agon:${record.publicId}:${action}`,
          fee,
        });
        return save(record, { ...record.state, [txField]: submitted.id, ...(action === "publish" ? { publishCallData: data } : {}) });
      } catch (error) {
        // Circle refused the fee itself, so nothing was sent: drop the stale pin and estimate again once.
        if (!(error instanceof Error) || !FEE_REFUSED.test(error.message)) throw error;
        record = await save(record, { ...record.state, [feeField]: null });
        if (attempt >= 2) throw new Error("Circle refused the transaction fee twice. Nothing was sent; check again in a minute.");
      }
    }
  }

  function overLimit(record: ManagedPublisherRecord, action: "register" | "publish", fee: PinnedFee): Promise<ManagedPublisherResult> {
    const worst = formatUSDC(feeCeiling(fee));
    return view(record, "needs_attention",
      `Circle's fee for the next ${action} could reach ${worst} USDC, above your ${formatUSDC(feeLimitWei(record.state))} USDC limit. Nothing was sent. Check again later, or approve again with a higher maxFeeUSDC (at most 1).`,
      null, { action, worstCaseUSDC: worst });
  }

  async function confirmedTransaction(record: ManagedPublisherRecord, circleTxId: string, to: Address, data: Hash): Promise<{ hash: Hash; receipt: TransactionReceipt } | ManagedPublisherResult> {
    const response = await options.circle.transaction(circleTxId);
    if (["FAILED", "CANCELLED", "DENIED", "STUCK"].includes(response.state)) return view(record, "needs_attention", `Circle marked the transaction ${response.state.toLowerCase()}. Review it before any retry.`);
    const txHash = hash(response.txHash);
    if (!txHash) return view(record, "pending", "Circle has the transaction. Check again; do not submit another one.");
    const receipt = await options.chain.receipt(txHash);
    if (!receipt) return view(record, "pending", "The chain has not returned a receipt yet. Check again; do not submit another transaction.", txHash);
    if (receipt.status !== "success") return view(record, "needs_attention", "The transaction reverted on chain. Stop and review the receipt.", txHash);
    const tx = await options.chain.transaction(txHash);
    assertTransaction(tx, record.state.walletAddress!, to, data);
    return { hash: txHash, receipt };
  }

  async function getRecord(actor: string, draftId: string): Promise<ManagedPublisherRecord> {
    const record = await options.store.get(actor, draftId);
    if (!record) throw new Error("No managed publisher belongs to this account and draft");
    const source = await options.draftStore.get(actor, draftId);
      if (!source || digest({ draft: source.draft, chainId, identityRegistry: options.identityRegistry, serviceRegistry: options.serviceRegistry,
        custody: "AGON-managed Circle developer-controlled wallet" }) !== record.state.draftDigest) throw new Error("Publisher draft or network target is missing or has changed");
    return record;
  }

  function phase(record: ManagedPublisherRecord): ManagedPublisherResult["status"] {
    const state = record.state;
    if (state.reference) return "published";
    if (!state.walletAddress || !state.walletId) return "needs_attention";
    if (!state.approvedAt) return "review_terms";
    if ((state.registerTxId && !state.agentId) || (state.publishTxId && !state.reference)) return "pending";
    return "ready";
  }

  async function advanceOnce(actor: string, draftId: string): Promise<ManagedPublisherResult> {
    let record = await getRecord(actor, draftId);
    const state = record.state;
    if (state.reference) return view(record, "published", "wait_for_automatic_certification", state.publishTxHash);
    if (!state.walletAddress || !state.walletId) return view(record, "needs_attention", "setup_managed_publisher");
    if (!state.approvedAt) return view(record, "review_terms", "approve_managed_listing");
    const [identityCode, serviceCode, writerReady] = await Promise.all([
      options.chain.hasCode(options.identityRegistry), options.chain.hasCode(options.serviceRegistry), options.publicationReady(),
    ]);
    if (!identityCode || !serviceCode || !writerReady) {
      return view(record, "needs_attention", "Identity registration and publication are paused until the configured Arc contracts and AGON writer are ready.");
    }

    if (!state.agentId) {
      const uri = identityUri(record);
      const callData = encodeFunctionData({ abi: identityAbi, functionName: "register", args: [uri] });
      const submitted = await submit(record, "register", options.identityRegistry, callData);
      if ("status" in submitted) return submitted;
      record = submitted;
      const confirmed = await confirmedTransaction(record, record.state.registerTxId!, options.identityRegistry, callData);
      if ("status" in confirmed) return confirmed;
      const matches = confirmed.receipt.logs.filter((log) => sameAddress(log.address, options.identityRegistry)).flatMap((log) => {
        try {
          const event = decodeEventLog({ abi: identityAbi, data: log.data, topics: log.topics, strict: true });
          return event.eventName === "Transfer" && sameAddress(event.args.from, "0x0000000000000000000000000000000000000000")
            && sameAddress(event.args.to, state.walletAddress!) ? [event.args.tokenId] : [];
        } catch { return []; }
      });
      if (matches.length !== 1) throw new Error("Identity receipt lacks one matching mint Transfer event");
      const [owner, onchainUri] = await Promise.all([options.chain.ownerOf(matches[0]!), options.chain.agentURI(matches[0]!)]);
      if (!sameAddress(owner, state.walletAddress!) || onchainUri !== uri) throw new Error("Registered identity owner or URI does not match the publisher wallet");
      record = await save(record, { ...record.state, agentId: matches[0]!.toString(), registerTxHash: confirmed.hash });
    }

    // A publish that already reached the chain is recovered from its event, never prepared or sent twice.
    // This holds whether or not its Circle transaction ID was saved before the run that sent it stopped.
    if (options.recoverPublished) {
      const found = await options.recoverPublished(record.state.walletAddress!, record.state.agentId!);
      if (found) {
        record = await save(record, { ...record.state, reference: found.reference, publishTxHash: found.txHash });
        return view(record, "published", "wait_for_automatic_certification", found.txHash);
      }
    }

    // A publish Circle already has is confirmed from its saved calldata. Preparing it again would ask
    // the contract to simulate a listing that already exists, which it refuses.
    if (record.state.publishTxId && record.state.publishCallData) return finishPublish(record, draftId, record.state.publishCallData);

    if (!record.state.operationId) {
      const draft = await options.draftStore.get(actor, draftId);
      if (!draft) throw new Error("Publisher draft disappeared");
      const started = await options.access.startListing(record.state.walletAddress!, draft.draft);
      if (!started.ok) throw new Error(started.message);
      if (started.value.draftId !== draftId) throw new Error("Managed draft digest differs from the approved draft");
      const compiled = await options.access.compileListing(record.state.walletAddress!, { draftId, agentId: record.state.agentId });
      if (!compiled.ok || !compiled.value.manifestUri) throw new Error(compiled.ok ? "Hosted manifest unavailable" : compiled.message);
      const prepared = await options.access.publishListing(record.state.walletAddress!, { draftId, approval: "approve" });
      if (!prepared.ok || !prepared.value.operationId || !prepared.value.transaction) throw new Error(prepared.ok ? "Publication was not prepared" : prepared.message);
      if (prepared.value.transaction.chainId !== String(chainId) || !sameAddress(prepared.value.transaction.to, options.serviceRegistry)
        || prepared.value.transaction.functionName !== "publish") throw new Error("Publication target is not the active Arc registry");
      record = await save(record, { ...record.state, operationId: prepared.value.operationId });
    }

    const prepared = await options.access.publishListing(record.state.walletAddress!, { draftId, approval: "approve" });
    if (!prepared.ok) throw new Error(`Publication could not be prepared: ${prepared.message}`);
    if (!prepared.value.transaction || !prepared.value.operationId) throw new Error("Publication was not prepared");
    if (prepared.value.operationId !== record.state.operationId) {
      // Once a publish transaction exists it is the only one; never switch under it.
      if (record.state.publishTxId) throw new Error("Prepared publication changed before submission");
      // Nothing was sent yet (for example two overlapping advances each prepared one): the latest
      // preparation matches the current draft, so it becomes the one to send.
      record = await save(record, { ...record.state, operationId: prepared.value.operationId });
    }
    const tx = prepared.value.transaction;
    if (tx.chainId !== String(chainId) || !sameAddress(tx.to, options.serviceRegistry) || tx.functionName !== "publish") throw new Error("Publication target changed");
    if (!/^0x(?:[0-9a-fA-F]{2})+$/.test(tx.data)) throw new Error("Prepared publication calldata is invalid");
    const submitted = await submit(record, "publish", options.serviceRegistry, tx.data as Hash);
    if ("status" in submitted) return submitted;
    return finishPublish(submitted, draftId, tx.data as Hash);
  }

  async function finishPublish(record: ManagedPublisherRecord, draftId: string, data: Hash): Promise<ManagedPublisherResult> {
    const confirmed = await confirmedTransaction(record, record.state.publishTxId!, options.serviceRegistry, data);
    if ("status" in confirmed) return confirmed;
    const published = await options.access.confirmListing(record.state.walletAddress!, { draftId, operationId: record.state.operationId, txHash: confirmed.hash });
    if (!published.ok || published.value.status !== "published" || !published.value.reference) throw new Error(published.ok ? "Publication receipt did not reconcile" : published.message);
    record = await save(record, { ...record.state, publishTxHash: confirmed.hash, reference: published.value.reference });
    return view(record, "published", "wait_for_automatic_certification", confirmed.hash);
  }

  // One advance per draft at a time: overlapping runs once prepared two publications and lost one.
  const running = new Map<string, Promise<unknown>>();
  function serialized<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = running.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(task);
    running.set(key, next);
    void next.catch(() => undefined).finally(() => { if (running.get(key) === next) running.delete(key); });
    return next;
  }

  return {
    async setup(actor: string, draftId: string): Promise<ManagedPublisherResult> {
      const draft = await options.draftStore.get(actor, draftId);
      if (!draft) throw new Error("Create a listing draft before requesting its publisher wallet");
      let record = await options.store.create(actor, draftId, digest({ draft: draft.draft, chainId, identityRegistry: options.identityRegistry,
        serviceRegistry: options.serviceRegistry, custody: "AGON-managed Circle developer-controlled wallet" }));
      if (!record.state.walletId) {
        const wallet = await options.circle.createWallet(`agon:${record.publicId}`, publisherKey(record.publicId, "wallet"));
        record = await save(record, { ...record.state, walletId: wallet.walletId, walletAddress: wallet.address });
      }
      // Show what the first write may cost before the builder approves; an estimate failure only hides it.
      let first: ManagedPublisherResult["nextFee"] | undefined;
      if (!record.state.agentId && record.state.walletId) {
        const callData = encodeFunctionData({ abi: identityAbi, functionName: "register", args: [identityUri(record)] });
        first = await options.circle.estimateFee({ walletId: record.state.walletId, contractAddress: options.identityRegistry, callData })
          .then((fee) => ({ action: "register" as const, worstCaseUSDC: formatUSDC(feeCeiling(fee)) }), () => undefined);
      }
      return view(record, phase(record), record.state.approvedAt ? "continue_managed_listing" : "Review the draft and approve its exact terms digest before any onchain write.", null, first);
    },
    async approve(actor: string, draftId: string, termsDigest: string, approval: string, maxFeeUSDC?: string): Promise<ManagedPublisherResult> {
      if (maxFeeUSDC !== undefined && !FEE_LIMIT.test(maxFeeUSDC)) throw new Error("The fee limit must be a USDC amount above 0 and at most 1, such as 0.5.");
      const record = await getRecord(actor, draftId);
      if (approval !== "approve" || termsDigest.toLowerCase() !== record.state.draftDigest.toLowerCase()) throw new Error("The exact draft digest and explicit approval are required");
      if (!record.state.approvedAt && options.checksPassed && !(await options.checksPassed(actor, draftId))) {
        throw new Error("Run the listing checks first: publishing needs a passing check for this endpoint and price from the last 30 minutes.");
      }
      if (!record.state.walletAddress) throw new Error("Provision the publisher wallet first");
      const limit = maxFeeUSDC === undefined ? {} : { maxFeeUSDC: formatUSDC(usdcWei(maxFeeUSDC)) };
      const updated = record.state.approvedAt && maxFeeUSDC === undefined ? record
        : await save(record, { ...record.state, approvedAt: record.state.approvedAt ?? new Date().toISOString(), ...limit });
      return view(updated, "ready", "continue_managed_listing");
    },
    async status(actor: string, draftId: string): Promise<ManagedPublisherResult> {
      const record = await getRecord(actor, draftId);
      return view(record, phase(record),
        record.state.reference ? "wait_for_automatic_certification"
          : !record.state.walletAddress ? "setup_managed_publisher"
            : !record.state.approvedAt ? "approve_managed_listing" : "continue_managed_listing");
    },
    advance(actor: string, draftId: string): Promise<ManagedPublisherResult> {
      return serialized(`${actor.toLowerCase()}|${draftId}`, () => advanceOnce(actor, draftId));
    },
    async publicIdentity(publicId: string): Promise<Record<string, unknown> | null> {
      const record = await options.store.getPublic(publicId);
      if (!record?.state.agentId || !record.state.walletAddress) return null;
      if (BigInt(record.state.agentId) > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Agent ID cannot be represented in the registration file");
      const draft = await options.draftStore.get(record.actor, record.draftId);
      if (!draft || digest({ draft: draft.draft, chainId, identityRegistry: options.identityRegistry, serviceRegistry: options.serviceRegistry,
        custody: "AGON-managed Circle developer-controlled wallet" }) !== record.state.draftDigest) return null;
      return {
        type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
        name: draft.draft.name, description: draft.draft.outcome, image: draft.draft.logoUrl,
        services: [{ name: "web", endpoint: draft.draft.endpoint, version: "1" }],
        registrations: [{ agentId: Number(record.state.agentId), agentRegistry: `eip155:${chainId}:${options.identityRegistry}` }],
        supportedTrust: [],
      };
    },
  };
}

export type ManagedPublisher = ReturnType<typeof createManagedPublisher>;
