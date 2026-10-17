import { createHash, randomBytes, randomUUID } from "node:crypto";
import type pg from "pg";

/// Agent access tokens: named, revocable tokens a builder creates in Account to
/// connect a coding agent over MCP. Only a hash is stored.
export type AccessLevel = "read" | "listing" | "hiring" | "full";
export const ACCESS_LEVEL_SCOPES: Record<AccessLevel, readonly string[]> = {
  read: ["agon:read"],
  listing: ["agon:read", "listing:prepare", "listing:write", "listing:confirm"],
  hiring: ["agon:read", "wallet:execute"],
  full: ["agon:read", "listing:prepare", "listing:write", "listing:confirm", "wallet:execute"],
};
export const ACCESS_TOKEN_PREFIX = "agon_pat_";
export const MAX_ACTIVE_TOKENS = 10;

export type AccessTokenRecord = { id: string; owner: string; name: string; level: AccessLevel; createdAt: Date; expiresAt: Date; lastUsedAt: Date | null; revokedAt: Date | null };
export type McpClaims = { address: string; client: string | null; scopes: string[] };
export type McpTokenResult = McpClaims | { problem: "expired" | "revoked" | "unknown" } | null;

export interface AccessTokenStore {
  create(input: { owner: string; name: string; level: AccessLevel; days: 30 | 90; now: Date }): Promise<{ ok: true; token: string; record: AccessTokenRecord } | { ok: false; code: "too_many_tokens" }>;
  list(owner: string): Promise<AccessTokenRecord[]>;
  revoke(owner: string, id: string, now: Date): Promise<boolean>;
  verify(token: string, now: Date): Promise<{ ok: true; claims: { address: string; client: "agon-cli"; scopes: string[] } } | { ok: false; reason: "unknown" | "expired" | "revoked" }>;
}

export function newAccessToken(): string {
  return `${ACCESS_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export function hashAccessToken(token: string): string {
  return createHash("sha256").update(token.trim()).digest("hex");
}

type Row = { id: string; owner_address: string; name: string; level: AccessLevel; created_at: Date; expires_at: Date; last_used_at: Date | null; revoked_at: Date | null };
const toRecord = (r: Row): AccessTokenRecord => ({
  id: r.id, owner: r.owner_address, name: r.name, level: r.level, createdAt: r.created_at, expiresAt: r.expires_at, lastUsedAt: r.last_used_at, revokedAt: r.revoked_at,
});

export class PostgresAccessTokenStore implements AccessTokenStore {
  private readonly pool: pg.Pool;
  constructor(pool: pg.Pool) { this.pool = pool; }

  async create(input: { owner: string; name: string; level: AccessLevel; days: 30 | 90; now: Date }) {
    const owner = input.owner.toLowerCase();
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      // One writer per owner at a time, so two parallel creates cannot both pass the cap.
      await client.query("select pg_advisory_xact_lock(hashtext($1))", [`agon_access_tokens:${owner}`]);
      const { rows } = await client.query<{ n: string }>(
        "select count(*)::text as n from agon_access_tokens where owner_address = $1 and revoked_at is null and expires_at > $2",
        [owner, input.now],
      );
      if (Number(rows[0]!.n) >= MAX_ACTIVE_TOKENS) {
        await client.query("rollback");
        return { ok: false as const, code: "too_many_tokens" as const };
      }
      const token = newAccessToken();
      const expiresAt = new Date(input.now.getTime() + input.days * 86_400_000);
      const inserted = await client.query<Row>(
        `insert into agon_access_tokens (id, owner_address, name, level, token_hash, created_at, expires_at)
         values ($1, $2, $3, $4, $5, $6, $7) returning *`,
        [randomUUID(), owner, input.name.trim(), input.level, hashAccessToken(token), input.now, expiresAt],
      );
      await client.query("commit");
      return { ok: true as const, token, record: toRecord(inserted.rows[0]!) };
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async list(owner: string) {
    const { rows } = await this.pool.query<Row>("select * from agon_access_tokens where owner_address = $1 order by created_at desc limit 50", [owner.toLowerCase()]);
    return rows.map(toRecord);
  }

  async revoke(owner: string, id: string, now: Date) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
    const { rowCount } = await this.pool.query(
      "update agon_access_tokens set revoked_at = coalesce(revoked_at, $3) where id = $1 and owner_address = $2",
      [id, owner.toLowerCase(), now],
    );
    return (rowCount ?? 0) > 0;
  }

  async verify(token: string, now: Date) {
    const { rows } = await this.pool.query<Row>("select * from agon_access_tokens where token_hash = $1", [hashAccessToken(token)]);
    const row = rows[0];
    if (!row) return { ok: false as const, reason: "unknown" as const };
    if (row.revoked_at) return { ok: false as const, reason: "revoked" as const };
    if (row.expires_at <= now) return { ok: false as const, reason: "expired" as const };
    await this.pool.query("update agon_access_tokens set last_used_at = $2 where id = $1", [row.id, now]);
    return { ok: true as const, claims: { address: row.owner_address, client: "agon-cli" as const, scopes: [...ACCESS_LEVEL_SCOPES[row.level]] } };
  }
}

/// The MCP endpoint's token check: Agent access tokens first, then device sign-in tokens.
export function createMcpTokenVerifier(store: AccessTokenStore, verifyJwt: (token: string) => Promise<McpClaims | null>, now: () => Date = () => new Date()) {
  return async (raw: string): Promise<McpTokenResult> => {
    const token = raw.trim();
    if (token.startsWith(ACCESS_TOKEN_PREFIX)) {
      const out = await store.verify(token, now());
      return out.ok ? out.claims : { problem: out.reason };
    }
    return verifyJwt(token);
  };
}
