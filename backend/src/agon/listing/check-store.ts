import type pg from "pg";

import type { ListingCheckResult } from "./endpoint-check.ts";

/// Every check run is recorded; publishing looks for a recent passing one.
export interface ListingCheckStore {
  record(input: { actor: string; endpoint: string; priceAtomic: bigint; result: ListingCheckResult; at: Date }): Promise<void>;
  latestPass(actor: string, endpoint: string, priceAtomic: bigint, since: Date): Promise<Date | null>;
}

export class PostgresListingCheckStore implements ListingCheckStore {
  private readonly pool: pg.Pool;
  constructor(pool: pg.Pool) { this.pool = pool; }

  async record(input: { actor: string; endpoint: string; priceAtomic: bigint; result: ListingCheckResult; at: Date }) {
    await this.pool.query(
      `insert into agon_listing_checks (actor_address, endpoint, price_atomic, required_passed, result, created_at)
       values ($1, $2, $3, $4, $5::jsonb, $6)`,
      [input.actor.toLowerCase(), input.endpoint, input.priceAtomic.toString(), input.result.requiredPassed, JSON.stringify(input.result), input.at],
    );
  }

  async latestPass(actor: string, endpoint: string, priceAtomic: bigint, since: Date) {
    const { rows } = await this.pool.query<{ created_at: Date }>(
      `select created_at from agon_listing_checks
        where actor_address = $1 and endpoint = $2 and price_atomic = $3 and required_passed and created_at >= $4
        order by created_at desc limit 1`,
      [actor.toLowerCase(), endpoint, priceAtomic.toString(), since],
    );
    return rows[0]?.created_at ?? null;
  }
}

export function createMemoryListingCheckStore(): ListingCheckStore {
  const rows: { actor: string; endpoint: string; priceAtomic: bigint; passed: boolean; at: Date }[] = [];
  return {
    async record(input) {
      rows.push({ actor: input.actor.toLowerCase(), endpoint: input.endpoint, priceAtomic: input.priceAtomic, passed: input.result.requiredPassed, at: input.at });
    },
    async latestPass(actor, endpoint, priceAtomic, since) {
      const hits = rows.filter((r) => r.actor === actor.toLowerCase() && r.endpoint === endpoint && r.priceAtomic === priceAtomic && r.passed && r.at >= since);
      return hits.length ? hits[hits.length - 1]!.at : null;
    },
  };
}
