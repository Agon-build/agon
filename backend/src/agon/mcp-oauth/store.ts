import { randomBytes, randomUUID } from "node:crypto";
import type pg from "pg";

import { hashSecret, newSecret, normalizeResource, OAUTH_TTL, scopesForLevel, verifyPkceS256, type ConnectLevel } from "./rules.ts";

export type OAuthClient = { clientId: string; clientName: string; redirectUris: string[]; logoUri: string | null; source: "dcr" | "cimd"; fetchedAt: Date };
export type PendingRequest = { id: string; clientId: string; redirectUri: string; state: string | null; requestedScopes: string[]; resource: string; expiresAt: Date };
export type TokenPair = { accessToken: string; refreshToken: string; expiresIn: 3600; scope: string };
export type ConnectionView = { id: string; clientName: string; level: ConnectLevel; createdAt: Date; lastUsedAt: Date | null };
type Grant = TokenPair | { error: "invalid_grant" };

const INVALID: { error: "invalid_grant" } = { error: "invalid_grant" };

type ClientRow = { client_id: string; client_name: string; redirect_uris: string[]; logo_uri: string | null; source: "dcr" | "cimd"; fetched_at: Date };
const toClient = (r: ClientRow): OAuthClient => ({ clientId: r.client_id, clientName: r.client_name, redirectUris: r.redirect_uris, logoUri: r.logo_uri, source: r.source, fetchedAt: r.fetched_at });

/// Clients, Connect requests, connections and rotating tokens for MCP sign-in.
export class PostgresOAuthStore {
  private readonly pool: pg.Pool;
  constructor(pool: pg.Pool) { this.pool = pool; }

  async registerClient(input: { clientName: string; redirectUris: string[]; logoUri?: string | null; source: "dcr" | "cimd"; clientId?: string }): Promise<OAuthClient> {
    const clientId = input.clientId ?? `agon_dcr_${randomBytes(16).toString("base64url")}`;
    const { rows } = await this.pool.query<ClientRow>(
      `insert into agon_oauth_clients (client_id, client_name, redirect_uris, logo_uri, source, fetched_at) values ($1, $2, $3, $4, $5, now())
       on conflict (client_id) do update set client_name = excluded.client_name, redirect_uris = excluded.redirect_uris, logo_uri = excluded.logo_uri, fetched_at = now()
       returning *`,
      [clientId, input.clientName.slice(0, 80), input.redirectUris, input.logoUri ?? null, input.source],
    );
    return toClient(rows[0]!);
  }

  async getClient(clientId: string): Promise<OAuthClient | null> {
    const { rows } = await this.pool.query<ClientRow>("select * from agon_oauth_clients where client_id = $1", [clientId]);
    return rows[0] ? toClient(rows[0]) : null;
  }

