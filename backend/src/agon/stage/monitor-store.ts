import type pg from "pg";

import { toJob, toPayment, type JobRow, type PaymentRow } from "../payments/store.ts";
import type { Job, JobPayment } from "../payments/types.ts";
import type { MonitorStore } from "./monitor.ts";

export class PostgresMonitorStore implements MonitorStore {
  private pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  async stuckPaying(olderThan: Date): Promise<Job[]> {
    const { rows } = await this.pool.query<JobRow>("select * from agon_jobs where state = 'paying' and updated_at < $1 order by updated_at limit 50", [olderThan]);
    return rows.map(toJob);
  }

  async failedRefunds(since: Date): Promise<JobPayment[]> {
    const { rows } = await this.pool.query<PaymentRow>("select * from agon_job_payments where kind = 'refund' and status = 'failed' and updated_at >= $1 order by updated_at desc limit 50", [since]);
    return rows.map(toPayment);
  }

  async recentJobs(limit: number): Promise<Job[]> {
    const { rows } = await this.pool.query<JobRow>("select * from agon_jobs order by created_at desc limit $1", [Math.max(1, Math.min(limit, 200))]);
    return rows.map(toJob);
  }
}
