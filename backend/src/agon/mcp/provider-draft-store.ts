import type { Pool } from "pg";
import type { ProviderDraftInput } from "./contract.ts";
import type { CompiledProviderManifest } from "./provider-manifest.ts";

export type ProviderDraftState = "draft" | "compiled" | "prepared" | "confirmed" | "paused";

export type StoredProviderDraft = {
  draftId: string;
  actor: string;
  draft: ProviderDraftInput;
  compiled: CompiledProviderManifest | null;
  manifestUri: string | null;
  state: ProviderDraftState;
  operationId: string | null;
  reference: string | null;
  publicationKind: "new" | "version";
  listingId: string | null;
  txHash: `0x${string}` | null;
  blockNumber: string | null;
  logIndex: number | null;
};

export type ProviderPublicationEvidence = {
  txHash: `0x${string}`;
  blockNumber: string;
  logIndex: number;
};

export type ProviderDraftStore = {
  create(actor: string, draftId: string, draft: ProviderDraftInput): Promise<StoredProviderDraft>;
  get(actor: string, draftId: string): Promise<StoredProviderDraft | null>;
  /** The actor's drafts, newest first. */
  list(actor: string, limit: number): Promise<StoredProviderDraft[]>;
  saveCompilation(actor: string, draftId: string, compiled: CompiledProviderManifest, manifestUri: string | null, target?: { kind: "new" | "version"; listingId?: string }): Promise<StoredProviderDraft | null>;
  markPrepared(actor: string, draftId: string, operationId: string, reference?: string): Promise<StoredProviderDraft | null>;
  markConfirmed(actor: string, draftId: string, reference?: string, evidence?: ProviderPublicationEvidence): Promise<StoredProviderDraft | null>;
  markPaused(actor: string, draftId: string): Promise<StoredProviderDraft | null>;
};

function normalizedActor(actor: string): string {
  if (!/^0x[0-9a-f]{40}$/i.test(actor)) throw new Error("provider actor must be an EVM address");
  return actor.toLowerCase();
}

function draftView(input: Omit<StoredProviderDraft, "actor"> & { actor: string }): StoredProviderDraft {
  return {
    draftId: input.draftId,
    actor: normalizedActor(input.actor),
    draft: input.draft,
    compiled: input.compiled,
    manifestUri: input.manifestUri,
    state: input.state,
    operationId: input.operationId,
    reference: input.reference,
    publicationKind: input.publicationKind,
    listingId: input.listingId,
    txHash: input.txHash,
    blockNumber: input.blockNumber,
    logIndex: input.logIndex,
  };
}

/** Process-local fallback used by unit tests and local preview only. */
export function createMemoryProviderDraftStore(): ProviderDraftStore {
  const rows = new Map<string, StoredProviderDraft>();
  const key = (actor: string, draftId: string) => `${normalizedActor(actor)}:${draftId}`;
  return {
    async create(actor, draftId, draft) {
      const k = key(actor, draftId);
      const existing = rows.get(k);
      if (existing) return existing;
      const row = draftView({ draftId, actor, draft, compiled: null, manifestUri: null, state: "draft", operationId: null, reference: null, publicationKind: "new", listingId: null, txHash: null, blockNumber: null, logIndex: null });
      rows.set(k, row);
      return row;
    },
    async get(actor, draftId) { return rows.get(key(actor, draftId)) ?? null; },
    async list(actor, limit) {
      const prefix = `${normalizedActor(actor)}:`;
      return [...rows.entries()].filter(([k]) => k.startsWith(prefix)).map(([, row]) => row).reverse().slice(0, Math.max(1, Math.min(limit, 100)));
    },
    async saveCompilation(actor, draftId, compiled, manifestUri, target) {
      const row = rows.get(key(actor, draftId));
      if (!row) return null;
      row.compiled = compiled;
      row.manifestUri = manifestUri;
      row.state = "compiled";
      row.publicationKind = target?.kind ?? "new";
      row.listingId = target?.listingId ?? null;
      return row;
    },
    async markPrepared(actor, draftId, operationId, reference) {
      const row = rows.get(key(actor, draftId));
      if (!row) return null;
      row.state = "prepared";
      row.operationId = operationId;
      row.reference = reference ?? null;
      return row;
    },
    async markConfirmed(actor, draftId, reference, evidence) {
      const row = rows.get(key(actor, draftId));
      if (!row) return null;
      row.state = "confirmed";
      row.reference = reference ?? row.reference;
      row.txHash = evidence?.txHash ?? row.txHash;
      row.blockNumber = evidence?.blockNumber ?? row.blockNumber;
      row.logIndex = evidence?.logIndex ?? row.logIndex;
      return row;
    },
    async markPaused(actor, draftId) {
      const row = rows.get(key(actor, draftId));
      if (!row) return null;
      row.state = "paused";
      return row;
    },
  };
}

