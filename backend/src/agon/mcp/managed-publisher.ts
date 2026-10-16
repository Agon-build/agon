import { createHash } from "node:crypto";
import { decodeEventLog, encodeFunctionData, parseAbi, type Transaction, type TransactionReceipt } from "viem";
import type { ProviderDraftStore } from "./provider-draft-store.ts";
import type { createMcpAccessAdapter } from "./adapter.ts";
import { publisherKey, type ManagedPublisherRecord, type ManagedPublisherState, type ManagedPublisherStore } from "./managed-publisher-store.ts";

const identityAbi = parseAbi([
  "function register(string agentURI) returns (uint256 agentId)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
]);
const chainId = 5042002;
const gasSafetyMultiplier = 2n;
const maxGasFeeWei = 500_000_000_000_000_000n; // Hard per-action Circle gas ceiling: 0.5 native USDC.

type Access = ReturnType<typeof createMcpAccessAdapter>;
type Address = `0x${string}`;
type Hash = `0x${string}`;

export type ManagedPublisherCircle = {
  createWallet(refId: string, idempotencyKey: string): Promise<{ walletId: string; address: Address }>;
  execute(input: { walletId: string; contractAddress: Address; callData: Hash; idempotencyKey: string; refId: string; fee: { gasLimit: string; gasPrice: string } }): Promise<{ id: string; state: string }>;
  transaction(id: string): Promise<{ state: string; txHash?: string | null; errorReason?: string | null }>;
};

export type ManagedPublisherChain = {
  balance(address: Address): Promise<bigint>;
  hasCode(address: Address): Promise<boolean>;
  gasQuote(from: Address, to: Address, data: Hash): Promise<{ gasLimit: bigint; gasPriceWei: bigint }>;
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
};

