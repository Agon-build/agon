import type pg from "pg";

import type { DeliveryChannel, DeliveryRow, DeliveryStore, FinishedJob, WatchAlertRow } from "./worker.ts";

export class PostgresDeliveryStore implements DeliveryStore {
  private readonly pool: pg.Pool;
  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  async finishedJobs(since: Date, limit: number): Promise<FinishedJob[]> {
    const { rows } = await this.pool.query<{ job_id: string; depth: number; provider_label: string; price_atomic: string; state: string; request: unknown; result: unknown; buyer_ref: string }>(
      `select j.job_id, j.depth, j.provider_label, j.price_atomic::text, j.state, j.request, j.result, j.buyer_ref
         from agon_jobs j
        where j.depth = 0 and j.state in ('delivered','failed','refunded') and j.updated_at >= $1
          and j.buyer_ref like 'budget:op:%'
          and not exists (select 1 from agon_deliveries d where d.event_key = 'job:' || j.job_id || ':' || j.state)
        order by j.updated_at
        limit $2`,
      [since, limit],
    );
    return rows.map((r) => ({
      jobId: r.job_id, depth: r.depth, providerLabel: r.provider_label, priceAtomic: BigInt(r.price_atomic), state: r.state,
      request: r.request, result: r.result, buyerRef: r.buyer_ref,
    }));
  }

  async watchAlerts(since: Date, limit: number): Promise<WatchAlertRow[]> {
    const { rows } = await this.pool.query<{ event_key: string; operator: string; title: string; body: string; watch_id: string }>(
      `select 'watch:' || a.watch_id || ':' || a.condition_id || ':' || a.state_key as event_key,
              w.owner_address as operator, a.title, a.body, a.watch_id
         from agon_watch_alerts a join agon_watches w on w.watch_id = a.watch_id
        where a.created_at >= $1 and w.owner_address is not null
          and not exists (select 1 from agon_deliveries d where d.event_key = 'watch:' || a.watch_id || ':' || a.condition_id || ':' || a.state_key)
        order by a.created_at
        limit $2`,
      [since, limit],
    );
    return rows.map((r) => ({ eventKey: r.event_key, operator: r.operator, title: r.title, body: r.body, watchId: r.watch_id }));
  }

  async enqueue(rows: Parameters<DeliveryStore["enqueue"]>[0], now: Date): Promise<number> {
    let added = 0;
    for (const r of rows) {
      const res = await this.pool.query(
        `insert into agon_deliveries (event_key, channel, operator, title, body, href, next_attempt_at, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $7) on conflict (event_key, channel) do nothing`,
        [r.eventKey, r.channel, r.operator.toLowerCase(), r.title.slice(0, 300), r.body.slice(0, 2000), r.href, now],
      );
      added += res.rowCount ?? 0;
    }
    return added;
  }

  async due(now: Date, limit: number): Promise<DeliveryRow[]> {
    const { rows } = await this.pool.query<{ event_key: string; channel: DeliveryChannel; operator: string; title: string; body: string; href: string; attempts: number }>(
      `select event_key, channel, operator, title, body, href, attempts from agon_deliveries
        where status = 'pending' and next_attempt_at <= $1 order by next_attempt_at limit $2`,
      [now, limit],
    );
    return rows.map((r) => ({ eventKey: r.event_key, channel: r.channel, operator: r.operator, title: r.title, body: r.body, href: r.href, attempts: r.attempts }));
  }

  async markSent(eventKey: string, channel: DeliveryChannel, now: Date): Promise<void> {
    await this.pool.query(
      `update agon_deliveries set status = 'sent', sent_at = $3, attempts = attempts + 1, last_error = null where event_key = $1 and channel = $2`,
      [eventKey, channel, now],
    );
  }

  async markFailed(eventKey: string, channel: DeliveryChannel, error: string, next: Date | null, now: Date): Promise<void> {
    await this.pool.query(
      `update agon_deliveries set attempts = attempts + 1, last_error = $3,
              status = case when $4::timestamptz is null then 'failed' else 'pending' end,
              next_attempt_at = coalesce($4::timestamptz, $5)
        where event_key = $1 and channel = $2`,
      [eventKey, channel, error, next, now],
    );
  }

  async markSkipped(eventKey: string, channel: DeliveryChannel, reason: string, _now: Date): Promise<void> {
    await this.pool.query(`update agon_deliveries set status = 'skipped', last_error = $3 where event_key = $1 and channel = $2`, [eventKey, channel, reason]);
  }

  async telegramChatOf(operator: string): Promise<string | null> {
    const { rows } = await this.pool.query<{ chat_id: string }>("select chat_id from agon_telegram_links where operator = $1", [operator.toLowerCase()]);
    return rows[0]?.chat_id ?? null;
  }

  async emailOf(operator: string): Promise<string | null> {
    const { rows } = await this.pool.query<{ email: string | null }>("select email from operators where address = $1", [operator.toLowerCase()]);
    const email = rows[0]?.email ?? null;
    return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
  }
}