/** Durable provider draft store. It persists the exact input and compiled manifest, never secrets. */
export function createPostgresProviderDraftStore(pool: Pool): ProviderDraftStore {
  return {
    async list(actor, limit) {
      const normalized = normalizedActor(actor);
      const { rows } = await pool.query<{ draft_id: string }>(
        "select draft_id from agon_mcp_provider_drafts where actor_address = $1 order by updated_at desc, created_at desc limit $2",
        [normalized, Math.max(1, Math.min(limit, 100))],
      );
      const drafts = await Promise.all(rows.map((r) => this.get(normalized, r.draft_id)));
      return drafts.filter((d): d is StoredProviderDraft => d !== null);
    },
    async create(actor, draftId, draft) {
      const normalized = normalizedActor(actor);
      await pool.query(
        `insert into agon_mcp_provider_drafts (draft_id, actor_address, draft, state, publication_kind)
         values ($1, $2, $3::jsonb, 'draft', 'new')
         on conflict (draft_id, actor_address) do nothing`,
        [draftId, normalized, JSON.stringify(draft)],
      );
      const row = await this.get(normalized, draftId);
      if (!row) throw new Error("provider draft could not be persisted");
      return row;
    },
    async get(actor, draftId) {
      const normalized = normalizedActor(actor);
      const result = await pool.query<{
        draft_id: string; actor_address: string; draft: ProviderDraftInput;
        compiled_manifest: CompiledProviderManifest | null; manifest_uri: string | null;
        state: ProviderDraftState; operation_id: string | null; reference: string | null;
        publication_kind: "new" | "version"; listing_id: string | null;
        tx_hash: `0x${string}` | null; block_number: string | null; log_index: number | null;
      }>(
        `select draft_id, actor_address, draft, compiled_manifest, manifest_uri, state, operation_id, reference, publication_kind, listing_id, tx_hash, block_number, log_index
           from agon_mcp_provider_drafts where draft_id = $1 and actor_address = $2`,
        [draftId, normalized],
      );
      const row = result.rows[0];
      return row ? draftView({ draftId: row.draft_id, actor: row.actor_address, draft: row.draft, compiled: row.compiled_manifest, manifestUri: row.manifest_uri, state: row.state, operationId: row.operation_id, reference: row.reference, publicationKind: row.publication_kind, listingId: row.listing_id, txHash: row.tx_hash, blockNumber: row.block_number, logIndex: row.log_index }) : null;
    },
    async saveCompilation(actor, draftId, compiled, manifestUri, target) {
      const normalized = normalizedActor(actor);
      await pool.query(
        `update agon_mcp_provider_drafts
            set compiled_manifest = $3::jsonb, manifest_uri = $4, state = 'compiled', publication_kind = $5, listing_id = $6, updated_at = now()
          where draft_id = $1 and actor_address = $2`,
        [draftId, normalized, JSON.stringify(compiled), manifestUri, target?.kind ?? "new", target?.listingId ?? null],
      );
      return this.get(normalized, draftId);
    },
    async markPrepared(actor, draftId, operationId, reference) {
      const normalized = normalizedActor(actor);
      await pool.query(
        `update agon_mcp_provider_drafts
            set state = 'prepared', operation_id = $3, reference = $4, updated_at = now()
          where draft_id = $1 and actor_address = $2`,
        [draftId, normalized, operationId, reference ?? null],
      );
      return this.get(normalized, draftId);
    },
    async markConfirmed(actor, draftId, reference, evidence) {
      const normalized = normalizedActor(actor);
      await pool.query(
        `update agon_mcp_provider_drafts
            set state = 'confirmed', reference = coalesce($3, reference), tx_hash = coalesce($4, tx_hash), block_number = coalesce($5, block_number), log_index = coalesce($6, log_index), updated_at = now()
          where draft_id = $1 and actor_address = $2`,
        [draftId, normalized, reference ?? null, evidence?.txHash ?? null, evidence?.blockNumber ?? null, evidence?.logIndex ?? null],
      );
      return this.get(normalized, draftId);
    },
    async markPaused(actor, draftId) {
      const normalized = normalizedActor(actor);
      await pool.query(
        `update agon_mcp_provider_drafts set state = 'paused', updated_at = now()
          where draft_id = $1 and actor_address = $2`,
        [draftId, normalized],
      );
      return this.get(normalized, draftId);
    },
  };
}