  async createRequest(input: { clientId: string; redirectUri: string; codeChallenge: string; state: string | null; requestedScopes: string[]; resource: string; now: Date }): Promise<{ id: string }> {
    const id = randomUUID();
    await this.pool.query(
      `insert into agon_oauth_requests (id, client_id, redirect_uri, code_challenge, state, requested_scopes, resource, created_at, expires_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, input.clientId, input.redirectUri, input.codeChallenge, input.state, input.requestedScopes, normalizeResource(input.resource), input.now, new Date(input.now.getTime() + OAUTH_TTL.requestMs)],
    );
    return { id };
  }

  async getRequest(id: string, now: Date): Promise<PendingRequest | null> {
    const { rows } = await this.pool.query<{ id: string; client_id: string; redirect_uri: string; state: string | null; requested_scopes: string[]; resource: string; expires_at: Date }>(
      "select * from agon_oauth_requests where id = $1 and decided_at is null and expires_at > $2",
      [id, now],
    );
    const r = rows[0];
    return r ? { id: r.id, clientId: r.client_id, redirectUri: r.redirect_uri, state: r.state, requestedScopes: r.requested_scopes, resource: r.resource, expiresAt: r.expires_at } : null;
  }

  /// Approves once: a second decision on the same request gets null.
  async decide(id: string, input: { address: string; level: ConnectLevel; now: Date }): Promise<{ code: string; redirectUri: string; state: string | null } | null> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const claimed = await client.query<{ client_id: string; redirect_uri: string; state: string | null }>(
        "update agon_oauth_requests set decided_at = $2 where id = $1 and decided_at is null and expires_at > $2 returning client_id, redirect_uri, state",
        [id, input.now],
      );
      const req = claimed.rows[0];
      if (!req) { await client.query("rollback"); return null; }
      // Every approval is its own connection, so a second device never disconnects the first.
      const connectionId = randomUUID();
      await client.query(
        "insert into agon_oauth_connections (id, owner_address, client_id, level, created_at, updated_at) values ($1, $2, $3, $4, $5, $5)",
        [connectionId, input.address.toLowerCase(), req.client_id, input.level, input.now],
      );
      const code = newSecret("agon_oac_");
      await client.query(
        "update agon_oauth_requests set connection_id = $2, code_hash = $3, code_expires_at = $4 where id = $1",
        [id, connectionId, hashSecret(code), new Date(input.now.getTime() + OAUTH_TTL.codeMs)],
      );
      await client.query("commit");
      return { code, redirectUri: req.redirect_uri, state: req.state };
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async deny(id: string, now: Date): Promise<{ redirectUri: string; state: string | null } | null> {
    const { rows } = await this.pool.query<{ redirect_uri: string; state: string | null }>(
      "update agon_oauth_requests set decided_at = $2 where id = $1 and decided_at is null and expires_at > $2 returning redirect_uri, state",
      [id, now],
    );
    return rows[0] ? { redirectUri: rows[0].redirect_uri, state: rows[0].state } : null;
  }

  /// One use only: the code is burnt even when a check fails.
  async redeemCode(input: { code: string; clientId: string; redirectUri: string; codeVerifier: string; resource: string; now: Date }): Promise<Grant> {
    const { rows } = await this.pool.query<{ client_id: string; redirect_uri: string; code_challenge: string; resource: string; code_expires_at: Date; connection_id: string }>(
      "update agon_oauth_requests set code_used_at = $2 where code_hash = $1 and code_used_at is null returning client_id, redirect_uri, code_challenge, resource, code_expires_at, connection_id",
      [hashSecret(input.code), input.now],
    );
    const r = rows[0];
    if (!r || r.code_expires_at <= input.now || r.client_id !== input.clientId || r.redirect_uri !== input.redirectUri || r.resource !== normalizeResource(input.resource)) return INVALID;
    if (!verifyPkceS256(input.codeVerifier, r.code_challenge)) return INVALID;
    const conn = await this.liveConnection(r.connection_id);
    if (!conn) return INVALID;
    return this.issue(r.connection_id, conn.level, r.resource, input.now);
  }

  async refresh(input: { refreshToken: string; clientId: string; resource: string; now: Date }): Promise<Grant> {
    const { rows } = await this.pool.query<{ connection_id: string; resource: string; replaced_at: Date | null; revoked_at: Date | null }>(
      "select connection_id, resource, replaced_at, revoked_at from agon_oauth_tokens where token_hash = $1 and kind = 'refresh'",
      [hashSecret(input.refreshToken)],
    );
    const t = rows[0];
    if (!t || t.revoked_at) return INVALID;
    if (t.replaced_at) {
      // A rotated refresh token came back: treat the connection as stolen.
      await this.revokeConnection(t.connection_id, input.now);
      return INVALID;
    }
    const conn = await this.liveConnection(t.connection_id);
    if (!conn || conn.clientId !== input.clientId || t.resource !== normalizeResource(input.resource)) return INVALID;
    if (conn.lastActive.getTime() + OAUTH_TTL.idleMs <= input.now.getTime()) return INVALID;
    const replaced = await this.pool.query("update agon_oauth_tokens set replaced_at = $2 where token_hash = $1 and replaced_at is null", [hashSecret(input.refreshToken), input.now]);
    if (replaced.rowCount !== 1) return INVALID;
    await this.pool.query("update agon_oauth_connections set last_used_at = $2 where id = $1", [t.connection_id, input.now]);
    return this.issue(t.connection_id, conn.level, t.resource, input.now);
  }

  async verifyAccess(token: string, resource: string, now: Date): Promise<{ address: string; scopes: string[]; clientName: string } | null> {
    const { rows } = await this.pool.query<{ owner_address: string; scopes: string[]; client_name: string; connection_id: string }>(
      `select c.owner_address, t.scopes, k.client_name, t.connection_id
         from agon_oauth_tokens t
         join agon_oauth_connections c on c.id = t.connection_id
         join agon_oauth_clients k on k.client_id = c.client_id
        where t.token_hash = $1 and t.kind = 'access' and t.revoked_at is null and c.revoked_at is null
          and t.expires_at > $2 and t.resource = $3`,
      [hashSecret(token), now, normalizeResource(resource)],
    );
    const r = rows[0];
    if (!r) return null;
    await this.pool.query("update agon_oauth_connections set last_used_at = $2 where id = $1", [r.connection_id, now]);
    return { address: r.owner_address, scopes: r.scopes, clientName: r.client_name };
  }

  async listConnections(address: string): Promise<ConnectionView[]> {
    const { rows } = await this.pool.query<{ id: string; client_name: string; level: ConnectLevel; created_at: Date; last_used_at: Date | null }>(
      `select c.id, k.client_name, c.level, c.created_at, c.last_used_at
         from agon_oauth_connections c join agon_oauth_clients k on k.client_id = c.client_id
        where c.owner_address = $1 and c.revoked_at is null order by c.created_at desc`,
      [address.toLowerCase()],
    );
    return rows.map((r) => ({ id: r.id, clientName: r.client_name, level: r.level, createdAt: r.created_at, lastUsedAt: r.last_used_at }));
  }

  async disconnect(address: string, connectionId: string, now: Date): Promise<boolean> {
    if (!/^[0-9a-f-]{36}$/i.test(connectionId)) return false;
    const { rowCount } = await this.pool.query(
      "update agon_oauth_connections set revoked_at = $3 where id = $1 and owner_address = $2 and revoked_at is null",
      [connectionId, address.toLowerCase(), now],
    );
    if (rowCount !== 1) return false;
    await this.pool.query("update agon_oauth_tokens set revoked_at = $2 where connection_id = $1 and revoked_at is null", [connectionId, now]);
    return true;
  }

  async revokeToken(token: string, now: Date): Promise<void> {
    await this.pool.query("update agon_oauth_tokens set revoked_at = $2 where token_hash = $1 and revoked_at is null", [hashSecret(token), now]);
  }

  /// Drops requests a day past expiry and tokens that can no longer be used.
  async purgeExpired(now: Date): Promise<{ requests: number; tokens: number }> {
    const day = new Date(now.getTime() - 86_400_000);
    const month = new Date(now.getTime() - 30 * 86_400_000);
    const requests = await this.pool.query("delete from agon_oauth_requests where expires_at < $1 and (code_expires_at is null or code_expires_at < $1)", [day]);
    const tokens = await this.pool.query(
      "delete from agon_oauth_tokens where (kind = 'access' and expires_at < $1) or revoked_at < $1 or replaced_at < $2",
      [day, month],
    );
    return { requests: requests.rowCount ?? 0, tokens: tokens.rowCount ?? 0 };
  }

  private async liveConnection(id: string): Promise<{ level: ConnectLevel; clientId: string; lastActive: Date } | null> {
    const { rows } = await this.pool.query<{ level: ConnectLevel; client_id: string; last_used_at: Date | null; updated_at: Date }>(
      "select level, client_id, last_used_at, updated_at from agon_oauth_connections where id = $1 and revoked_at is null",
      [id],
    );
    const r = rows[0];
    return r ? { level: r.level, clientId: r.client_id, lastActive: r.last_used_at ?? r.updated_at } : null;
  }

  private async revokeConnection(id: string, now: Date): Promise<void> {
    await this.pool.query("update agon_oauth_connections set revoked_at = $2 where id = $1 and revoked_at is null", [id, now]);
    await this.pool.query("update agon_oauth_tokens set revoked_at = $2 where connection_id = $1 and revoked_at is null", [id, now]);
  }

  private async issue(connectionId: string, level: ConnectLevel, resource: string, now: Date): Promise<TokenPair> {
    const scopes = scopesForLevel(level);
    const accessToken = newSecret("agon_oat_");
    const refreshToken = newSecret("agon_ort_");
    await this.pool.query(
      `insert into agon_oauth_tokens (token_hash, kind, connection_id, resource, scopes, created_at, expires_at) values
         ($1, 'access', $3, $4, $5, $6, $7), ($2, 'refresh', $3, $4, $5, $6, null)`,
      [hashSecret(accessToken), hashSecret(refreshToken), connectionId, resource, scopes, now, new Date(now.getTime() + OAUTH_TTL.accessMs)],
    );
    return { accessToken, refreshToken, expiresIn: 3600, scope: scopes.join(" ") };
  }
}
