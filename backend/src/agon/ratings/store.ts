import type pg from "pg";

import type { AgonNetworkId } from "../network.ts";
import { starsToScore, type Rating, type RefTotals } from "./rules.ts";

export type NewRating = { jobId: string; rater: string; providerRef: string; network: AgonNetworkId; stars: number; comment: string | null; at: Date };

export interface RatingsStore {
  get(jobId: string): Promise<Rating | null>;
  /** Writes the rating once; false when the job already has one. */
  add(r: NewRating): Promise<boolean>;
  /** Ratings per provider ref made in [since, until); all of them when both are null. */
  totals(refs: readonly string[], since: Date | null, until: Date | null): Promise<RefTotals[]>;
  /** The newest ratings that carry a comment, for the agent's page. */
  recent(refs: readonly string[], limit: number): Promise<Rating[]>;
}

type Row = { job_id: string; provider_ref: string; stars: number; comment: string | null; created_at: Date };
const toRating = (r: Row): Rating => ({ jobId: r.job_id, providerRef: r.provider_ref, stars: r.stars, comment: r.comment, createdAt: r.created_at });

export class PostgresRatingsStore implements RatingsStore {
  private readonly pool: pg.Pool;
  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  async get(jobId: string): Promise<Rating | null> {
    const { rows } = await this.pool.query<Row>("select job_id::text, provider_ref, stars, comment, created_at from agon_job_ratings where job_id = $1", [jobId]);
    return rows[0] ? toRating(rows[0]) : null;
  }

  async add(r: NewRating): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `insert into agon_job_ratings (job_id, rater, provider_ref, network, stars, comment, created_at)
       values ($1, $2, $3, $4, $5, $6, $7) on conflict (job_id) do nothing`,
      [r.jobId, r.rater, r.providerRef, r.network, r.stars, r.comment, r.at],
    );
    return (rowCount ?? 0) > 0;
  }

  async totals(refs: readonly string[], since: Date | null, until: Date | null): Promise<RefTotals[]> {
    if (refs.length === 0) return [];
    const { rows } = await this.pool.query<{ provider_ref: string; n: string; star_sum: string }>(
      `select provider_ref, count(*)::text as n, sum(stars)::text as star_sum from agon_job_ratings
       where provider_ref = any($1) and ($2::timestamptz is null or created_at >= $2) and ($3::timestamptz is null or created_at < $3)
       group by provider_ref`,
      [refs, since, until],
    );
    // Stars map linearly to the score, so the mean score is the score of the mean star.
    return rows.map((r) => ({ providerRef: r.provider_ref, n: Number(r.n), scoreSum: starsToScore(Number(r.star_sum) / Number(r.n)) * Number(r.n) }));
  }

  async recent(refs: readonly string[], limit: number): Promise<Rating[]> {
    if (refs.length === 0) return [];
    const { rows } = await this.pool.query<Row>(
      `select job_id::text, provider_ref, stars, comment, created_at from agon_job_ratings
       where provider_ref = any($1) and comment is not null order by created_at desc limit $2`,
      [refs, limit],
    );
    return rows.map(toRating);
  }
}
