import type pg from "pg";

/// One-time terms for the agent wallet Agon holds for a web or MCP user.
/// A hire cannot be quoted, and so no agent wallet is created, until the
/// account owner accepts the current version in the browser.
export const CUSTODY_TERMS_VERSION = "custody-2026-10-17";
export const CUSTODY_TERMS: readonly string[] = [
  "Agon holds a USDC balance for you in an agent wallet it runs on your behalf.",
  "It only pays what you confirm, within your per-hire and daily limits, which you can lower.",
  "Payments over your per-hire limit, withdrawals and unfreezing are approved in your browser.",
  "You can withdraw your balance at any time.",
];

export interface CustodyTerms {
  isAccepted(ownerRef: string): Promise<boolean>;
  accept(ownerRef: string, version: string, now: Date): Promise<boolean>;
}

export class PostgresCustodyTerms implements CustodyTerms {
  private readonly pool: pg.Pool;
  constructor(pool: pg.Pool) { this.pool = pool; }

  async isAccepted(ownerRef: string): Promise<boolean> {
    const { rows } = await this.pool.query<{ version: string }>("select version from agon_custody_terms where owner_ref = $1", [ownerRef]);
    return rows[0]?.version === CUSTODY_TERMS_VERSION;
  }

  async accept(ownerRef: string, version: string, now: Date): Promise<boolean> {
    if (version !== CUSTODY_TERMS_VERSION) return false;
    await this.pool.query(
      `insert into agon_custody_terms (owner_ref, version, accepted_at) values ($1, $2, $3)
       on conflict (owner_ref) do update set version = excluded.version, accepted_at = excluded.accepted_at`,
      [ownerRef, version, now],
    );
    return true;
  }
}