function digest(value: unknown): Hash {
  return `0x${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function formatUSDC(wei: bigint): string {
  const whole = wei / 1_000_000_000_000_000_000n;
  const decimal = (wei % 1_000_000_000_000_000_000n).toString().padStart(18, "0").replace(/0+$/, "");
  return decimal ? `${whole}.${decimal}` : whole.toString();
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
}) {
  const origin = new URL(options.publicApiUrl);
  if (origin.protocol !== "https:" || origin.pathname !== "/" || origin.search || origin.hash) throw new Error("managed publisher requires a public HTTPS API origin");
  const identityUri = (record: ManagedPublisherRecord) => `${origin.origin}/agon/identities/${record.publicId}`;

  async function save(record: ManagedPublisherRecord, next: ManagedPublisherState): Promise<ManagedPublisherRecord> {
    const saved = await options.store.save(record, next);
    if (!saved) throw new Error("Publisher state changed concurrently. Read its status and retry.");
    return saved;
  }

  function feeCeiling(fee: { gasLimit: string; gasPrice: string }): bigint {
    const [whole, fractional = ""] = fee.gasPrice.split(".");
    if (!whole || !/^\d+$/.test(whole) || !/^\d{0,9}$/.test(fractional) || !/^\d+$/.test(fee.gasLimit)) throw new Error("Invalid pinned gas quote");
    return BigInt(fee.gasLimit) * (BigInt(whole) * 1_000_000_000n + BigInt(fractional.padEnd(9, "0")));
  }

  async function quoteFee(wallet: Address, to: Address, data: Hash): Promise<{ gasLimit: string; gasPrice: string }> {
    const quote = await options.chain.gasQuote(wallet, to, data);
    const gasLimit = quote.gasLimit * gasSafetyMultiplier;
    const gasPriceWei = quote.gasPriceWei * gasSafetyMultiplier;
    if (gasLimit <= 0n || gasPriceWei <= 0n || gasLimit * gasPriceWei > maxGasFeeWei) throw new Error("Gas quote exceeds the managed publisher limit");
    const whole = gasPriceWei / 1_000_000_000n;
    const fraction = (gasPriceWei % 1_000_000_000n).toString().padStart(9, "0").replace(/0+$/, "");
    return { gasLimit: gasLimit.toString(), gasPrice: fraction ? `${whole}.${fraction}` : whole.toString() };
  }

  async function view(record: ManagedPublisherRecord, status: ManagedPublisherResult["status"], nextAction: string, txHash: Hash | null = null): Promise<ManagedPublisherResult> {
    const balance = record.state.walletAddress ? await options.chain.balance(record.state.walletAddress).catch(() => null) : null;
    return {
      status, nextAction, draftId: record.draftId, chainId,
      fundingAddress: record.state.walletAddress, fundingAsset: "Arc Testnet native USDC",
      balanceUSDC: balance === null ? null : formatUSDC(balance), termsDigest: record.state.draftDigest,
      custody: "AGON-managed Circle developer-controlled wallet", agentId: record.state.agentId,
      reference: record.state.reference, txHash,
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
    if (!state[feeField]) {
      let fee: { gasLimit: string; gasPrice: string };
      try { fee = await quoteFee(state.walletAddress, to, data); }
      catch (error) {
        if (error instanceof Error && /insufficient funds|not enough funds/i.test(error.message)) {
          return view(record, "fund_wallet", "Add Arc Testnet native USDC to the publisher wallet, then check again. The RPC could not estimate gas with its current balance.");
        }
        throw error;
      }
      record = await save(record, { ...state, [feeField]: fee });
    }
    const fee = record.state[feeField]!;
    const balance = await options.chain.balance(state.walletAddress);
    const required = feeCeiling(fee);
    if (required <= 0n || required > maxGasFeeWei) throw new Error("Pinned gas quote exceeds the managed publisher limit");
    if (balance < required) return view(record, "fund_wallet", `Fund ${formatUSDC(required - balance)} more Arc Testnet native USDC for the next contract action. The estimate can change before submission.`);
    const submitted = await options.circle.execute({
      walletId: state.walletId, contractAddress: to, callData: data,
      idempotencyKey: publisherKey(record.publicId, action === "publish" ? `publish:${state.operationId}` : action),
      refId: `agon:${record.publicId}:${action}`,
      fee,
    });
    return save(record, { ...state, [txField]: submitted.id });
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
      return view(record, phase(record), record.state.approvedAt ? "continue_managed_listing" : "Review the draft and approve its exact terms digest before any onchain write.");
    },
    async approve(actor: string, draftId: string, termsDigest: string, approval: string): Promise<ManagedPublisherResult> {
      const record = await getRecord(actor, draftId);
      if (approval !== "approve" || termsDigest.toLowerCase() !== record.state.draftDigest.toLowerCase()) throw new Error("The exact draft digest and explicit approval are required");
      if (!record.state.approvedAt && options.checksPassed && !(await options.checksPassed(actor, draftId))) {
        throw new Error("Run the listing checks first: publishing needs a passing check for this endpoint and price from the last 30 minutes.");
      }
      if (!record.state.walletAddress) throw new Error("Provision the publisher wallet first");
      const updated = record.state.approvedAt ? record : await save(record, { ...record.state, approvedAt: new Date().toISOString() });
      return view(updated, "ready", "continue_managed_listing");
    },
    async status(actor: string, draftId: string): Promise<ManagedPublisherResult> {
      const record = await getRecord(actor, draftId);
      return view(record, phase(record),
        record.state.reference ? "wait_for_automatic_certification"
          : !record.state.walletAddress ? "setup_managed_publisher"
            : !record.state.approvedAt ? "approve_managed_listing" : "continue_managed_listing");
    },
    async advance(actor: string, draftId: string): Promise<ManagedPublisherResult> {
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
      record = submitted;
      const confirmed = await confirmedTransaction(record, record.state.publishTxId!, options.serviceRegistry, tx.data as Hash);
      if ("status" in confirmed) return confirmed;
      const published = await options.access.confirmListing(record.state.walletAddress!, { draftId, operationId: record.state.operationId, txHash: confirmed.hash });
      if (!published.ok || published.value.status !== "published" || !published.value.reference) throw new Error(published.ok ? "Publication receipt did not reconcile" : published.message);
      record = await save(record, { ...record.state, publishTxHash: confirmed.hash, reference: published.value.reference });
      return view(record, "published", "wait_for_automatic_certification", confirmed.hash);
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
