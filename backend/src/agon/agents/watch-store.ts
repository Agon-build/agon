import type pg from "pg";

import type { WatchAlertKind, WatchState } from "./resolution-watch.ts";

export type WatchRecord = { watchId: string; ownerAddress: string | null; payer: string; network: string; status: "active" | "done"; createdAt: Date; endsAt: Date };
export type WatchMarket = { watchId: string; conditionId: string; question: string; url: string; state: WatchState; updatedAt: Date };
export type WatchAlertRow = { watchId: string; conditionId: string; kind: WatchAlertKind; stateKey: string; title: string; body: string; createdAt: Date };

export type WatchStore = {
  createWatch(w: Omit<WatchRecord, "status" | "createdAt">, markets: Omit<WatchMarket, "watchId" | "updatedAt">[], now: Date): Promise<void>;
  getWatch(watchId: string): Promise<{ watch: WatchRecord; markets: WatchMarket[]; alerts: WatchAlertRow[] } | null>;
  /// Markets of active watches that have not settled yet.
  activeMarkets(now: Date): Promise<WatchMarket[]>;
  saveState(watchId: string, conditionId: string, state: WatchState, now: Date): Promise<void>;
  /// True when the alert is new; false when this market already raised it.
  recordAlert(a: Omit<WatchAlertRow, "createdAt">, now: Date): Promise<boolean>;
  /// Ends watches whose markets all settled or whose end date passed; returns how many.
  finishWatches(now: Date): Promise<number>;
};

type WatchRow = { watch_id: string; owner_address: string | null; payer: string; network: string; status: "active" | "done"; created_at: Date; ends_at: Date };
type MarketRow = { watch_id: string; condition_id: string; question: string; url: string; state: WatchState; updated_at: Date };
type AlertRow = { watch_id: string; condition_id: string; kind: WatchAlertKind; state_key: string; title: string; body: string; created_at: Date };

const toWatch = (r: WatchRow): WatchRecord => ({ watchId: r.watch_id, ownerAddress: r.owner_address, payer: r.payer, network: r.network, status: r.status, createdAt: r.created_at, endsAt: r.ends_at });
const toMarket = (r: MarketRow): WatchMarket => ({ watchId: r.watch_id, conditionId: r.condition_id, question: r.question, url: r.url, state: r.state, updatedAt: r.updated_at });
const toAlert = (r: AlertRow): WatchAlertRow => ({ watchId: r.watch_id, conditionId: r.condition_id, kind: r.kind, stateKey: r.state_key, title: r.title, body: r.body, createdAt: r.created_at });

export class PostgresWatchStore implements WatchStore {
  private readonly pool: pg.Pool;
  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  async createWatch(w: Omit<WatchRecord, "status" | "createdAt">, markets: Omit<WatchMarket, "watchId" | "updatedAt">[], now: Date): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(
        "insert into agon_watches (watch_id, owner_address, payer, network, created_at, ends_at) values ($1, $2, $3, $4, $5, $6)",
        [w.watchId, w.ownerAddress?.toLowerCase() ?? null, w.payer.toLowerCase(), w.network, now, w.endsAt],
      );
      for (const m of markets) {
        await client.query(
          "insert into agon_watch_markets (watch_id, condition_id, question, url, state, updated_at) values ($1, $2, $3, $4, $5, $6)",
          [w.watchId, m.conditionId.toLowerCase(), m.question, m.url, JSON.stringify(m.state), now],
        );
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async getWatch(watchId: string) {
    const w = await this.pool.query<WatchRow>("select * from agon_watches where watch_id = $1", [watchId]);
    if (!w.rows[0]) return null;
    const m = await this.pool.query<MarketRow>("select * from agon_watch_markets where watch_id = $1 order by question", [watchId]);
    const a = await this.pool.query<AlertRow>("select * from agon_watch_alerts where watch_id = $1 order by created_at, state_key", [watchId]);
    return { watch: toWatch(w.rows[0]), markets: m.rows.map(toMarket), alerts: a.rows.map(toAlert) };
  }

  async activeMarkets(now: Date): Promise<WatchMarket[]> {
    const { rows } = await this.pool.query<MarketRow>(
      `select m.* from agon_watch_markets m join agon_watches w on w.watch_id = m.watch_id
        where w.status = 'active' and w.ends_at > $1 and m.state->>'status' <> 'settled'
        order by m.watch_id, m.condition_id`,
      [now],
    );
    return rows.map(toMarket);
  }

  async saveState(watchId: string, conditionId: string, state: WatchState, now: Date): Promise<void> {
    await this.pool.query("update agon_watch_markets set state = $3, updated_at = $4 where watch_id = $1 and condition_id = $2", [watchId, conditionId.toLowerCase(), JSON.stringify(state), now]);
  }

  async recordAlert(a: Omit<WatchAlertRow, "createdAt">, now: Date): Promise<boolean> {
    const res = await this.pool.query(
      `insert into agon_watch_alerts (watch_id, condition_id, kind, state_key, title, body, created_at)
       values ($1, $2, $3, $4, $5, $6, $7) on conflict do nothing`,
      [a.watchId, a.conditionId.toLowerCase(), a.kind, a.stateKey, a.title, a.body, now],
    );
    return (res.rowCount ?? 0) > 0;
  }

  async finishWatches(now: Date): Promise<number> {
    const res = await this.pool.query(
      `update agon_watches w set status = 'done'
        where w.status = 'active'
          and (w.ends_at <= $1 or not exists (
            select 1 from agon_watch_markets m where m.watch_id = w.watch_id and m.state->>'status' <> 'settled'))`,
      [now],
    );
    return res.rowCount ?? 0;
  }
}
