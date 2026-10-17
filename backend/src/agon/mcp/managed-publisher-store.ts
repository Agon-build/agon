import { createHash } from "node:crypto";
import type { Pool } from "pg";

/// The EIP-1559 fee a publisher write is sent with: gas units, then max fee and tip in gwei.
export type PinnedFee = { gasLimit: string; maxFee: string; priorityFee: string };

export type ManagedPublisherState = {
  draftDigest: `0x${string}`;
  walletId: string | null;
  walletAddress: `0x${string}` | null;
  approvedAt: string | null;
  agentId: string | null;
  registerTxId: string | null;
  registerTxHash: `0x${string}` | null;
  registerFee: PinnedFee | null;
  operationId: string | null;
  publishTxId: string | null;
  publishTxHash: `0x${string}` | null;
  publishFee: PinnedFee | null;
  /** The exact publish calldata Circle was sent, so a later check confirms it without preparing again. Absent on older rows. */
  publishCallData?: `0x${string}` | null;
  reference: string | null;
};

export type ManagedPublisherRecord = {
  actor: `0x${string}`;
  draftId: string;
  publicId: string;
  version: number;
  state: ManagedPublisherState;
};

export type ManagedPublisherStore = {
  create(actor: string, draftId: string, digest: `0x${string}`): Promise<ManagedPublisherRecord>;
  get(actor: string, draftId: string): Promise<ManagedPublisherRecord | null>;
  getPublic(publicId: string): Promise<ManagedPublisherRecord | null>;
  save(record: ManagedPublisherRecord, next: ManagedPublisherState): Promise<ManagedPublisherRecord | null>;
};

export function publisherUuid(value: string): string {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
}

export function publisherId(actor: string, draftId: string): string {
  return publisherUuid(`agon-publisher:${actor.toLowerCase()}:${draftId}`);
}

export function publisherKey(publicId: string, action: string): string {
  return publisherUuid(`agon-publisher:${publicId}:${action}`);
}

function address(value: string): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error("authenticated account must be an EVM address");
  return value.toLowerCase() as `0x${string}`;
}

function initial(draftDigest: `0x${string}`): ManagedPublisherState {
  return {
    draftDigest, walletId: null, walletAddress: null, approvedAt: null, agentId: null,
    registerTxId: null, registerTxHash: null, registerFee: null,
    operationId: null, publishTxId: null, publishTxHash: null, publishFee: null, publishCallData: null, reference: null,
  };
}

export function createMemoryManagedPublisherStore(): ManagedPublisherStore {
  const rows = new Map<string, ManagedPublisherRecord>();
  const key = (actor: string, draftId: string) => `${address(actor)}:${draftId}`;
  return {
    async create(actor, draftId, digest) {
      const k = key(actor, draftId);
      const previous = rows.get(k);
      if (previous) {
        if (previous.state.draftDigest !== digest) throw new Error("draft changed after publisher setup");
        return previous;
      }
      const row = { actor: address(actor), draftId, publicId: publisherId(actor, draftId), version: 0, state: initial(digest) };
      rows.set(k, row);
      return row;
    },
    async get(actor, draftId) { return rows.get(key(actor, draftId)) ?? null; },
    async getPublic(publicId) { return [...rows.values()].find((row) => row.publicId === publicId) ?? null; },
    async save(record, next) {
      const k = key(record.actor, record.draftId);
      const current = rows.get(k);
      if (!current || current.version !== record.version) return null;
      const updated = { ...current, version: current.version + 1, state: next };
      rows.set(k, updated);
      return updated;
    },
  };
}

export function createPostgresManagedPublisherStore(pool: Pool): ManagedPublisherStore {
  const select = `select actor_address, draft_id, public_id, version, state from agon_mcp_managed_publishers`;
  const view = (row: { actor_address: string; draft_id: string; public_id: string; version: string; state: ManagedPublisherState }): ManagedPublisherRecord => ({
    actor: address(row.actor_address), draftId: row.draft_id, publicId: row.public_id,
    version: Number(row.version), state: row.state,
  });
  return {
    async create(actor, draftId, digest) {
      const normalized = address(actor);
      await pool.query(
        `insert into agon_mcp_managed_publishers (actor_address, draft_id, public_id, state)
         values ($1, $2, $3, $4::jsonb) on conflict (actor_address, draft_id) do nothing`,
        [normalized, draftId, publisherId(normalized, draftId), JSON.stringify(initial(digest))],
      );
      const row = await this.get(normalized, draftId);
      if (!row || row.state.draftDigest !== digest) throw new Error("publisher setup conflicts with an existing draft");
      return row;
    },
    async get(actor, draftId) {
      const result = await pool.query(`${select} where actor_address = $1 and draft_id = $2`, [address(actor), draftId]);
      return result.rows[0] ? view(result.rows[0]) : null;
    },
    async getPublic(publicId) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/.test(publicId)) return null;
      const result = await pool.query(`${select} where public_id = $1`, [publicId]);
      return result.rows[0] ? view(result.rows[0]) : null;
    },
    async save(record, next) {
      const result = await pool.query(
        `update agon_mcp_managed_publishers set state = $4::jsonb, version = version + 1, updated_at = now()
         where actor_address = $1 and draft_id = $2 and version = $3
         returning actor_address, draft_id, public_id, version, state`,
        [record.actor, record.draftId, record.version, JSON.stringify(next)],
      );
      return result.rows[0] ? view(result.rows[0]) : null;
    },
  };
}
